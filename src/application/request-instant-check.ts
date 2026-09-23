import type { EssaySessionRepository } from "./essay-session.repository";
import type { EssayFeedbackTaskContextSource } from "./request-essay-feedback";
import { certainFacts } from "../domain/task-context/fact-certainty";
import { candidateIssuesToVisibleIssues, normalizeCandidateIssues, type InstantCheck } from "../domain/feedback/instant-check.schema";
import { computeChangedSpan } from "../domain/feedback/changed-span";
import { buildOfficialRubricContext, type TargetBand } from "../domain/feedback/ielts-rubric";
import type { InstantCheckLLMPort } from "../ports/instant-check-llm.port";

export const instantCheckPromptVersion = "instant-check-v3";
type Input = { sessionId: string; requestId: string; revisionId: string; taskType: "TASK_1" | "TASK_2"; currentText: string; previousAnalyzedText: string; targetBand?: TargetBand; inspectFull?: boolean };
export type InstantCheckPipelineDiagnostic = {
  sessionId: string;
  requestId: string;
  taskId: string | null;
  processingStatus: string | null;
  availability: string | null;
  versionId: string | null;
  contextPresent: boolean;
  detectorEntered: boolean;
  detectorCandidateCount: number;
  gatekeeperCalled: boolean;
  showCount: number;
  holdCount: number;
  rejectCount: number;
  finalLastResult: InstantCheck["status"] | null;
  failureCode: string | null;
};
export async function requestInstantCheck(dependencies: { essayRepository: EssaySessionRepository; taskContextSource: EssayFeedbackTaskContextSource; llm: InstantCheckLLMPort; diagnostic?: (event: InstantCheckPipelineDiagnostic) => void }, input: Input): Promise<{ ok: true; feedback: InstantCheck } | { ok: false; code: string; diagnostic?: string }> {
  const diagnostic: InstantCheckPipelineDiagnostic = { sessionId: input.sessionId, requestId: input.requestId, taskId: null, processingStatus: null, availability: null, versionId: null, contextPresent: false, detectorEntered: false, detectorCandidateCount: 0, gatekeeperCalled: false, showCount: 0, holdCount: 0, rejectCount: 0, finalLastResult: null, failureCode: null };
  const finish = <T>(result: T, finalLastResult: InstantCheck["status"] | null, failureCode: string | null): T => {
    dependencies.diagnostic?.({ ...diagnostic, finalLastResult, failureCode });
    return result;
  };
  const workspace = await dependencies.essayRepository.findWorkspace(input.sessionId); if (!workspace) return finish({ ok: false as const, code: "ESSAY_NOT_FOUND" }, null, "ESSAY_NOT_FOUND");
  diagnostic.taskId = workspace.task.id;
  const actualType = workspace.task.imagePlaceholderKind === "TASK_2_NOT_REQUIRED" ? "TASK_2" : "TASK_1";
  if (actualType !== input.taskType) return finish({ ok: false as const, code: "TASK_TYPE_MISMATCH" }, null, "TASK_TYPE_MISMATCH");
  let taskContext = "Not applicable for Task 2.";
  if (actualType === "TASK_1") {
    const resolution = await dependencies.taskContextSource.findResolution(workspace.task.id);
    diagnostic.processingStatus = resolution?.processingStatus ?? null;
    diagnostic.availability = resolution?.availability ?? null;
    diagnostic.versionId = resolution?.taskContextVersionId ?? null;
    diagnostic.contextPresent = Boolean(resolution?.context);
    if (!resolution || resolution.availability === "PENDING") return finish({ ok: false as const, code: "TASK_CONTEXT_PENDING" }, null, "TASK_CONTEXT_PENDING");
    if (!resolution.context || resolution.availability === "UNAVAILABLE") return finish({ ok: false as const, code: "TASK_CONTEXT_UNAVAILABLE" }, null, "TASK_CONTEXT_UNAVAILABLE");
    taskContext = certainFacts({ context: resolution.context }).map((fact) => `- ${fact.statement}`).join("\n");
  }
  const targetBand = input.targetBand ?? "6.5";
  const span = input.inspectFull || !input.previousAnalyzedText
    ? { target: input.currentText, surroundingBefore: "", surroundingAfter: "" }
    : computeChangedSpan(input.previousAnalyzedText, input.currentText);
  const criteriaNames = actualType === "TASK_1"
    ? "Task Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy"
    : "Task Response, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy";
  const rubricContext = buildOfficialRubricContext(actualType, targetBand);
  const promptText = [
    "You are an IELTS Writing Coach.",
    "",
    "You receive:",
    "1. TASK",
    "2. TARGET BAND",
    "3. OFFICIAL IELTS RUBRIC CONTEXT",
    "4. FULL ESSAY CONTEXT",
    "5. INSPECTION TARGET",
    "6. SURROUNDING CONTEXT",
    "",
    "The FULL ESSAY is context only. Inspect the INSPECTION TARGET. Do not inspect untouched parts of the essay for unrelated old issues. Use SURROUNDING CONTEXT or the full essay only when needed to judge correctness.",
    "",
    "LANGUAGE ACCURACY:",
    "Report every clear grammar, spelling, word-formation, and lexical error in the INSPECTION TARGET. There is no issue-count limit. Do not suppress a real language error because it is minor or because other issues are more important. Do not treat a merely simpler expression as an error.",
    "",
    "IELTS COACHING:",
    "Using the selected TARGET BAND and the relevant official IELTS descriptors, selectively report higher-order issues in the INSPECTION TARGET that materially matter for the student's target. These may include task fulfilment, logic, coherence, development, comparison, precision, or repetition. Use judgment. Do not report stylistic preferences that do not meaningfully matter.",
    "",
    "COACHING STYLE:",
    "Do not rewrite the student's sentence. Do not provide a complete corrected sentence. Use a short Socratic hint that helps the student notice and correct the problem independently. If there is no reportable issue in the INSPECTION TARGET, return an empty issues array.",
    "",
    `Task type: ${actualType}`,
    `Task prompt: ${workspace.task.promptText}`,
    "Task Context:",
    taskContext,
    `Target band: ${targetBand}`,
    `Official IELTS rubric context (${criteriaNames}):`,
    rubricContext,
    "Full essay context (context only, do not inspect untouched parts):",
    input.currentText,
    `Previous baseline text: ${input.previousAnalyzedText || "(none)"}`,
    "Inspection target:",
    span.target,
    `Surrounding context:\n${span.surroundingBefore ? `Before: ${span.surroundingBefore}\n` : ""}${span.surroundingAfter ? `After: ${span.surroundingAfter}` : "After: (none)"}`,
  ].join("\n");
  diagnostic.detectorEntered = true;
  const result = await dependencies.llm.executeInstantCheck({ sessionId: input.sessionId, requestId: input.requestId, revisionId: input.revisionId, promptVersion: instantCheckPromptVersion, promptText });
  if (!result.ok) return finish(result, null, result.code);
  try {
    const detectorCandidates = normalizeCandidateIssues(result.value);
    diagnostic.detectorCandidateCount = detectorCandidates.issues.length;
    const candidates = candidateIssuesToVisibleIssues(detectorCandidates);
    if (candidates.issues.length === 0) return finish({ ok: true as const, feedback: candidates }, candidates.status, null);
    const gateCandidates = detectorCandidates.issues.map((candidate, index) => ({ ...candidate, fingerprint: candidates.issues[index].fingerprint }));
    const gatekeeperPrompt = [
      "You are the gatekeeper for real-time IELTS writing coaching. Review only the supplied candidate issues; do not find, add, rewrite, or expand issues.",
      `Target band: ${targetBand}`,
      "Core rule: SHOW only when leaving this issue unchanged has a realistic chance of preventing the student from reaching the target band and is worth interrupting their writing now.",
      "Use HOLD for a real improvement opportunity that is not worth interrupting now. Use REJECT for stylistic or synonym preference, unnecessary sophistication or rewriting, a valid expression, or an invented issue.",
      "A higher target band never makes a merely more advanced alternative into an issue. Every category, severity and confidence is only evidence and never bypasses this judgment.",
      "If the student's claim directly contradicts an explicit reliable Task Context fact, do not REJECT it merely to avoid interruption; such a confirmed factual contradiction should normally be SHOW. Do not apply this rule when the Task Context is uncertain, approximate, ambiguous, or missing.",
      "Return one decision for each supplied fingerprint and no others. Allowed decisions: SHOW, HOLD, REJECT.",
      `Task type: ${actualType}`,
      "Necessary Task Context facts:", taskContext,
      "Current inspection target:", span.target,
      "Candidate issues:", JSON.stringify(gateCandidates),
    ].join("\n");
    const gatekeeper = dependencies.llm.executeInstantCheckGatekeeper;
    if (!gatekeeper) return finish({ ok: false as const, code: "TERMINAL" }, null, "TERMINAL");
    diagnostic.gatekeeperCalled = true;
    const gateResult = await gatekeeper.call(dependencies.llm, { sessionId: input.sessionId, requestId: input.requestId, revisionId: input.revisionId, promptVersion: "instant-check-gatekeeper-v1", promptText: gatekeeperPrompt });
    if (!gateResult.ok) return finish(gateResult, null, gateResult.code);
    const candidateByFingerprint = new Map(detectorCandidates.issues.map((candidate, index) => [candidates.issues[index].fingerprint, candidate]));
    const seen = new Set<string>();
    const invalidDecision = gateResult.decisions.length !== candidateByFingerprint.size || gateResult.decisions.some((decision) => {
      const candidate = candidateByFingerprint.get(decision.fingerprint);
      if (!candidate || seen.has(decision.fingerprint)) return true;
      seen.add(decision.fingerprint);
      return (candidate.kind === "language_error" || candidate.kind === "confirmed_error") && decision.decision === "HOLD";
    }) || seen.size !== candidateByFingerprint.size;
    if (invalidDecision) return finish({ ok: false as const, code: "INVALID_GATEKEEPER_RESULT" }, null, "INVALID_GATEKEEPER_RESULT");
    diagnostic.showCount = gateResult.decisions.filter((decision) => decision.decision === "SHOW").length;
    diagnostic.holdCount = gateResult.decisions.filter((decision) => decision.decision === "HOLD").length;
    diagnostic.rejectCount = gateResult.decisions.filter((decision) => decision.decision === "REJECT").length;
    const known = new Set(candidates.issues.map((candidate) => candidate.fingerprint));
    const show = new Set(gateResult.decisions.filter((decision) => known.has(decision.fingerprint) && decision.decision === "SHOW").map((decision) => decision.fingerprint));
    const issues = candidates.issues.filter((candidate) => show.has(candidate.fingerprint));
    const feedback: InstantCheck = { status: issues.length ? "issues_found" : "no_high_value_issue", issues };
    return finish({ ok: true as const, feedback }, feedback.status, null);
  } catch (error) {
    console.warn("[instant-check] invalid model structure", error instanceof Error ? error.message : "UNKNOWN_STRUCTURE");
    return finish({ ok: false as const, code: "INVALID_STRUCTURE" }, null, "INVALID_STRUCTURE");
  }
}
