import { createTaskImageRouteHandler } from "../../../../src/presentation/task-intake/task-intake-route-handlers";
import { getTaskImageBlobAdapter, getTaskIntakeRepository } from "../../../../src/infrastructure/database/repository-factory";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ blobId: string }> }) { const { blobId } = await context.params; return createTaskImageRouteHandler(getTaskIntakeRepository(), getTaskImageBlobAdapter())(blobId); }
