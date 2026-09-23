import type { EssaySessionRepository } from "../../application/essay-session.repository";
import { createEssaySessionUseCase } from "../../application/create-essay-session";
import { getWritingWorkspace } from "../../application/get-writing-workspace";
import { saveEssayDraft } from "../../application/save-essay-draft";
import { createEssayRequestSchema, saveDraftRequestSchema } from "./workspace.types";

export const developmentUserId = "00000000-0000-4000-8000-000000000100";
const json = (body: unknown, status: number) => Response.json(body, { status });
const parseJson = async (request: Request): Promise<unknown | undefined> => {
  try { return await request.json(); }
  catch { return undefined; }
};

export function createEssayRouteHandlers(repository: EssaySessionRepository, now: () => Date = () => new Date()) {
  return {
    create: async (request: Request) => {
      const parsed = createEssayRequestSchema.safeParse(await parseJson(request));
      if (!parsed.success) return json({ error: "INVALID_REQUEST" }, 400);
      try {
        const created = await createEssaySessionUseCase(repository, { ...parsed.data, userId: developmentUserId, now: now() });
        return json({ sessionId: created.session.id }, 201);
      } catch { return json({ error: "STORAGE_UNAVAILABLE" }, 503); }
    },
    get: async (sessionId: string) => {
      try { const workspace = await getWritingWorkspace(repository, sessionId); return workspace ? json(workspace, 200) : json({ error: "ESSAY_NOT_FOUND" }, 404); }
      catch { return json({ error: "STORAGE_UNAVAILABLE" }, 503); }
    },
    save: async (sessionId: string, request: Request) => {
      const parsed = saveDraftRequestSchema.safeParse(await parseJson(request));
      if (!parsed.success) return json({ error: "INVALID_REQUEST" }, 400);
      try {
        const result = await saveEssayDraft(repository, { sessionId, ...parsed.data, now: now() });
        return result.status === "REVISION_CONFLICT" ? json(result, 409) : json(result, 200);
      } catch (error) {
        if (error instanceof Error && error.message === "ESSAY_NOT_FOUND") return json({ error: "ESSAY_NOT_FOUND" }, 404);
        return json({ error: "STORAGE_UNAVAILABLE" }, 503);
      }
    },
  };
}
