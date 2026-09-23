import { createEssayRouteHandlers } from "../../../src/presentation/writing/route-handlers";
import { getEssaySessionRepository } from "../../../src/infrastructure/database/repository-factory";

export const runtime = "nodejs";
export function POST(request: Request) { return createEssayRouteHandlers(getEssaySessionRepository()).create(request); }
