import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { uuidSchema } from "../../domain/shared/ids";
import { BlobPortError, type BlobMetadata, type BlobPort } from "../../ports/blob.port";

export class LocalFilesystemBlobAdapter implements BlobPort {
  constructor(private readonly root: string) {}
  private paths(id: string) { if (!uuidSchema.safeParse(id).success) throw new BlobPortError("INVALID_BLOB_ID"); return { data: join(this.root, `${id}.blob`), meta: join(this.root, `${id}.json`) }; }
  async put(input: Parameters<BlobPort["put"]>[0]) {
    const paths = this.paths(input.blobId); if (input.bytes.length !== input.metadata.size) throw new BlobPortError("SIZE_MISMATCH");
    if (createHash("sha256").update(input.bytes).digest("hex") !== input.metadata.sha256) throw new BlobPortError("HASH_MISMATCH");
    const existing = await this.read(input.blobId); if (existing.status === "FOUND") { if (existing.metadata.sha256 === input.metadata.sha256 && Buffer.from(existing.bytes).equals(Buffer.from(input.bytes))) return { status: "ALREADY_EXISTS" as const }; throw new BlobPortError("CONTENT_CONFLICT"); }
    await mkdir(this.root, { recursive: true }); const suffix = randomUUID(); const dataTmp = `${paths.data}.${suffix}.tmp`; const metaTmp = `${paths.meta}.${suffix}.tmp`;
    try { await writeFile(dataTmp, input.bytes); await writeFile(metaTmp, JSON.stringify(input.metadata)); await rename(dataTmp, paths.data); await rename(metaTmp, paths.meta); return { status: "CREATED" as const }; }
    catch { await rm(dataTmp, { force: true }); await rm(metaTmp, { force: true }); throw new BlobPortError("BLOB_UNAVAILABLE"); }
  }
  async read(id: string) { const paths = this.paths(id); try { const [bytes, metadata] = await Promise.all([readFile(paths.data), readFile(paths.meta, "utf8")]); return { status: "FOUND" as const, bytes: new Uint8Array(bytes), metadata: JSON.parse(metadata) as BlobMetadata }; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "NOT_FOUND" as const }; throw new BlobPortError("BLOB_UNAVAILABLE"); } }
  async metadata(id: string) { const result = await this.read(id); return result.status === "FOUND" ? { status: "FOUND" as const, metadata: result.metadata } : result; }
  async delete(id: string) { const paths = this.paths(id); const found = await this.metadata(id); if (found.status === "NOT_FOUND") return { status: "NOT_FOUND" as const }; try { await Promise.all([rm(paths.data, { force: true }), rm(paths.meta, { force: true })]); return { status: "DELETED" as const }; } catch { throw new BlobPortError("BLOB_UNAVAILABLE"); } }
}
