import { createInstantCheckRouteHandler } from "../../../../../src/presentation/writing/instant-check-route-handlers";
import { getEssaySessionRepository, getTaskIntakeRepository } from "../../../../../src/infrastructure/database/repository-factory";
import { loadMiMoConfig } from "../../../../../src/infrastructure/llm/mimo-config";
import { MiMoClient } from "../../../../../src/infrastructure/llm/mimo-client";
import { MiMoInstantCheckAdapter } from "../../../../../src/infrastructure/llm/mimo-instant-check.adapter";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) { const { sessionId } = await context.params; const config = loadMiMoConfig(); return createInstantCheckRouteHandler({ essayRepository: getEssaySessionRepository(), taskContextSource: getTaskIntakeRepository(), llm: new MiMoInstantCheckAdapter(new MiMoClient(config), config.model), diagnostic: (event) => console.info(`[instant-check] pipeline diagnostic ${JSON.stringify(event)}`) })(sessionId, request); }
