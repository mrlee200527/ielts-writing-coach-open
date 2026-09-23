import type { EssaySessionRepository } from "./essay-session.repository";
import type { TaskContextResolution } from "./task-intake/task-intake.repository";
import type { TaskContext } from "../domain/task-context/task-context.schema";
import { certainFacts } from "../domain/task-context/fact-certainty";
import type { EssayFeedbackLLMPort } from "../ports/essay-feedback-llm.port";
import { parseEssayFeedback, type EssayFeedback } from "../domain/feedback/essay-feedback.schema";
import { stableHash } from "../domain/shared/hash";

export interface EssayFeedbackTaskContextSource {
  findResolution(taskId: string): Promise<TaskContextResolution | undefined>;
}

export const essayFeedbackPromptVersion = "essay-feedback-v1";
export const task2EssayFeedbackPromptVersion = "essay-feedback-task2-v1";

const userVisibleLanguageContract = (taskCriterion: "Task Achievement" | "Task Response") => [
  "【用户可见语言规则】",
  "解释、评价、原因、修改建议和教学提示必须使用简体中文，整体语气像中文 IELTS 写作老师讲评作文。",
  `IELTS 官方维度名称可保留英文，例如 ${taskCriterion}、Coherence and Cohesion。`,
  "学生作文原文引用、单词、短语、collocation、推荐替换、修改后的示范句和必要数据必须保持英文或原样；采用中文讲解 + 英文修改，不要把英文修改建议整体翻译成中文。",
  "不得输出内部 reason code、limitation code 或 schema enum，例如 TASK_TYPE_AMBIGUOUS；不得向用户解释内部实现。",
].join("\n");

export type RequestEssayFeedbackError =
  | "ESSAY_NOT_FOUND"
  | "TASK_CONTEXT_PENDING"
  | "TASK_CONTEXT_UNAVAILABLE"
  | "INVALID_STRUCTURE"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_JSON"
  | "REFUSAL"
  | "INCOMPLETE"
  | "TERMINAL"
  | "STALE";

export type RequestEssayFeedbackResult =
  | { ok: true; feedback: EssayFeedback; revisionId: string; textHash: string; model: string; responseId: string }
  | { ok: false; code: RequestEssayFeedbackError };

export async function requestEssayFeedback(
  dependencies: {
    essayRepository: EssaySessionRepository;
    taskContextSource: EssayFeedbackTaskContextSource;
    llm: EssayFeedbackLLMPort;
  },
  input: { sessionId: string },
): Promise<RequestEssayFeedbackResult> {
  const workspace = await dependencies.essayRepository.findWorkspace(input.sessionId);
  if (!workspace) return { ok: false, code: "ESSAY_NOT_FOUND" };
  const taskType = workspace.task.imagePlaceholderKind === "TASK_2_NOT_REQUIRED" ? "TASK_2" : "TASK_1";
  let promptText: string;
  if (taskType === "TASK_2") {
    promptText = buildTask2FeedbackPrompt({ taskPrompt: workspace.task.promptText, essayText: workspace.revision.plainText, wordCount: workspace.revision.wordCount });
  } else {
    const resolution = await dependencies.taskContextSource.findResolution(workspace.task.id);
    if (!resolution || resolution.availability === "PENDING") return { ok: false, code: "TASK_CONTEXT_PENDING" };
    if (resolution.availability === "UNAVAILABLE" || resolution.context === null) return { ok: false, code: "TASK_CONTEXT_UNAVAILABLE" };
    promptText = buildFeedbackPrompt({ context: resolution.context, certainStatements: certainFacts({ context: resolution.context }).map((fact) => fact.statement), limitationCodes: [...resolution.limitationCodes], essayText: workspace.revision.plainText, wordCount: workspace.revision.wordCount });
  }
  const promptVersion = taskType === "TASK_2" ? task2EssayFeedbackPromptVersion : essayFeedbackPromptVersion;
  const inputHash = stableHash({
    sessionId: input.sessionId,
    taskContextVersionId: workspace.task.currentTaskContextVersionId ?? "none",
    revisionId: workspace.revision.id,
    textHash: workspace.revision.textHash,
    promptVersion,
  });

  const llmResult = await dependencies.llm.executeEssayFeedback({
    sessionId: input.sessionId,
    promptVersion,
    taskType,
    inputHash,
    promptText,
  });
  if (!llmResult.ok) return { ok: false, code: llmResult.code };

  const currentWorkspace = await dependencies.essayRepository.findWorkspace(input.sessionId);
  if (!currentWorkspace) return { ok: false, code: "ESSAY_NOT_FOUND" };
  if (currentWorkspace.revision.id !== workspace.revision.id || currentWorkspace.revision.textHash !== workspace.revision.textHash) {
    return { ok: false, code: "STALE" };
  }

  try {
    const feedback = parseEssayFeedback(llmResult.value);
    const matchesTaskType = taskType === "TASK_2"
      ? "taskResponse" in feedback.criteria
      : "taskAchievement" in feedback.criteria;
    if (!matchesTaskType) return { ok: false, code: "INVALID_STRUCTURE" };
    if (!hasSafeChineseCoaching(feedback)) return { ok: false, code: "INVALID_STRUCTURE" };
    return { ok: true, feedback, revisionId: workspace.revision.id, textHash: workspace.revision.textHash, model: llmResult.model, responseId: llmResult.responseId };
  } catch {
    return { ok: false, code: "INVALID_STRUCTURE" };
  }
}

function hasSafeChineseCoaching(feedback: EssayFeedback): boolean {
  const visibleText = [...feedback.strengths, ...feedback.improvements, feedback.priorityImprovement];
  const internalCode = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/;
  return visibleText.every((text) => /\p{Script=Han}/u.test(text) && !internalCode.test(text));
}

function buildTask2FeedbackPrompt(input: { taskPrompt: string; essayText: string; wordCount: number }): string {
  return [
    "你是一位友好的 IELTS Academic Writing Task 2 写作教练。请依据 IELTS Academic Writing Task 2 标准给出一次性、非官方反馈。",
    "【Task 2 题目】", input.taskPrompt,
    `【作文（词数 ${input.wordCount}）】`, input.essayText,
    userVisibleLanguageContract("Task Response"),
    "请独立评估四项：Task Response、Coherence and Cohesion、Lexical Resource、Grammatical Range and Accuracy。给出非官方总分估计（0.5 步进）、四项分数、2-3 条优点、2-3 条改进建议和 1 条最优先改进项。",
  ].join("\n");
}

function buildFeedbackPrompt(input: {
  context: TaskContext;
  certainStatements: readonly string[];
  limitationCodes: readonly string[];
  essayText: string;
  wordCount: number;
}): string {
  const facts = input.certainStatements.map((statement) => `- ${statement}`).join("\n");
  const limitations = input.limitationCodes.length > 0 ? input.limitationCodes.join(", ") : "无";
  return [
    "你是一位友好的 IELTS Academic Writing Task 1 写作教练。请基于以下题图事实与作文，给出一份一次性、非官方的写作反馈。",
    "【题图事实（仅以下内容可作为事实依据）】",
    facts,
    "【题图受限信息】",
    limitations,
    "注意：题图信息可能存在不确定或缺失；不得因题图信息受限而扣分或判错。",
    `【作文（词数 ${input.wordCount}）】`,
    input.essayText,
    userVisibleLanguageContract("Task Achievement"),
    "请给出：非官方总分估计（0.5 步进）、IELTS 四项（任务完成度/连贯与衔接/词汇资源/语法范围与准确性）分数、2-3 条优点、2-3 条改进建议、1 条最优先改进项。",
  ].join("\n");
}
