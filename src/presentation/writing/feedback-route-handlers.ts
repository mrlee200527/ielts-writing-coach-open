import type { EssaySessionRepository } from "../../application/essay-session.repository";
import type { EssayFeedbackTaskContextSource } from "../../application/request-essay-feedback";
import { requestEssayFeedback } from "../../application/request-essay-feedback";
import type { EssayFeedbackLLMPort } from "../../ports/essay-feedback-llm.port";

const userMessages = {
  ESSAY_NOT_FOUND: "作文会话不存在，请返回首页重新开始。",
  TASK_CONTEXT_PENDING: "题图仍在分析中，请稍后再试。",
  TASK_CONTEXT_UNAVAILABLE: "题图暂时无法识别，无法生成反馈。",
  FEEDBACK_STALE: "正文已更新，请重新获取反馈。",
  FEEDBACK_LLM_UNAVAILABLE: "反馈服务暂时不可用，请稍后再试。",
  FEEDBACK_LLM_FAILED: "反馈生成失败，请稍后重试。",
} as const;

const json = (body: unknown, status: number) => Response.json(body, { status });

export function createFeedbackRouteHandlers(dependencies: {
  essayRepository: EssaySessionRepository;
  taskContextSource: EssayFeedbackTaskContextSource;
  llm: EssayFeedbackLLMPort;
}) {
  return {
    request: async (sessionId: string) => {
      try {
        const result = await requestEssayFeedback(dependencies, { sessionId });
        if (result.ok) return json({ feedback: result.feedback, revisionId: result.revisionId, textHash: result.textHash }, 200);
        switch (result.code) {
          case "ESSAY_NOT_FOUND":
            return json({ error: "ESSAY_NOT_FOUND", message: userMessages.ESSAY_NOT_FOUND }, 404);
          case "TASK_CONTEXT_PENDING":
            return json({ error: "TASK_CONTEXT_PENDING", message: userMessages.TASK_CONTEXT_PENDING }, 409);
          case "TASK_CONTEXT_UNAVAILABLE":
            return json({ error: "TASK_CONTEXT_UNAVAILABLE", message: userMessages.TASK_CONTEXT_UNAVAILABLE }, 422);
          case "STALE":
            return json({ error: "FEEDBACK_STALE", message: userMessages.FEEDBACK_STALE }, 409);
          case "NETWORK":
          case "TIMEOUT":
            return json({ error: "FEEDBACK_LLM_UNAVAILABLE", message: userMessages.FEEDBACK_LLM_UNAVAILABLE }, 503);
          default:
            return json({ error: "FEEDBACK_LLM_FAILED", message: userMessages.FEEDBACK_LLM_FAILED }, 502);
        }
      } catch {
        return json({ error: "FEEDBACK_LLM_UNAVAILABLE", message: userMessages.FEEDBACK_LLM_UNAVAILABLE }, 503);
      }
    },
  };
}
