import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createTaskIntake } from "../../src/application/task-intake/create-task-intake";
import { InMemoryTaskIntakeRepository } from "../../src/testing/in-memory-task-intake.repository";
import { InMemoryBlobFake } from "../../src/testing/in-memory-blob.fake";
import { ControlledJobFake } from "../../src/testing/controlled-job.fake";
import { stableUuid } from "../../src/domain/shared/ids";

const image = new Uint8Array([137, 80, 78, 71]);

describe("create task intake", () => {
  it("stores an opaque blob, commits intake, then queues exactly once", async () => {
    const repository = new InMemoryTaskIntakeRepository();
    const blobs = new InMemoryBlobFake();
    const jobs = new ControlledJobFake();
    const input = { requestIdempotencyKey: "request-1", userId: stableUuid("user"), promptText: null, imageBytes: image, mediaType: "image/png" as const, now: new Date("2026-08-14T06:00:00Z") };
    const first = await createTaskIntake({ repository, blobs, jobs }, input);
    const replay = await createTaskIntake({ repository, blobs, jobs }, input);
    expect(replay.workspace.session.id).toBe(first.workspace.session.id);
    expect(replay.workspace.task.imageBlobId).toBe(first.workspace.task.imageBlobId);
    expect(replay.attempt.id).toBe(first.attempt.id);
    expect(repository.createCount).toBe(1);
    expect(jobs.enqueueCount).toBe(1);
    expect(first.workspace.task).toMatchObject({
      imageMediaType: "image/png",
      imageSha256: createHash("sha256").update(image).digest("hex"),
      intakeStatus: "QUEUED",
    });
    expect(first.workspace.task.imageBlobId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("deletes only a newly created unreferenced blob after database failure", async () => {
    const repository = new InMemoryTaskIntakeRepository();
    repository.failNextCreate = true;
    const blobs = new InMemoryBlobFake();
    await expect(createTaskIntake({ repository, blobs, jobs: new ControlledJobFake() }, {
      requestIdempotencyKey: "request-fail", userId: stableUuid("user"), promptText: "Prompt", imageBytes: image,
      mediaType: "image/png", now: new Date("2026-08-14T06:00:00Z"), blobId: stableUuid("orphan"),
    })).rejects.toThrow("CREATE_INTAKE_FAILED");
    await expect(blobs.metadata(stableUuid("orphan"))).resolves.toEqual({ status: "NOT_FOUND" });
    expect(repository.blobReferenceChecks).toEqual([stableUuid("orphan")]);
  });

  it("keeps the committed intake UPLOADED when enqueue fails", async () => {
    const repository = new InMemoryTaskIntakeRepository();
    const jobs = new ControlledJobFake();
    jobs.failNextEnqueue = true;
    const result = await createTaskIntake({ repository, blobs: new InMemoryBlobFake(), jobs }, {
      requestIdempotencyKey: "request-job-fail", userId: stableUuid("user"), promptText: null,
      imageBytes: image, mediaType: "image/png", now: new Date("2026-08-14T06:00:00Z"),
    });
    expect(result.workspace.task.intakeStatus).toBe("UPLOADED");
    expect((await repository.findAttempt(result.workspace.task.id, result.attempt.id))?.workspace.task.intakeStatus).toBe("UPLOADED");
  });

  it("rejects empty or unsupported images before writing", async () => {
    const repository = new InMemoryTaskIntakeRepository();
    const blobs = new InMemoryBlobFake();
    await expect(createTaskIntake({ repository, blobs, jobs: new ControlledJobFake() }, {
      requestIdempotencyKey: "bad", userId: stableUuid("user"), promptText: null,
      imageBytes: new Uint8Array(), mediaType: "image/png", now: new Date(),
    })).rejects.toThrow("INVALID_IMAGE_SIZE");
    expect(repository.createCount).toBe(0);
  });
});
