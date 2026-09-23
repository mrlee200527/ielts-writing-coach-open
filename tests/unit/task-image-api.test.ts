import { describe, expect, it } from "vitest";
import { createTaskImageRouteHandler } from "../../src/presentation/task-intake/task-intake-route-handlers";
import { InMemoryTaskIntakeRepository } from "../../src/testing/in-memory-task-intake.repository";
import { InMemoryBlobFake } from "../../src/testing/in-memory-blob.fake";
import { stableUuid } from "../../src/domain/shared/ids";
import { createHash } from "node:crypto";

describe("task image API", () => {
  it("does not read an existing blob without an accessible writing task reference", async () => {
    const blobs = new InMemoryBlobFake(); const blobId = stableUuid("orphan-api"); const bytes = new Uint8Array([1]);
    await blobs.put({ blobId, bytes, metadata: { size: 1, mediaType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex") } });
    const response = await createTaskImageRouteHandler(new InMemoryTaskIntakeRepository(), blobs)(blobId);
    expect(response.status).toBe(404);
    expect(blobs.readCount).toBe(0);
  });
  it("returns 400 for invalid UUID before repository access", async () => {
    const response = await createTaskImageRouteHandler(new InMemoryTaskIntakeRepository(), new InMemoryBlobFake())("../escape");
    expect(response.status).toBe(400);
  });
});
