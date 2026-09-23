import { z } from "zod";
import { requestInstantCheck } from "../../application/request-instant-check";
import type { EssaySessionRepository } from "../../application/essay-session.repository";
import type { EssayFeedbackTaskContextSource } from "../../application/request-essay-feedback";
import type { InstantCheckLLMPort } from "../../ports/instant-check-llm.port";
import type { InstantCheckPipelineDiagnostic } from "../../application/request-instant-check";
const bodySchema = z.object({ requestId: z.string().min(1), revisionId: z.string().min(1), taskType: z.enum(["TASK_1", "TASK_2"]), currentText: z.string(), previousAnalyzedText: z.string(), targetBand: z.enum(["6.0", "6.5", "7.0", "7.5"]).optional(), inspectFull: z.boolean().optional() }).strict();
export function createInstantCheckRouteHandler(deps: { essayRepository: EssaySessionRepository; taskContextSource: EssayFeedbackTaskContextSource; llm: InstantCheckLLMPort; diagnostic?: (event: InstantCheckPipelineDiagnostic) => void }) { return async (sessionId: string, request: Request) => { let json: unknown; try { json = await request.json(); } catch { return Response.json({ error: "INVALID_REQUEST" }, { status: 400 }); } const body = bodySchema.safeParse(json); if (!body.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 }); try { const result = await requestInstantCheck(deps, { sessionId, ...body.data }); if (result.ok) return Response.json({ feedback: result.feedback }, { status: 200 }); const status = result.code === "ESSAY_NOT_FOUND" ? 404 : result.code.includes("TASK_CONTEXT") ? 409 : 502;
  console.warn("[instant-check] request failed", { code: result.code, diagnostic: result.diagnostic, sessionId, revisionId: body.data.revisionId });
  return Response.json({ error: result.code, diagnostic: result.diagnostic, message: status === 502 ? "即时检查暂时不可用，写作不会受到影响。" : "题目信息尚未准备好。" }, { status }); } catch (error) {
  console.error("[instant-check] unexpected failure", { sessionId, revisionId: body.data.revisionId, error });
  return Response.json({ error: "INSTANT_CHECK_UNAVAILABLE", message: "即时检查暂时不可用，写作不会受到影响。" }, { status: 503 }); } }; }
