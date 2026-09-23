import { createEssayRouteHandlers } from "../../../../src/presentation/writing/route-handlers";
import { getEssaySessionRepository } from "../../../../src/infrastructure/database/repository-factory";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) { return createEssayRouteHandlers(getEssaySessionRepository()).get((await context.params).sessionId); }
