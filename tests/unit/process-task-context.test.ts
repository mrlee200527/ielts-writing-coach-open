import { describe, expect, it } from "vitest";

import { createTaskIntake } from "../../src/application/task-intake/create-task-intake";
import { processTaskContext } from "../../src/application/task-intake/process-task-context";
import { InMemoryTaskIntakeRepository } from "../../src/testing/in-memory-task-intake.repository";
import { InMemoryBlobFake } from "../../src/testing/in-memory-blob.fake";
import { ControlledJobFake } from "../../src/testing/controlled-job.fake";
import { ControlledTaskContextLlmFake } from "../../src/testing/controlled-task-context-llm.fake";
import { dynamicTaskContextFixture } from "../../src/testing/task-context-fixtures";
import { stableUuid } from "../../src/domain/shared/ids";
import { retryTaskIntake } from "../../src/application/task-intake/retry-task-intake";

async function setup() {
  const repository = new InMemoryTaskIntakeRepository();
  const blobs = new InMemoryBlobFake();
  const created = await createTaskIntake({ repository, blobs, jobs: new ControlledJobFake() }, {
    requestIdempotencyKey: "process-request", userId: stableUuid("user"), promptText: null,
    imageBytes: new Uint8Array([1, 2, 3]), mediaType: "image/png", now: new Date("2026-08-14T06:00:00Z"),
  });
  return { repository, blobs, created, llm: new ControlledTaskContextLlmFake() };
}

async function releaseNext(llm: ControlledTaskContextLlmFake, result: "SUCCESS" | "TIMEOUT" | "INVALID_JSON") {
  let call = llm.taskContextCalls.find((candidate) => llm.request(candidate.correlationId));
  for (let index = 0; index < 20 && !call; index += 1) {
    await Promise.resolve();
    call = llm.taskContextCalls.find((candidate) => llm.request(candidate.correlationId));
  }
  if (!call) throw new Error("NO_PENDING_CALL");
  if (result === "SUCCESS") llm.succeed(call.correlationId, dynamicTaskContextFixture);
  else llm.fail(call.correlationId, result);
  return call;
}

describe("process task context", () => {
  it("publishes a READY version once and ignores duplicate callbacks", async () => {
    const { repository, blobs, created, llm } = await setup();
    const processing = processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date("2026-08-14T06:01:00Z") });
    await releaseNext(llm, "SUCCESS");
    await expect(processing).resolves.toMatchObject({ status: "PUBLISHED" });
    expect(repository.versions(created.workspace.task.id)).toHaveLength(1);
    expect(repository.eventCount(created.workspace.task.id)).toBe(1);
    await expect(processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date() })).resolves.toMatchObject({ status: "DUPLICATE" });
    expect(repository.versions(created.workspace.task.id)).toHaveLength(1);
  });

  it("uses at most two ANALYZE calls after timeout", async () => {
    const { repository, blobs, created, llm } = await setup();
    const processing = processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date() });
    const first = await releaseNext(llm, "TIMEOUT");
    const second = await releaseNext(llm, "SUCCESS");
    await processing;
    expect([first.mode, second.mode]).toEqual(["ANALYZE", "ANALYZE"]);
    expect((await repository.findAttempt(created.workspace.task.id, created.attempt.id))?.attempt.callCount).toBe(2);
    expect(llm.taskContextCalls).toHaveLength(2);
  });

  it("uses REPAIR after invalid JSON and publishes UNAVAILABLE after two failures", async () => {
    const { repository, blobs, created, llm } = await setup();
    const processing = processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date() });
    await releaseNext(llm, "INVALID_JSON");
    const repair = await releaseNext(llm, "TIMEOUT");
    await processing;
    expect(repair.mode).toBe("REPAIR");
    expect(repository.versions(created.workspace.task.id)[0]).toMatchObject({ status: "UNAVAILABLE", context: null });
    expect((await repository.findResolution(created.workspace.task.id))?.processingStatus).toBe("FAILED");
  });

  it.each(["REFUSAL", "INCOMPLETE", "TERMINAL"] as const)("does not retry %s", async (code) => {
    const { repository, blobs, created, llm } = await setup();
    const processing = processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date() });
    for (let index = 0; index < 20 && llm.taskContextCalls.length === 0; index += 1) await Promise.resolve();
    const call = llm.taskContextCalls[0];
    llm.fail(call.correlationId, code);
    await processing;
    expect(llm.taskContextCalls).toHaveLength(1);
    expect(repository.versions(created.workspace.task.id)[0]?.status).toBe("UNAVAILABLE");
  });

  it("does not call the LLM when the blob is missing", async () => {
    const { repository, blobs, created, llm } = await setup();
    await blobs.delete(created.workspace.task.imageBlobId!);
    await processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date() });
    expect(llm.taskContextCalls).toHaveLength(0);
    expect(repository.versions(created.workspace.task.id)[0]?.status).toBe("UNAVAILABLE");
  });

  it("publishes DEGRADED when at least one certain fact remains with limitations", async () => {
    const { repository, blobs, created, llm } = await setup();
    const processing = processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date() });
    for (let index = 0; index < 20 && llm.taskContextCalls.length === 0; index += 1) await Promise.resolve();
    const call = llm.taskContextCalls[0];
    llm.succeed(call.correlationId, {
      ...dynamicTaskContextFixture,
      facts: dynamicTaskContextFixture.facts.map((fact, index) => index === 0 ? { ...fact, certainty: "UNCERTAIN", uncertaintyCategory: "TIME_RANGE_AMBIGUOUS" } : fact),
      limitations: ["TIME_RANGE_UNCLEAR"],
    });
    await processing;
    expect(repository.versions(created.workspace.task.id)[0]?.status).toBe("DEGRADED");
  });

  it("gives an explicit retry a new attempt and independent budget", async () => {
    const { repository, blobs, created, llm } = await setup();
    const first = processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date() });
    await releaseNext(llm, "TIMEOUT");
    await releaseNext(llm, "TIMEOUT");
    await first;
    const jobs = new ControlledJobFake();
    const retry = await retryTaskIntake({ repository, jobs }, { taskId: created.workspace.task.id, requestIdempotencyKey: "retry-1" });
    const replay = await retryTaskIntake({ repository, jobs }, { taskId: created.workspace.task.id, requestIdempotencyKey: "retry-1" });
    expect(retry.attempt.id).not.toBe(created.attempt.id);
    expect(replay.attempt.id).toBe(retry.attempt.id);
    expect(retry.attempt.callCount).toBe(0);
  });

  it("rejects an old attempt after a retry claims the task", async () => {
    const { repository, blobs, created, llm } = await setup();
    await retryTaskIntake({ repository, jobs: new ControlledJobFake() }, { taskId: created.workspace.task.id, requestIdempotencyKey: "retry-late" });
    await expect(processTaskContext({ repository, blobs, llm }, { taskId: created.workspace.task.id, attemptId: created.attempt.id, now: new Date() })).resolves.toEqual({ status: "STALE" });
    expect(repository.versions(created.workspace.task.id)).toHaveLength(0);
    expect(llm.taskContextCalls).toHaveLength(0);
  });
});
