import { createTaskIntakeRouteHandlers } from "../../../src/presentation/task-intake/task-intake-route-handlers";
import { getTaskContextJobAdapter, getTaskImageBlobAdapter, getTaskIntakeRepository } from "../../../src/infrastructure/database/repository-factory";

export const runtime = "nodejs";
export function POST(request: Request) { return createTaskIntakeRouteHandlers({ repository: getTaskIntakeRepository(), blobs: getTaskImageBlobAdapter(), jobs: getTaskContextJobAdapter() }).create(request); }
