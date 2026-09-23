import type { InstantIssue } from "./instant-check-controller";

export type InstantEvidenceLocation = Pick<InstantIssue, "fingerprint" | "type" | "severity"> & {
  from: number;
  to: number;
};

export type InstantFeedbackTone = "red" | "orange" | "blue" | "green";
export function instantFeedbackTone(type: InstantIssue["type"]): InstantFeedbackTone {
  if (type === "positive" || type === "clarity") return "green";
  if (type === "task_accuracy" || type === "task_relevance" || type === "comparison") return "red";
  if (type === "vocabulary" || type === "spelling") return "blue";
  return "orange";
}

export function locateInstantEvidence(text: string, issues: readonly InstantIssue[]): InstantEvidenceLocation[] {
  return issues.flatMap((issue) => {
    if (!issue.targetText) return [];
    const from = text.indexOf(issue.targetText);
    if (from < 0 || text.indexOf(issue.targetText, from + 1) >= 0) return [];
    return [{ fingerprint: issue.fingerprint, type: issue.type, severity: issue.severity, from, to: from + issue.targetText.length }];
  });
}
