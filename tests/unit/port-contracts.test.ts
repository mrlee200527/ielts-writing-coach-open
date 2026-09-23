import { describe, expect, it } from "vitest";
import { ControlledLlmFake } from "../../src/testing/controlled-llm.fake";
import { ControlledJobFake } from "../../src/testing/controlled-job.fake";
import { InMemoryStorageFake } from "../../src/testing/in-memory-storage.fake";
import { InMemoryBlobFake } from "../../src/testing/in-memory-blob.fake";
import { ControlledTaskContextLlmFake } from "../../src/testing/controlled-task-context-llm.fake";
import { stableUuid } from "../../src/domain/shared/ids";
import { createHash } from "node:crypto";

describe("port doubles", () => {
  it("pauses and releases LLM calls out of order", async () => {
    const llm = new ControlledLlmFake();
    const first = llm.execute({ task: "SENTENCE", fixtureId: "first", promptVersion: "v1", inputHash: "h1" });
    const second = llm.execute({ task: "PARAGRAPH", fixtureId: "second", promptVersion: "v1", inputHash: "h2" });
    llm.succeed("second", { issues: [] });
    await expect(second).resolves.toMatchObject({ ok: true });
    llm.fail("first", "TIMEOUT");
    await expect(first).resolves.toEqual({ ok: false, code: "TIMEOUT" });
  });

  it("deduplicates jobs and permits controlled completion", async () => {
    const jobs = new ControlledJobFake();
    const first = jobs.enqueue({ name: "sentence-check", idempotencyKey: "same", payload: { fixtureId: "a" } });
    const duplicate = jobs.enqueue({ name: "sentence-check", idempotencyKey: "same", payload: { fixtureId: "a" } });
    expect(first.id).toBe(duplicate.id);
    jobs.start(first.id);
    jobs.complete(first.id, { analysisId: "analysis-1" });
    expect(jobs.status(first.id)).toMatchObject({ state: "COMPLETED" });
  });

  it("rolls back failed storage transactions", async () => {
    const storage = new InMemoryStorageFake();
    await expect(storage.transaction(async (transaction) => {
      transaction.put("revisions", "r1", { revisionNo: 1 });
      throw new Error("fail");
    })).rejects.toThrow("fail");
    expect(storage.get("revisions", "r1")).toBeUndefined();
  });

  it("keeps the existing sentence and paragraph LLM contract unchanged", async () => {
    const llm = new ControlledLlmFake();
    const pending = llm.execute({ task: "SENTENCE", fixtureId: "legacy", promptVersion: "v1", inputHash: "hash" });
    llm.succeed("legacy", { feedback: [] });
    await expect(pending).resolves.toEqual({ ok: true, value: { feedback: [] } });
  });

  it("uses a separate production-shaped task context operation", async () => {
    const llm = new ControlledTaskContextLlmFake();
    const request = {
      attemptId: stableUuid("attempt"),
      correlationId: stableUuid("correlation"),
      promptVersion: "task-context-v1",
      schemaVersion: 1 as const,
      inputHash: "input-hash",
      image: { mediaType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) },
      promptText: null,
      mode: "ANALYZE" as const,
    };
    expect(request).not.toHaveProperty("fixtureId");
    const pending = llm.executeTaskContext(request);
    llm.succeed(request.correlationId, { schemaVersion: 1 }, "fixed-model", "response-1");
    await expect(pending).resolves.toMatchObject({ ok: true, model: "fixed-model", responseId: "response-1" });
  });

  it("provides stable idempotent blob semantics and defensive reads", async () => {
    const blobs = new InMemoryBlobFake();
    const blobId = stableUuid("blob");
    const bytes = new Uint8Array([1, 2, 3]);
    const metadata = {
      size: bytes.byteLength,
      mediaType: "image/png" as const,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    await expect(blobs.put({ blobId, bytes, metadata })).resolves.toEqual({ status: "CREATED" });
    await expect(blobs.put({ blobId, bytes, metadata })).resolves.toEqual({ status: "ALREADY_EXISTS" });
    bytes[0] = 9;
    const read = await blobs.read(blobId);
    expect(read).toMatchObject({ status: "FOUND", metadata });
    if (read.status === "FOUND") {
      expect(read.bytes).toEqual(new Uint8Array([1, 2, 3]));
      read.bytes[0] = 8;
    }
    const reread = await blobs.read(blobId);
    expect(reread.status === "FOUND" && reread.bytes).toEqual(new Uint8Array([1, 2, 3]));
    await expect(blobs.put({ blobId, bytes: new Uint8Array([4]), metadata: {
      size: 1,
      mediaType: "image/png",
      sha256: createHash("sha256").update(new Uint8Array([4])).digest("hex"),
    } })).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    await expect(blobs.metadata(stableUuid("missing"))).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(blobs.read(stableUuid("missing"))).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(blobs.delete(blobId)).resolves.toEqual({ status: "DELETED" });
    await expect(blobs.delete(blobId)).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("rejects invalid blob identifiers and inconsistent metadata", async () => {
    const blobs = new InMemoryBlobFake();
    const bytes = new Uint8Array([1]);
    await expect(blobs.read("not-a-uuid")).rejects.toMatchObject({ code: "INVALID_BLOB_ID" });
    await expect(blobs.put({
      blobId: stableUuid("size-mismatch"),
      bytes,
      metadata: { size: 2, mediaType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex") },
    })).rejects.toMatchObject({ code: "SIZE_MISMATCH" });
    await expect(blobs.put({
      blobId: stableUuid("hash-mismatch"),
      bytes,
      metadata: { size: 1, mediaType: "image/png", sha256: "0".repeat(64) },
    })).rejects.toMatchObject({ code: "HASH_MISMATCH" });
  });
});
