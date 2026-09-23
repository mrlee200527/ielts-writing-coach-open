import { describe, expect, it } from "vitest";
import { createFeedbackRouteHandlers } from "../../src/presentation/writing/feedback-route-handlers";
import type { EssaySessionRepository, WritingWorkspaceSnapshot } from "../../src/application/essay-session.repository";
import type { TaskContextResolution } from "../../src/application/task-intake/task-intake.repository";
import type { EssayFeedbackLlmResult } from "../../src/ports/essay-feedback-llm.port";
import { stableUuid } from "../../src/domain/shared/ids";
import { dynamicTaskContextFixture } from "../../src/testing/task-context-fixtures";

const sessionId = stableUuid("session");
const taskId = stableUuid("task");
const revisionId = stableUuid("revision");

const workspace: WritingWorkspaceSnapshot = {
  task: {
    id: taskId, promptText: "Describe the chart.", txtFileName: null, imagePlaceholderKind: "TASK_1_PENDING",
    imageBlobId: null, imageMediaType: null, imageSha256: null, intakeStatus: "READY",
    activeAttemptId: null, currentTaskContextVersionId: stableUuid("version"),
  },
  session: { id: sessionId, userId: stableUuid("user"), taskId, status: "DRAFT", currentRevisionId: revisionId, startedAt: "2026-08-14T00:00:00.000Z" },
  revision: { id: revisionId, sessionId, revisionNo: 1, plainText: "The chart rose steadily.", content: { type: "doc" }, wordCount: 152, textHash: "hash", createdAt: "2026-08-14T00:00:00.000Z" },
  timer: { elapsedMs: 0 },
};

const validFeedback = {
  overallBand: 6.5,
  criteria: { taskAchievement: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 },
  strengths: [
    "Task Achievement 做得很好。你已经抓住了总人口增长这一核心趋势。",
    "文章结构清楚，Overview 能帮助读者快速理解主要变化。",
  ],
  improvements: [
    '这里的 "a hundred-fold increase" 不够精确，建议改为 "over a hundred-fold increase"。',
    '冠词使用还可以更准确，例如检查 "the population" 前后的语境。',
  ],
  priorityImprovement: "优先提高数据表达的精确性，并保留英文数据与表达原样。",
};

const validTask2Feedback = {
  ...validFeedback,
  criteria: { taskResponse: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 },
};

function resolution(overrides: Partial<TaskContextResolution> = {}): TaskContextResolution {
  return {
    taskId,
    image: { blobId: stableUuid("blob"), mediaType: "image/png", sha256: "a".repeat(64) },
    processingStatus: "READY",
    taskContextVersionId: stableUuid("version"),
    taskContextVersion: 1,
    availability: "READY",
    context: dynamicTaskContextFixture,
    limitationCodes: [],
    publicLimitationMessages: [],
    ...overrides,
  };
}

function handlers(options: {
  missingWorkspace?: boolean;
  missingResolution?: boolean;
  resolutionOverride?: TaskContextResolution | undefined;
  llmResult?: EssayFeedbackLlmResult | undefined;
  workspaceOverride?: WritingWorkspaceSnapshot;
}) {
  const essayRepository = {
    findByClientRequestId: async () => undefined,
    create: async () => {},
    findWorkspace: async () => (options.missingWorkspace ? undefined : options.workspaceOverride ?? workspace),
    findMostRecentDraft: async () => undefined,
    findMutation: async () => undefined,
    saveRevision: async () => ({ status: "SAVED" as const, revision: workspace.revision }),
  } as EssaySessionRepository;
  const taskContextSource = {
    findResolution: async () => (options.missingResolution ? undefined : options.resolutionOverride ?? resolution()),
  };
  const llm = {
    execute: async () => ({ ok: false as const, code: "TERMINAL" as const }),
    executeEssayFeedback: async () => options.llmResult ?? { ok: true as const, value: validFeedback, model: "fixed", responseId: "r1" },
  };
  return createFeedbackRouteHandlers({ essayRepository, taskContextSource, llm });
}

describe("essay feedback API handlers", () => {
  it("returns 200 with feedback for a READY context without requiring a body", async () => {
    const response = await handlers({}).request(sessionId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.feedback).toMatchObject({ overallBand: 6.5, priorityImprovement: "优先提高数据表达的精确性，并保留英文数据与表达原样。" });
    expect(body).toMatchObject({ revisionId, textHash: "hash" });
  });

  it("returns 404 ESSAY_NOT_FOUND with a Chinese message and no stack", async () => {
    const response = await handlers({ missingWorkspace: true }).request(sessionId);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "ESSAY_NOT_FOUND", message: expect.stringMatching(/[\u4e00-\u9fff]/) });
    expect(JSON.stringify(body)).not.toContain("at ");
    expect(JSON.stringify(body)).not.toContain("Error:");
  });

  it("returns 409 TASK_CONTEXT_PENDING when the context is still processing", async () => {
    const response = await handlers({ resolutionOverride: resolution({ availability: "PENDING", context: null, processingStatus: "PROCESSING" }) }).request(sessionId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TASK_CONTEXT_PENDING" });
  });

  it("returns 422 TASK_CONTEXT_UNAVAILABLE when the context is unavailable", async () => {
    const response = await handlers({ resolutionOverride: resolution({ availability: "UNAVAILABLE", context: null, processingStatus: "FAILED" }) }).request(sessionId);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "TASK_CONTEXT_UNAVAILABLE" });
  });

  it.each(["NETWORK", "TIMEOUT"] as const)("returns 503 FEEDBACK_LLM_UNAVAILABLE for %s", async (code) => {
    const response = await handlers({ llmResult: { ok: false, code } }).request(sessionId);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "FEEDBACK_LLM_UNAVAILABLE" });
  });

  it.each(["REFUSAL", "INCOMPLETE", "INVALID_JSON", "INVALID_STRUCTURE", "TERMINAL"] as const)("returns 502 FEEDBACK_LLM_FAILED for %s", async (code) => {
    const response = await handlers({ llmResult: { ok: false, code } }).request(sessionId);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "FEEDBACK_LLM_FAILED" });
  });

  it("never leaks provider raw response or internal details in error bodies", async () => {
    const response = await handlers({ llmResult: { ok: false, code: "REFUSAL" } }).request(sessionId);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("output_text");
    expect(text).not.toContain("api.openai.com");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("at ");
  });

  it("returns Task 2 formal scoring with the independent Task Response rubric", async () => {
    const response = await handlers({
      workspaceOverride: { ...workspace, task: { ...workspace.task, imagePlaceholderKind: "TASK_2_NOT_REQUIRED" } },
      llmResult: { ok: true, value: validTask2Feedback, model: "fixed", responseId: "task2" },
    }).request(sessionId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.feedback.criteria).toMatchObject({ taskResponse: 6 });
    expect(body.feedback.criteria).not.toHaveProperty("taskAchievement");
    expect(body).toMatchObject({ revisionId, textHash: "hash" });
  });
});
