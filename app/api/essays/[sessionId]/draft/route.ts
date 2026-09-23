import { createEssayRouteHandlers } from "../../../../../src/presentation/writing/route-handlers";
import { getEssaySessionRepository } from "../../../../../src/infrastructure/database/repository-factory";

export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ sessionId: string }> }) { return createEssayRouteHandlers(getEssaySessionRepository()).save((await context.params).sessionId, request); }
