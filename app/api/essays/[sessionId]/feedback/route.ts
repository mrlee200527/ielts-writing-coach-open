import { createFeedbackRouteHandlers } from "../../../../../src/presentation/writing/feedback-route-handlers";
import { getEssaySessionRepository, getTaskIntakeRepository } from "../../../../../src/infrastructure/database/repository-factory";
import { loadMiMoConfig } from "../../../../../src/infrastructure/llm/mimo-config";
import { MiMoClient } from "../../../../../src/infrastructure/llm/mimo-client";
import { MiMoEssayFeedbackAdapter } from "../../../../../src/infrastructure/llm/mimo-essay-feedback.adapter";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const config = loadMiMoConfig();
  return createFeedbackRouteHandlers({
    essayRepository: getEssaySessionRepository(),
    taskContextSource: getTaskIntakeRepository(),
    llm: new MiMoEssayFeedbackAdapter(new MiMoClient(config), config.model),
  }).request(sessionId);
}
