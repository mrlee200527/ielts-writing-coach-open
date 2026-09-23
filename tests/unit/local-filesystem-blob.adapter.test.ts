import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalFilesystemBlobAdapter } from "../../src/infrastructure/blob/local-filesystem-blob.adapter";
import { stableUuid } from "../../src/domain/shared/ids";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("local filesystem blob adapter", () => {
  it("persists idempotently across adapter reconnects", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-blobs-")); roots.push(root);
    const blobId = stableUuid("filesystem-blob");
    const bytes = new Uint8Array([1, 2, 3]);
    const metadata = { size: 3, mediaType: "image/png" as const, sha256: createHash("sha256").update(bytes).digest("hex") };
    const first = new LocalFilesystemBlobAdapter(root);
    await expect(first.put({ blobId, bytes, metadata })).resolves.toEqual({ status: "CREATED" });
    const reopened = new LocalFilesystemBlobAdapter(root);
    await expect(reopened.put({ blobId, bytes, metadata })).resolves.toEqual({ status: "ALREADY_EXISTS" });
    await expect(reopened.read(blobId)).resolves.toMatchObject({ status: "FOUND", metadata });
  });

  it("rejects traversal IDs and content conflicts with stable codes", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-blobs-")); roots.push(root);
    const adapter = new LocalFilesystemBlobAdapter(root);
    await expect(adapter.read("../escape")).rejects.toMatchObject({ code: "INVALID_BLOB_ID" });
    const blobId = stableUuid("conflict");
    const first = new Uint8Array([1]);
    await adapter.put({ blobId, bytes: first, metadata: { size: 1, mediaType: "image/png", sha256: createHash("sha256").update(first).digest("hex") } });
    const second = new Uint8Array([2]);
    await expect(adapter.put({ blobId, bytes: second, metadata: { size: 1, mediaType: "image/png", sha256: createHash("sha256").update(second).digest("hex") } })).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    await expect(adapter.delete(blobId)).resolves.toEqual({ status: "DELETED" });
    await expect(adapter.delete(blobId)).resolves.toEqual({ status: "NOT_FOUND" });
  });
});
