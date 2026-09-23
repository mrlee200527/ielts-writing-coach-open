import { createHash } from "node:crypto";

import { uuidSchema } from "../domain/shared/ids";
import {
  BlobPortError,
  type BlobMetadata,
  type BlobMetadataResult,
  type BlobDeleteResult,
  type BlobPort,
  type BlobPutResult,
  type BlobReadResult,
} from "../ports/blob.port";

interface StoredBlob {
  bytes: Uint8Array;
  metadata: BlobMetadata;
}

function copyMetadata(metadata: BlobMetadata): BlobMetadata {
  return { ...metadata };
}

function assertBlobId(blobId: string): void {
  if (!uuidSchema.safeParse(blobId).success) throw new BlobPortError("INVALID_BLOB_ID");
}

export class InMemoryBlobFake implements BlobPort {
  readCount = 0;
  private readonly blobs = new Map<string, StoredBlob>();

  async put(input: { blobId: string; bytes: Uint8Array; metadata: BlobMetadata }): Promise<BlobPutResult> {
    assertBlobId(input.blobId);
    if (input.bytes.byteLength !== input.metadata.size) throw new BlobPortError("SIZE_MISMATCH");
    const actualHash = createHash("sha256").update(input.bytes).digest("hex");
    if (actualHash !== input.metadata.sha256) throw new BlobPortError("HASH_MISMATCH");

    const existing = this.blobs.get(input.blobId);
    if (existing) {
      const sameMetadata = existing.metadata.size === input.metadata.size
        && existing.metadata.mediaType === input.metadata.mediaType
        && existing.metadata.sha256 === input.metadata.sha256;
      const sameBytes = Buffer.from(existing.bytes).equals(Buffer.from(input.bytes));
      if (!sameMetadata || !sameBytes) throw new BlobPortError("CONTENT_CONFLICT");
      return { status: "ALREADY_EXISTS" };
    }

    this.blobs.set(input.blobId, { bytes: input.bytes.slice(), metadata: copyMetadata(input.metadata) });
    return { status: "CREATED" };
  }

  async read(blobId: string): Promise<BlobReadResult> {
    assertBlobId(blobId);
    this.readCount += 1;
    const blob = this.blobs.get(blobId);
    return blob
      ? { status: "FOUND", bytes: blob.bytes.slice(), metadata: copyMetadata(blob.metadata) }
      : { status: "NOT_FOUND" };
  }

  async metadata(blobId: string): Promise<BlobMetadataResult> {
    assertBlobId(blobId);
    const blob = this.blobs.get(blobId);
    return blob ? { status: "FOUND", metadata: copyMetadata(blob.metadata) } : { status: "NOT_FOUND" };
  }

  async delete(blobId: string): Promise<BlobDeleteResult> {
    assertBlobId(blobId);
    return this.blobs.delete(blobId) ? { status: "DELETED" } : { status: "NOT_FOUND" };
  }
}
