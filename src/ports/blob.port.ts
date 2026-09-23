export const allowedTaskImageTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedTaskImageType = (typeof allowedTaskImageTypes)[number];

export interface BlobMetadata {
  size: number;
  mediaType: AllowedTaskImageType;
  sha256: string;
}

export type BlobPutResult = { status: "CREATED" } | { status: "ALREADY_EXISTS" };
export type BlobReadResult =
  | { status: "FOUND"; bytes: Uint8Array; metadata: BlobMetadata }
  | { status: "NOT_FOUND" };
export type BlobMetadataResult = { status: "FOUND"; metadata: BlobMetadata } | { status: "NOT_FOUND" };
export type BlobDeleteResult = { status: "DELETED" } | { status: "NOT_FOUND" };
export type BlobPortErrorCode =
  | "INVALID_BLOB_ID"
  | "SIZE_MISMATCH"
  | "HASH_MISMATCH"
  | "CONTENT_CONFLICT"
  | "BLOB_UNAVAILABLE";

export class BlobPortError extends Error {
  constructor(readonly code: BlobPortErrorCode) {
    super(code);
    this.name = "BlobPortError";
  }
}

export interface BlobPort {
  put(input: { blobId: string; bytes: Uint8Array; metadata: BlobMetadata }): Promise<BlobPutResult>;
  read(blobId: string): Promise<BlobReadResult>;
  metadata(blobId: string): Promise<BlobMetadataResult>;
  delete(blobId: string): Promise<BlobDeleteResult>;
}
