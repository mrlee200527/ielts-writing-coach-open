import { describe, expect, it } from "vitest";
import { essayFeedbackPromptVersion, requestEssayFeedback } from "../../src/application/request-essay-feedback";
import type { EssaySessionRepository, WritingWorkspaceSnapshot } from "../../src/application/essay-session.repository";
import type { TaskContextResolution } from "../../src/application/task-intake/task-intake.repository";
import type { EssayFeedbackLlmResult } from "../../src/ports/essay-feedback-llm.port";
import { stableUuid } from "../../src/domain/shared/ids";
import { dynamicTaskContextFixture } from "../../src/testing/task-context-fixtures";

const sessionId = stableUuid("session");
const taskId = stableUuid("task");
const taskContextVersionId = stableUuid("version");
const revisionId = stableUuid("revision");

const workspace: WritingWorkspaceSnapshot = {
  task: {
    id: taskId, promptText: "Describe the chart.", txtFileName: null, imagePlaceholderKind: "TASK_1_PENDING",
    imageBlobId: null, imageMediaType: null, imageSha256: null, intakeStatus: "READY",
    activeAttemptId: null, currentTaskContextVersionId: taskContextVersionId,
  },
  session: { id: sessionId, userId: stableUuid("user"), taskId, status: "DRAFT", currentRevisionId: revisionId, startedAt: "2026-08-14T00:00:00.000Z" },
  revision: { id: revisionId, sessionId, revisionNo: 1, plainText: "The chart rose steadily over the period.", content: { type: "doc" }, wordCount: 152, textHash: "text-hash", createdAt: "2026-08-14T00:00:00.000Z" },
  timer: { elapsedMs: 0 },
};

const validFeedback = {
  overallBand: 6.5,
  criteria: { taskAchievement: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 },
  strengths: ["Task Achievement 做得很好。你已经抓住了总人口增长这一核心趋势。", "文章结构清楚，Overview 能帮助读者快速理解主要变化。"],
  improvements: ["这里的 \"a hundred-fold increase\" 不够精确，建议改为 \"over a hundred-fold increase\"。", "冠词使用还可以更准确，例如检查 \"the population\" 前后的语境。"],
  priorityImprovement: "优先提高数据表达的精确性，并保留英文数据与表达原样。",
};

const degradedContext = {
  ...dynamicTaskContextFixture,
  facts: dynamicTaskContextFixture.facts.map((fact, index) =>
    index === 2 ? { ...fact, statement: "The exact end value is unclear.", certainty: "UNCERTAIN" as const, uncertaintyCategory: "TIME_RANGE_AMBIGUOUS" as const } : fact,
  ),
  limitations: ["TIME_RANGE_UNCLEAR" as const],
};

function baseResolution(overrides: Partial<TaskContextResolution> = {}): TaskContextResolution {
  return {
    taskId,
    image: { blobId: stableUuid("blob"), mediaType: "image/png", sha256: "a".repeat(64) },
    processingStatus: "READY",
    taskContextVersionId,
    taskContextVersion: 1,
    availability: "READY",
    context: dynamicTaskContextFixture,
    limitationCodes: [],
    publicLimitationMessages: [],
    ...overrides,
  };
}

function fakeDependencies(options: {
  missingWorkspace?: boolean;
  workspaceOverride?: WritingWorkspaceSnapshot | undefined;
  missingResolution?: boolean;
  resolution?: TaskContextResolution | undefined;
  llmResult?: EssayFeedbackLlmResult | undefined;
}) {
  const calls: Array<{ sessionId: string; promptVersion: string; inputHash: string; promptText: string }> = [];
  const essayRepository = {
    findByClientRequestId: async () => undefined,
    create: async () => {},
    findWorkspace: async () => (options.missingWorkspace ? undefined : options.workspaceOverride ?? workspace),
    findMostRecentDraft: async () => undefined,
    findMutation: async () => undefined,
    saveRevision: async () => ({ status: "SAVED" as const, revision: workspace.revision }),
  } as EssaySessionRepository;
  const taskContextSource = {
    findResolution: async () => (options.missingResolution ? undefined : options.resolution ?? baseResolution()),
  } as {
    findResolution(taskId: string): Promise<TaskContextResolution | undefined>;
  };
  const llm = {
    execute: async () => ({ ok: false as const, code: "TERMINAL" as const }),
    executeEssayFeedback: async (request: { sessionId: string; promptVersion: string; inputHash: string; promptText: string }) => {
      calls.push(request);
      return options.llmResult ?? { ok: true as const, value: validFeedback, model: "fixed", responseId: "r1" };
    },
  };
  return { essayRepository, taskContextSource, llm, calls };
}

