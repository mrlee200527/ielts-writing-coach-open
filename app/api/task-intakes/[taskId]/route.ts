import { createTaskIntakeRouteHandlers } from "../../../../src/presentation/task-intake/task-intake-route-handlers";
import { getTaskContextJobAdapter, getTaskImageBlobAdapter, getTaskIntakeRepository } from "../../../../src/infrastructure/database/repository-factory";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) { const { taskId } = await context.params; return createTaskIntakeRouteHandlers({ repository: getTaskIntakeRepository(), blobs: getTaskImageBlobAdapter(), jobs: getTaskContextJobAdapter() }).get(taskId); }
export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) { const { taskId } = await context.params; const url=new URL(request.url);if(url.searchParams.get("action")!=="retry")return Response.json({error:"INVALID_ACTION"},{status:400});return createTaskIntakeRouteHandlers({repository:getTaskIntakeRepository(),blobs:getTaskImageBlobAdapter(),jobs:getTaskContextJobAdapter()}).retry(taskId,request.headers.get("idempotency-key")??crypto.randomUUID()); }
