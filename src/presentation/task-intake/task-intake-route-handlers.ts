import { randomUUID } from "node:crypto";
import { createTaskIntake } from "../../application/task-intake/create-task-intake";
import { getTaskIntake } from "../../application/task-intake/get-task-intake";
import type { TaskIntakeRepository } from "../../application/task-intake/task-intake.repository";
import { uuidSchema } from "../../domain/shared/ids";
import type { BlobPort, AllowedTaskImageType } from "../../ports/blob.port";
import type { JobPort } from "../../ports/job.port";
import { retryTaskIntake } from "../../application/task-intake/retry-task-intake";

export const developmentUserId = "00000000-0000-4000-8000-000000000100";
const json = (body: unknown, status: number) => Response.json(body, { status });
const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
function validMagic(type: string, bytes: Uint8Array) { if (type === "image/png") return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value); if(type === "image/jpeg") return bytes[0]===255&&bytes[1]===216&&bytes[2]===255; if(type === "image/webp") return String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP"; return false; }

export function createTaskIntakeRouteHandlers(dependencies: { repository: TaskIntakeRepository; blobs: BlobPort; jobs: JobPort }, now: () => Date = () => new Date()) {
  return {
    create: async (request: Request) => {
      let form: FormData; try { form = await request.formData(); } catch { return json({ error: "INVALID_MULTIPART" }, 400); }
      const images = form.getAll("image"); if (images.length !== 1 || !(images[0] instanceof File)) return json({ error: "IMAGE_REQUIRED" }, 400);
      const file = images[0]; if (file.size === 0) return json({ error: "EMPTY_IMAGE" }, 400); if (file.size > 10*1024*1024) return json({ error: "IMAGE_TOO_LARGE" }, 413);
      if (!allowed.has(file.type)) return json({ error: "UNSUPPORTED_IMAGE_TYPE" }, 415); const bytes = new Uint8Array(await file.arrayBuffer()); if (!validMagic(file.type, bytes)) return json({ error: "IMAGE_SIGNATURE_MISMATCH" }, 415);
      const promptValue = form.get("promptText"); const txtFileNameValue = form.get("txtFileName"); const requestValue = form.get("clientRequestId");
      try { const result = await createTaskIntake(dependencies, { requestIdempotencyKey: typeof requestValue === "string" && requestValue ? requestValue : randomUUID(), userId: developmentUserId, promptText: typeof promptValue === "string" && promptValue.trim() ? promptValue.trim() : null, txtFileName: typeof txtFileNameValue === "string" ? txtFileNameValue : null, imageBytes: bytes, mediaType: file.type as AllowedTaskImageType, now: now() }); return json({ sessionId: result.workspace.session.id, taskId: result.workspace.task.id, status: result.workspace.task.intakeStatus, imageUrl: `/api/task-images/${result.workspace.task.imageBlobId}` }, 201); }
      catch { return json({ error: "TASK_INTAKE_UNAVAILABLE" }, 503); }
    },
    get: async (taskId: string) => { try { const value = await getTaskIntake(dependencies.repository, taskId); return value ? json(value, 200) : json({ error: "TASK_INTAKE_NOT_FOUND" }, 404); } catch { return json({ error: "TASK_INTAKE_UNAVAILABLE" }, 503); } },
    retry: async (taskId: string, requestIdempotencyKey: string) => { try { const current=await dependencies.repository.findResolution(taskId);if(!current)return json({error:"TASK_INTAKE_NOT_FOUND"},404);if(current.availability==="READY")return json({error:"TASK_CONTEXT_ALREADY_READY"},409);const record=await retryTaskIntake({repository:dependencies.repository,jobs:dependencies.jobs},{taskId,requestIdempotencyKey});return json({taskId,attemptId:record.attempt.id,status:record.workspace.task.intakeStatus},202);}catch{return json({error:"TASK_INTAKE_UNAVAILABLE"},503);} },
  };
}

export function createTaskImageRouteHandler(repository: TaskIntakeRepository, blobs: BlobPort) {
  return async (blobId: string) => {
    if (!uuidSchema.safeParse(blobId).success) return json({ error: "INVALID_BLOB_ID" }, 400);
    try { if (!(await repository.findAccessibleTaskByBlobId(blobId, developmentUserId))) return json({ error: "TASK_IMAGE_NOT_FOUND" }, 404); const result = await blobs.read(blobId); if (result.status === "NOT_FOUND") return json({ error: "TASK_IMAGE_NOT_FOUND" }, 404); const body = new ArrayBuffer(result.bytes.byteLength); new Uint8Array(body).set(result.bytes); return new Response(body, { status: 200, headers: { "Content-Type": result.metadata.mediaType, ETag: `"${result.metadata.sha256}"`, "Cache-Control": "private, no-store" } }); }
    catch { return json({ error: "TASK_IMAGE_UNAVAILABLE" }, 503); }
  };
}
