import { z } from "zod";

export const instantIssueSchema = z.object({
  type: z.enum(["grammar", "spelling", "vocabulary", "task_accuracy", "task_relevance", "comparison", "clarity", "positive"]),
  subtype: z.string().min(1), severity: z.enum(["high", "medium", "low"]), targetText: z.string(),
  messageZh: z.string().min(1), labelEn: z.string().min(1), fingerprint: z.string().min(1),
  kind: z.enum(["language_error", "confirmed_error", "ielts_coaching"]),
}).strict();
export const instantCheckSchema = z.object({ status: z.enum(["issues_found", "no_high_value_issue"]), issues: z.array(instantIssueSchema) }).strict().superRefine((value, context) => {
  if (value.status === "no_high_value_issue" && value.issues.length > 0) context.addIssue({ code: "custom", message: "NO_ISSUE_STATUS_MUST_BE_EMPTY" });
  if (value.status === "issues_found" && value.issues.length === 0) context.addIssue({ code: "custom", message: "ISSUES_FOUND_MUST_NOT_BE_EMPTY" });
});
export type InstantCheck = z.infer<typeof instantCheckSchema>;
export const parseInstantCheck = (value: unknown) => instantCheckSchema.parse(value);

const modelIssueSchema = instantIssueSchema
  .omit({ fingerprint: true, kind: true })
  .extend({ fingerprint: z.string().min(1).optional(), kind: z.enum(["language_error", "confirmed_error", "ielts_coaching"]) })
  .strict();
export type CandidateIssue = z.infer<typeof modelIssueSchema> & { detectorEvidence: string };
export type CandidateIssues = { status: "issues_found" | "no_high_value_issue"; issues: CandidateIssue[] };

function stableFingerprint(value: Omit<z.infer<typeof modelIssueSchema>, "fingerprint">) {
  const source = `${value.type}|${value.subtype}|${value.targetText}|${value.labelEn}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `instant-${(hash >>> 0).toString(16)}`;
}

function coachingQuestion(type: InstantCheck["issues"][number]["type"], subtype: string) {
  const detail = subtype.toLowerCase();
  if (detail.includes("tense")) return "描述这个时间点时，这里的时态合适吗？";
  if (detail.includes("agreement") || detail.includes("subject-verb")) return "这里的主谓一致是不是需要再检查一下？";
  if (detail.includes("repeat") || detail.includes("repetition")) return "这处表达在附近是否出现得有点频繁，可以看看是否需要变化吗？";
  const questions: Record<InstantCheck["issues"][number]["type"], string> = {
    grammar: "这里的语法形式是否和句子的主语、时间及结构保持一致？",
    spelling: "这个词的拼写是不是需要再检查一下？",
    vocabulary: "这里的用词是否准确、自然，并避免了不必要的重复？",
    task_accuracy: "这处表述是否与题图中的数据和趋势完全一致？",
    task_relevance: "这句话与题目要求或当前论点之间的关系是否足够清楚？",
    comparison: "这里的比较对象和差异是否表达得足够明确？",
    clarity: "读者能否清楚理解这句话的逻辑和指代？",
    positive: "这一处已经比较清楚，后文是否也能保持同样的表达质量？",
  };
  return questions[type];
}

export function normalizeInstantCheck(value: unknown): InstantCheck {
  return candidateIssuesToVisibleIssues(normalizeCandidateIssues(value));
}
export function normalizeCandidateIssues(value: unknown): CandidateIssues {
  const envelope = z.object({ status: z.enum(["issues_found", "no_high_value_issue"]), issues: z.array(modelIssueSchema) }).strict().superRefine((candidate, context) => {
    if (candidate.status === "no_high_value_issue" && candidate.issues.length !== 0) context.addIssue({ code: "custom", message: "NO_HIGH_VALUE_ISSUE_REQUIRES_EMPTY_ARRAY" });
    if (candidate.status === "issues_found" && candidate.issues.length === 0) context.addIssue({ code: "custom", message: "ISSUES_FOUND_REQUIRES_ITEMS" });
  }).parse(value);
  return { status: envelope.status, issues: envelope.issues.map((issue) => ({ ...issue, detectorEvidence: issue.messageZh })) };
}
export function candidateIssuesToVisibleIssues(candidates: CandidateIssues): InstantCheck {
  const issues = candidates.issues.map(({ detectorEvidence: _detectorEvidence, ...data }) => ({ ...data, messageZh: coachingQuestion(data.type, data.subtype), fingerprint: data.fingerprint ?? stableFingerprint(data) }));
  return parseInstantCheck({ status: candidates.status, issues });
}
