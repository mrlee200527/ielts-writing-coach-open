import { describe, expect, it } from "vitest";
import { createTaskIntakeRouteHandlers } from "../../src/presentation/task-intake/task-intake-route-handlers";
import { InMemoryTaskIntakeRepository } from "../../src/testing/in-memory-task-intake.repository";
import { InMemoryBlobFake } from "../../src/testing/in-memory-blob.fake";
import { ControlledJobFake } from "../../src/testing/controlled-job.fake";

function request(file?: File, promptText?: string) { const form = new FormData(); if (file) form.append("image", file); if (promptText) form.append("promptText", promptText); form.append("clientRequestId", "api-request"); return new Request("http://local/api/task-intakes", { method: "POST", body: form }); }

describe("task intake API", () => {
  it("accepts one valid PNG and returns only stable public fields", async () => {
    const handler = createTaskIntakeRouteHandlers({ repository: new InMemoryTaskIntakeRepository(), blobs: new InMemoryBlobFake(), jobs: new ControlledJobFake() });
    const response = await handler.create(request(new File([new Uint8Array([137,80,78,71,13,10,26,10])], "task.png", { type: "image/png" }), "Describe"));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ sessionId: expect.any(String), taskId: expect.any(String), status: "QUEUED", imageUrl: expect.stringMatching(/^\/api\/task-images\//) });
  });
  it("uses stable validation statuses", async () => {
    const handler = createTaskIntakeRouteHandlers({ repository: new InMemoryTaskIntakeRepository(), blobs: new InMemoryBlobFake(), jobs: new ControlledJobFake() });
    expect((await handler.create(request())).status).toBe(400);
    expect((await handler.create(request(new File([], "empty.png", { type: "image/png" })))).status).toBe(400);
    expect((await handler.create(request(new File([new Uint8Array([1,2,3])], "bad.png", { type: "image/png" })))).status).toBe(415);
    expect((await handler.create(request(new File([new Uint8Array([1])], "bad.gif", { type: "image/gif" })))).status).toBe(415);
  });
  it("returns 409 when retrying an already ready task", async()=>{const repository=new InMemoryTaskIntakeRepository();const handler=createTaskIntakeRouteHandlers({repository,blobs:new InMemoryBlobFake(),jobs:new ControlledJobFake()});const created=await handler.create(request(new File([new Uint8Array([137,80,78,71,13,10,26,10])],"task.png",{type:"image/png"})));const body=await created.json();const record=await repository.findByRequestIdempotencyKey("api-request");if(!record)throw new Error();await repository.claimAttempt({taskId:body.taskId,attemptId:record.attempt.id,inputHash:record.attempt.inputHash,idempotencyKey:record.attempt.idempotencyKey});await repository.publishAcceptedAttempt({taskId:body.taskId,attemptId:record.attempt.id,inputHash:record.attempt.inputHash,status:"READY",context:(await import("../../src/testing/task-context-fixtures")).dynamicTaskContextFixture,sourceImageSha256:record.workspace.task.imageSha256!,promptVersion:"task-context-v1",model:"fixed",limitations:[],createdAt:new Date()});expect((await handler.retry(body.taskId,"retry-key")).status).toBe(409);});
});