describe("request essay feedback use case", () => {
  it.each(["6.0", "6.5", "7.0", "7.5"])("does not vary examiner request construction for UI target band %s", async (targetBand) => {
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({});
    const first = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    const firstRequest = calls[0];
    const second = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(firstRequest).toEqual(calls[1]);
    expect(firstRequest).not.toHaveProperty("targetBand");
    expect(JSON.stringify(firstRequest)).not.toContain(targetBand);
  });
  it("builds a CERTAIN-only prompt and returns parsed feedback on READY context", async () => {
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({});
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.feedback.overallBand).toBe(6.5);
    expect(result).toMatchObject({ revisionId, textHash: "text-hash" });
    expect(result.model).toBe("fixed");
    expect(calls).toHaveLength(1);
    const prompt = calls[0].promptText;
    for (const statement of ["The chart covers 2000 to 2020.", "The blue line represents City A.", "City A increased over the period."]) {
      expect(prompt).toContain(statement);
    }
    expect(calls[0].promptVersion).toBe(essayFeedbackPromptVersion);
    expect(calls[0].inputHash).toMatch(/^sha256:/);
    expect(prompt).toContain("不得因题图信息受限而扣分或判错");
    expect(prompt).toContain("解释、评价、原因、修改建议和教学提示必须使用简体中文");
    expect(prompt).toContain("Task Achievement");
    expect(prompt).toContain("英文修改");
    expect(prompt).toContain("不得输出内部 reason code、limitation code 或 schema enum");
  });

  it("returns the current autosaved revision as the feedback owner", async () => {
    const autosavedRevision = { ...workspace.revision, id: stableUuid("autosaved-revision"), revisionNo: 2, textHash: "autosaved-text-hash", createdAt: "2026-08-14T00:01:00.000Z" };
    const autosavedWorkspace = { ...workspace, session: { ...workspace.session, currentRevisionId: autosavedRevision.id }, revision: autosavedRevision };
    const { essayRepository, taskContextSource, llm } = fakeDependencies({ workspaceOverride: autosavedWorkspace });
    await expect(requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId })).resolves.toMatchObject({ ok: true, revisionId: autosavedRevision.id, textHash: "autosaved-text-hash" });
  });

  it("returns stale when a newer revision is saved while the LLM is in flight", async () => {
    const newerRevision = { ...workspace.revision, id: stableUuid("newer-revision"), revisionNo: 2, plainText: "The chart rose, then levelled off.", textHash: "newer-text-hash" };
    let currentWorkspace = workspace;
    let resolveLlm!: (result: EssayFeedbackLlmResult) => void;
    let signalLlmStarted!: () => void;
    const llmStarted = new Promise<void>((resolve) => { signalLlmStarted = resolve; });
    const essayRepository = {
      findByClientRequestId: async () => undefined,
      create: async () => {},
      findWorkspace: async () => currentWorkspace,
      findMostRecentDraft: async () => undefined,
      findMutation: async () => undefined,
      saveRevision: async () => ({ status: "SAVED" as const, revision: workspace.revision }),
    } as EssaySessionRepository;
    const llm = {
      execute: async () => ({ ok: false as const, code: "TERMINAL" as const }),
      executeEssayFeedback: async () => new Promise<EssayFeedbackLlmResult>((resolve) => { resolveLlm = resolve; signalLlmStarted(); }),
    };

    const pending = requestEssayFeedback({ essayRepository, taskContextSource: { findResolution: async () => baseResolution() }, llm }, { sessionId });
    await llmStarted;
    currentWorkspace = { ...workspace, session: { ...workspace.session, currentRevisionId: newerRevision.id }, revision: newerRevision };
    resolveLlm({ ok: true, value: validFeedback, model: "fixed", responseId: "late" });

    await expect(pending).resolves.toEqual({ ok: false, code: "STALE" });
  });

  it("never feeds UNCERTAIN statement text into the prompt and includes limitation codes on DEGRADED", async () => {
    const resolution = baseResolution({ availability: "DEGRADED", context: degradedContext, limitationCodes: ["TIME_RANGE_UNCLEAR"] });
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({ resolution });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result.ok).toBe(true);
    const prompt = calls[0].promptText;
    expect(prompt).not.toContain("The exact end value is unclear.");
    expect(prompt).toContain("TIME_RANGE_UNCLEAR");
    expect(prompt).toContain("The chart covers 2000 to 2020.");
  });

  it("blocks on PENDING context without calling the LLM", async () => {
    const resolution = baseResolution({ availability: "PENDING", context: null, processingStatus: "PROCESSING" });
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({ resolution });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result).toEqual({ ok: false, code: "TASK_CONTEXT_PENDING" });
    expect(calls).toHaveLength(0);
  });

  it("blocks on missing resolution without calling the LLM", async () => {
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({ missingResolution: true });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result).toEqual({ ok: false, code: "TASK_CONTEXT_PENDING" });
    expect(calls).toHaveLength(0);
  });

  it("blocks on UNAVAILABLE context without calling the LLM", async () => {
    const resolution = baseResolution({ availability: "UNAVAILABLE", context: null, processingStatus: "FAILED", limitationCodes: ["IMAGE_UNREADABLE"] });
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({ resolution });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result).toEqual({ ok: false, code: "TASK_CONTEXT_UNAVAILABLE" });
    expect(calls).toHaveLength(0);
  });

  it("returns ESSAY_NOT_FOUND when the session does not exist", async () => {
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({ missingWorkspace: true });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result).toEqual({ ok: false, code: "ESSAY_NOT_FOUND" });
    expect(calls).toHaveLength(0);
  });

  it("maps domain schema validation failures to INVALID_STRUCTURE (owner: use case)", async () => {
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({ llmResult: { ok: true, value: { ...validFeedback, overallBand: 6.3 }, model: "fixed", responseId: "r1" } });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
    expect(calls).toHaveLength(1);
  });

  it("rejects an English-only assessment report at the normalization boundary", async () => {
    const englishOnly = { ...validFeedback, strengths: ["Task Achievement is strong."], improvements: ["Use over a hundred-fold increase."], priorityImprovement: "Improve data accuracy." };
    const { essayRepository, taskContextSource, llm } = fakeDependencies({ llmResult: { ok: true, value: englishOnly, model: "fixed", responseId: "english" } });
    expect(await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId })).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it("preserves English evidence and recommended expressions inside Chinese coaching", async () => {
    const { essayRepository, taskContextSource, llm } = fakeDependencies({});
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.feedback.improvements[0]).toContain('"a hundred-fold increase"');
    expect(result.feedback.improvements[0]).toContain('"over a hundred-fold increase"');
    expect(result.feedback.strengths[0]).toContain("Task Achievement");
  });

  it("rejects internal reason, limitation, or schema codes from user-visible coaching", async () => {
    const leaked = { ...validFeedback, improvements: ["这里需要修改，因为 TASK_TYPE_AMBIGUOUS。"] };
    const { essayRepository, taskContextSource, llm } = fakeDependencies({ llmResult: { ok: true, value: leaked, model: "fixed", responseId: "leaked" } });
    expect(await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId })).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it.each(["TIMEOUT", "NETWORK", "INVALID_JSON", "INVALID_STRUCTURE", "REFUSAL", "INCOMPLETE", "TERMINAL"] as const)("propagates LLM failure code %s", async (code) => {
    const { essayRepository, taskContextSource, llm } = fakeDependencies({ llmResult: { ok: false, code } });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result).toEqual({ ok: false, code });
  });

  it("allows feedback requests under 150 words without blocking", async () => {
    const shortWorkspace = { ...workspace, revision: { ...workspace.revision, plainText: "Short.", wordCount: 2 } };
    const { essayRepository, taskContextSource, llm, calls } = fakeDependencies({ workspaceOverride: shortWorkspace });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].promptText).toContain("Short.");
  });

  it("uses an independent Task 2 rubric and does not request Task 1 image context", async () => {
    const task2Workspace = { ...workspace, task: { ...workspace.task, promptText: "To what extent do you agree?", imagePlaceholderKind: "TASK_2_NOT_REQUIRED" as const }, revision: { ...workspace.revision, plainText: "I strongly agree because access matters.", wordCount: 7 } };
    const task2Feedback = { ...validFeedback, criteria: { taskResponse: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 } };
    let contextCalls = 0;
    const { essayRepository, llm, calls } = fakeDependencies({ workspaceOverride: task2Workspace, llmResult: { ok: true, value: task2Feedback, model: "fixed", responseId: "task2" } });
    const result = await requestEssayFeedback({ essayRepository, taskContextSource: { findResolution: async () => { contextCalls += 1; return undefined; } }, llm }, { sessionId });

    expect(result.ok).toBe(true);
    expect(contextCalls).toBe(0);
    expect(calls[0].promptText).toContain("IELTS Academic Writing Task 2");
    expect(calls[0].promptText).toContain("Task Response");
    expect(calls[0].promptText).not.toContain("Task Achievement");
    expect(calls[0].promptText).toContain("To what extent do you agree?");
    expect(calls[0].promptText).toContain("解释、评价、原因、修改建议和教学提示必须使用简体中文");
  });

  it("rejects a Task 1 rubric returned for a Task 2 request", async () => {
    const task2Workspace = { ...workspace, task: { ...workspace.task, imagePlaceholderKind: "TASK_2_NOT_REQUIRED" as const } };
    const { essayRepository, taskContextSource, llm } = fakeDependencies({ workspaceOverride: task2Workspace });

    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });

    expect(result).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it("rejects a Task 2 rubric returned for a Task 1 request", async () => {
    const task2Feedback = { ...validFeedback, criteria: { taskResponse: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 } };
    const { essayRepository, taskContextSource, llm } = fakeDependencies({ llmResult: { ok: true, value: task2Feedback, model: "fixed", responseId: "wrong-rubric" } });

    const result = await requestEssayFeedback({ essayRepository, taskContextSource, llm }, { sessionId });

    expect(result).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });
});
