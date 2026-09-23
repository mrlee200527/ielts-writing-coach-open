import { z } from "zod";

export const instantCheckModelIssueSchema = z.object({
  type: z.enum(["grammar", "spelling", "vocabulary", "task_accuracy", "task_relevance", "comparison", "clarity", "positive"]),
  subtype: z.string().min(1),
  severity: z.enum(["high", "medium", "low"]),
  targetText: z.string(),
  labelEn: z.string().min(1),
  messageZh: z.string().min(1),
  kind: z.enum(["language_error", "confirmed_error", "ielts_coaching"]),
}).strict();

export const instantCheckModelOutputSchema = z.object({
  status: z.enum(["issues_found", "no_high_value_issue"]),
  issues: z.array(instantCheckModelIssueSchema),
}).strict().superRefine((value, context) => {
  if (value.status === "no_high_value_issue" && value.issues.length !== 0) context.addIssue({ code: "custom", message: "NO_HIGH_VALUE_ISSUE_REQUIRES_EMPTY_ARRAY" });
  if (value.status === "issues_found" && value.issues.length === 0) context.addIssue({ code: "custom", message: "ISSUES_FOUND_REQUIRES_ITEMS" });
});

const issueJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["type", "subtype", "severity", "targetText", "labelEn", "messageZh", "kind"],
  properties: {
    type: { enum: ["grammar", "spelling", "vocabulary", "task_accuracy", "task_relevance", "comparison", "clarity", "positive"] },
    subtype: { type: "string" },
    severity: { enum: ["high", "medium", "low"] },
    targetText: { type: "string" },
    labelEn: { type: "string" },
    messageZh: { type: "string" },
    kind: { enum: ["language_error", "confirmed_error", "ielts_coaching"] },
  },
} as const;

export const instantCheckOutputJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["status", "issues"],
  properties: {
    status: { enum: ["issues_found", "no_high_value_issue"] },
    issues: { type: "array", items: issueJsonSchema },
  },
} as const;
