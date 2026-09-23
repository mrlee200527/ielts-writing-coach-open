import { describe, expect, it, vi } from "vitest";
import { requestInstantCheck } from "../../src/application/request-instant-check";
import type { WritingWorkspaceSnapshot } from "../../src/application/essay-session.repository";
import { stableUuid } from "../../src/domain/shared/ids";
import { dynamicTaskContextFixture } from "../../src/testing/task-context-fixtures";
import { candidateIssuesToVisibleIssues, normalizeCandidateIssues } from "../../src/domain/feedback/instant-check.schema";
import type { InstantCheckGatekeeperResult } from "../../src/ports/instant-check-llm.port";

const taskId = stableUuid("instant-task"); const sessionId = stableUuid("instant-session");
const base: WritingWorkspaceSnapshot = {
  task: { id: taskId, promptText: "Describe the chart.", txtFileName: null, imagePlaceholderKind: "TASK_1_PENDING", imageBlobId: null, imageMediaType: null, imageSha256: null, intakeStatus: "READY", activeAttemptId: null, currentTaskContextVersionId: stableUuid("ctx") },
  session: { id: sessionId, userId: stableUuid("user"), taskId, status: "DRAFT", currentRevisionId: stableUuid("rev"), startedAt: new Date().toISOString() },
  revision: { id: stableUuid("rev"), sessionId, revisionNo: 1, plainText: "", content: { type: "doc" }, wordCount: 0, textHash: "hash", createdAt: new Date().toISOString() }, timer: { elapsedMs: 0 },
};
const issue = { type: "grammar", subtype: "tense", severity: "medium", targetText: "increases", messageZh: "这里描述过去，时态要不要检查一下？", labelEn: "Grammar · tense", fingerprint: "fp", kind: "language_error" };

type LlmInput = { promptText: string };
const captureLlm = (capture: (request: LlmInput) => void, result: unknown = { status: "no_high_value_issue", issues: [] }, gate?: (request: LlmInput) => Promise<InstantCheckGatekeeperResult>) => ({
  executeInstantCheck: async (request: LlmInput) => { capture(request); return { ok: true as const, value: result, model: "mimo", responseId: "r" }; },
  executeInstantCheckGatekeeper: async (request: LlmInput) => {
    if (gate) return gate(request);
    const candidates = JSON.parse(request.promptText.slice(request.promptText.lastIndexOf("Candidate issues:\n") + "Candidate issues:\n".length)) as Array<{ fingerprint: string }>;
    return { ok: true as const, decisions: candidates.map((candidate) => ({ fingerprint: candidate.fingerprint, decision: "SHOW" as const })), model: "mimo", responseId: "g" };
  },
});
const run = (overrides: { currentText: string; previousAnalyzedText?: string; taskType?: "TASK_1" | "TASK_2"; targetBand?: "6.0" | "6.5" | "7.0" | "7.5"; inspectFull?: boolean; llm?: ReturnType<typeof captureLlm>; task?: WritingWorkspaceSnapshot["task"]; capture?: (request: LlmInput) => void }) => requestInstantCheck({
  essayRepository: { findWorkspace: async () => ({ ...base, task: overrides.task ?? base.task }) } as never,
  taskContextSource: { findResolution: async () => ({ availability: "READY", context: dynamicTaskContextFixture, limitationCodes: [] }) } as never,
  llm: overrides.llm ?? captureLlm(overrides.capture ?? (() => undefined)),
}, { sessionId, requestId: "request-1", revisionId: "revision-client", taskType: overrides.taskType ?? "TASK_1", currentText: overrides.currentText, previousAnalyzedText: overrides.previousAnalyzedText ?? "", targetBand: overrides.targetBand, inspectFull: overrides.inspectFull });

describe("Instant Check pipeline diagnostics", () => {
  it("records context, Detector, Gatekeeper decisions and final result for one mixed round", async () => {
    const diagnostic = vi.fn();
    const stylistic = { ...issue, fingerprint: "style", type: "vocabulary", subtype: "synonym preference", targetText: "over the periods" };
    const llm = captureLlm(() => undefined, { status: "issues_found", issues: [issue, stylistic] }, async () => ({
      ok: true as const,
      decisions: [
        { fingerprint: issue.fingerprint, decision: "SHOW" as const },
        { fingerprint: stylistic.fingerprint, decision: "REJECT" as const },
      ],
      model: "mimo",
      responseId: "gate",
    }));

    const result = await requestInstantCheck({
      essayRepository: { findWorkspace: async () => base } as never,
      taskContextSource: { findResolution: async () => ({ processingStatus: "READY", availability: "READY", taskContextVersionId: stableUuid("ctx"), context: dynamicTaskContextFixture, limitationCodes: [] }) } as never,
      llm,
      diagnostic,
    }, { sessionId, requestId: "diagnostic-mixed", revisionId: "revision-client", taskType: "TASK_1", currentText: "The figure increases over the periods.", previousAnalyzedText: "" });

    expect(result.ok).toBe(true);
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledWith({
      sessionId,
      requestId: "diagnostic-mixed",
      taskId,
      processingStatus: "READY",
      availability: "READY",
      versionId: stableUuid("ctx"),
      contextPresent: true,
      detectorEntered: true,
      detectorCandidateCount: 2,
      gatekeeperCalled: true,
      showCount: 1,
      holdCount: 0,
      rejectCount: 1,
      finalLastResult: "issues_found",
      failureCode: null,
    });
  });

  it("records PENDING without entering Detector or Gatekeeper", async () => {
    const diagnostic = vi.fn();
    const detector = vi.fn();
    const result = await requestInstantCheck({
      essayRepository: { findWorkspace: async () => base } as never,
      taskContextSource: { findResolution: async () => ({ processingStatus: "PROCESSING", availability: "PENDING", taskContextVersionId: null, context: null, limitationCodes: [] }) } as never,
      llm: captureLlm(detector),
      diagnostic,
    }, { sessionId, requestId: "diagnostic-pending", revisionId: "revision-client", taskType: "TASK_1", currentText: "The chart rises.", previousAnalyzedText: "" });

    expect(result).toEqual({ ok: false, code: "TASK_CONTEXT_PENDING" });
    expect(detector).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      requestId: "diagnostic-pending",
      taskId,
      processingStatus: "PROCESSING",
      availability: "PENDING",
      versionId: null,
      contextPresent: false,
      detectorEntered: false,
      detectorCandidateCount: 0,
      gatekeeperCalled: false,
      showCount: 0,
      holdCount: 0,
      rejectCount: 0,
      finalLastResult: null,
      failureCode: "TASK_CONTEXT_PENDING",
    }));
  });
});

describe("requestInstantCheck v3 prompt architecture", () => {
  it("separates TASK, TARGET BAND, OFFICIAL RUBRIC, FULL ESSAY CONTEXT, INSPECTION TARGET and SURROUNDING CONTEXT", async () => {
    let prompt = "";
    await run({ currentText: "The population increased.", capture: (request) => { prompt = request.promptText; } });
    expect(prompt).toContain("TARGET BAND");
    expect(prompt).toContain("OFFICIAL IELTS RUBRIC CONTEXT");
    expect(prompt).toContain("FULL ESSAY CONTEXT");
    expect(prompt).toContain("INSPECTION TARGET");
    expect(prompt).toContain("SURROUNDING CONTEXT");
    expect(prompt).toContain("The FULL ESSAY is context only");
  });

  it("makes language accuracy exhaustive with no issue-count limit", async () => {
    let prompt = "";
    await run({ currentText: "The population increased.", capture: (request) => { prompt = request.promptText; } });
    expect(prompt).toContain("Report every clear grammar, spelling, word-formation, and lexical error in the INSPECTION TARGET");
    expect(prompt).toContain("There is no issue-count limit");
    expect(prompt).toContain("Do not suppress a real language error because it is minor");
    expect(prompt).toContain("Do not treat a merely simpler expression as an error");
  });

  it("makes IELTS coaching selective and target-band driven", async () => {
    let prompt = "";
    await run({ currentText: "The population increased.", targetBand: "7.0", capture: (request) => { prompt = request.promptText; } });
    expect(prompt).toContain("selectively report higher-order issues in the INSPECTION TARGET that materially matter for the student's target");
    expect(prompt).toContain("Do not report stylistic preferences that do not meaningfully matter");
    expect(prompt).toContain("Target band: 7.0");
  });

  it("uses the official rubric context for the selected band and task type without inventing meanings", async () => {
    let prompt = "";
    await run({ currentText: "The population increased.", targetBand: "6.5", capture: (request) => { prompt = request.promptText; } });
    expect(prompt).toContain("Task Achievement");
    expect(prompt).toContain("Band 6:");
    expect(prompt).toContain("Band 7:");
    expect(prompt.toLowerCase()).not.toContain("band 6.5");
  });

  it("keeps language accuracy rules identical across target bands", async () => {
    let promptLow = ""; let promptHigh = "";
    await run({ currentText: "These figure shows.", targetBand: "6.0", capture: (request) => { promptLow = request.promptText; } });
    await run({ currentText: "These figure shows.", targetBand: "7.5", capture: (request) => { promptHigh = request.promptText; } });
    const extract = (prompt: string) => prompt.slice(prompt.indexOf("LANGUAGE ACCURACY:"), prompt.indexOf("IELTS COACHING:"));
    expect(extract(promptLow)).toBe(extract(promptHigh));
    expect(promptLow).toContain("Target band: 6.0");
    expect(promptHigh).toContain("Target band: 7.5");
    expect(promptLow).not.toContain("Band 7:");
    expect(promptHigh).toContain("Band 7:");
    expect(promptHigh).toContain("Band 8:");
  });

  it("inspects only the changed span and treats the rest of the essay as context", async () => {
    let prompt = "";
    const previous = "The population of New York increased steadily.";
    const current = "The population of New York increased steadily. The chart show the figures of five district.";
    await run({ currentText: current, previousAnalyzedText: previous, capture: (request) => { prompt = request.promptText; } });
    const targetSection = prompt.slice(prompt.indexOf("Inspection target:"), prompt.indexOf("Surrounding context:"));
    expect(targetSection).toContain("The chart show the figures of five district.");
    expect(targetSection).not.toContain("The population of New York increased steadily.");
    expect(prompt).toContain("Surrounding context:");
    expect(prompt).toContain("Before: The population of New York increased steadily.");
    expect(prompt).toContain("Previous baseline text: The population of New York increased steadily.");
  });

  it("uses the whole essay as the inspection target for the final full-essay language check", async () => {
    let prompt = "";
    const previous = "Old sentence with a mistake.";
    const current = "Old sentence with a mistake. New sentence.";
    await run({ currentText: current, previousAnalyzedText: previous, inspectFull: true, capture: (request) => { prompt = request.promptText; } });
    const targetSection = prompt.slice(prompt.indexOf("Inspection target:"), prompt.indexOf("Surrounding context:"));
    expect(targetSection).toContain("Old sentence with a mistake.");
    expect(targetSection).toContain("New sentence.");
  });

  it("uses the whole text as the inspection target on the first analysis", async () => {
    let prompt = "";
    await run({ currentText: "The chart show five district.", previousAnalyzedText: "", capture: (request) => { prompt = request.promptText; } });
    const targetSection = prompt.slice(prompt.indexOf("Inspection target:"), prompt.indexOf("Surrounding context:"));
    expect(targetSection).toContain("The chart show five district.");
  });

  it("keeps Socratic coaching style and empty-array semantics", async () => {
    let prompt = "";
    await run({ currentText: "The population increased.", capture: (request) => { prompt = request.promptText; } });
    expect(prompt).toContain("Do not rewrite the student's sentence");
    expect(prompt).toContain("short Socratic hint");
    expect(prompt).toContain("return an empty issues array");
  });

  it("keeps Task 2 rubric separate and never loads Task 1 criteria", async () => {
    let prompt = "";
    const task2 = { ...base.task, imagePlaceholderKind: "TASK_2_NOT_REQUIRED" as const, promptText: "Discuss both views." };
    await run({ currentText: "I agree.", taskType: "TASK_2", task: task2, capture: (request) => { prompt = request.promptText; } });
    expect(prompt).toContain("Task Response");
    expect(prompt).not.toContain("Task Achievement");
  });

  it("still includes task context facts for Task 1", async () => {
    let prompt = "";
    await run({ currentText: "The population increased.", capture: (request) => { prompt = request.promptText; } });
    expect(prompt).toContain("Task Context:");
    expect(prompt).toContain("The chart covers 2000 to 2020.");
  });
});

describe("requestInstantCheck canonical pipeline", () => {
  it("keeps detector candidates separate from the unchanged visible issue contract", () => {
    const candidates = normalizeCandidateIssues({ status: "issues_found", issues: [issue] });
    const visible = candidateIssuesToVisibleIssues(candidates);
    expect(candidates.issues[0].detectorEvidence).toBe(issue.messageZh);
    expect(visible).toEqual(expect.objectContaining({ status: "issues_found", issues: [expect.objectContaining({ type: issue.type, subtype: issue.subtype, targetText: issue.targetText, labelEn: issue.labelEn, kind: issue.kind })] }));
    expect(visible.issues).toHaveLength(1);
    expect(visible.issues[0].fingerprint).toBe(issue.fingerprint);
    expect(visible.issues[0]).not.toHaveProperty("detectorEvidence");
  });
  it.each([
    ["SHOW", 1],
    ["REJECT", 0],
  ] as const)("maps language_error Gatekeeper %s to visible issue count %s", async (decision, expected) => {
    const llm = captureLlm(() => undefined, { status: "issues_found", issues: [issue] }, async () => ({ ok: true as const, decisions: [{ fingerprint: issue.fingerprint, decision }], model: "mimo", responseId: "g" }));
    const result = await run({ currentText: "marriages increased between 1970 and 1980", llm });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.feedback.issues).toHaveLength(expected);
  });

  it.each([issue, { ...issue, fingerprint: "confirmed", type: "task_accuracy", kind: "confirmed_error" }])("fails closed when an Error receives HOLD", async (errorIssue) => {
    const llm = captureLlm(() => undefined, { status: "issues_found", issues: [errorIssue] }, async () => ({ ok: true as const, decisions: [{ fingerprint: errorIssue.fingerprint, decision: "HOLD" as const }], model: "mimo", responseId: "g" }));
    await expect(run({ currentText: "These figure shows.", llm })).resolves.toEqual({ ok: false, code: "INVALID_GATEKEEPER_RESULT" });
  });

  it("fails closed for a missing or unknown Gatekeeper decision instead of silently dropping an Error", async () => {
    const llm = captureLlm(() => undefined, { status: "issues_found", issues: [issue] }, async () => ({ ok: true as const, decisions: [{ fingerprint: "unknown", decision: "SHOW" as const }], model: "mimo", responseId: "g" }));
    await expect(run({ currentText: "These figure shows.", llm })).resolves.toEqual({ ok: false, code: "INVALID_GATEKEEPER_RESULT" });
  });

  it("does not default a missing kind to coaching", async () => {
    const { kind: _kind, ...missingKind } = issue;
    await expect(run({ currentText: "These figure shows.", llm: captureLlm(() => undefined, { status: "issues_found", issues: [missingKind] }) })).resolves.toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it("sends detector evidence and the narrow reliable-factual-contradiction policy to Gatekeeper", async () => {
    let gatePrompt = "";
    const factual = { ...issue, type: "task_accuracy", subtype: "factual contradiction", messageZh: "1970 and 1980 are both approximately 2.5 million, so increased contradicts the reliable Task Context." };
    const llm = captureLlm(() => undefined, { status: "issues_found", issues: [factual] }, async (request) => {
      gatePrompt = request.promptText;
      return { ok: true, decisions: [{ fingerprint: factual.fingerprint, decision: "SHOW" }], model: "mimo", responseId: "g" };
    });
    const result = await run({ currentText: "Marriages increased between 1970 and 1980.", targetBand: "6.5", llm });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.feedback.issues).toHaveLength(1);
    expect(gatePrompt).toContain(factual.messageZh);
    expect(gatePrompt).toContain("directly contradicts an explicit reliable Task Context fact");
    expect(gatePrompt).toContain("Do not apply this rule when the Task Context is uncertain, approximate, ambiguous, or missing");
  });

  it("shows only SHOW from mixed candidates", async () => {
    const stylistic = { ...issue, fingerprint: "style", type: "vocabulary", subtype: "synonym preference", targetText: "decreasing" };
    const minor = { ...issue, fingerprint: "minor", type: "clarity", subtype: "minor improvement", targetText: "widowed adults", kind: "ielts_coaching" };
    const llm = captureLlm(() => undefined, { status: "issues_found", issues: [issue, stylistic, minor] }, async () => ({ ok: true as const, decisions: [
      { fingerprint: issue.fingerprint, decision: "SHOW" as const },
      { fingerprint: "style", decision: "REJECT" as const },
      { fingerprint: "minor", decision: "HOLD" as const },
    ], model: "mimo", responseId: "g" }));
    const result = await run({ currentText: "The number decreased; widowed adults were shown.", llm });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.feedback.issues.map((item) => item.fingerprint)).toEqual([issue.fingerprint]);
  });

  it.each(["TIMEOUT", "INVALID_JSON", "INVALID_STRUCTURE"] as const)("fails closed when Gatekeeper returns %s", async (code) => {
    const llm = captureLlm(() => undefined, { status: "issues_found", issues: [issue] }, async () => ({ ok: false as const, code }));
    const result = await run({ currentText: "These figure shows.", llm });
    expect(result).toEqual({ ok: false, code });
  });
  it("includes full and previous text and never asks for scoring or rewriting", async () => {
    let prompt = "";
    const result = await requestInstantCheck({ essayRepository: { findWorkspace: async () => base } as never, taskContextSource: { findResolution: async () => ({ availability: "READY", context: dynamicTaskContextFixture, limitationCodes: [] }) } as never, llm: captureLlm((request) => { prompt = request.promptText; }, { status: "issues_found", issues: [issue] }) }, { sessionId, requestId: "request-1", revisionId: "revision-client", taskType: "TASK_1", currentText: "The population increases in 1900.", previousAnalyzedText: "The population" });
    expect(result.ok).toBe(true);
    expect(prompt).toContain("The population increases in 1900."); expect(prompt).toContain("The population");
    expect(prompt).toContain("Do not rewrite");
    expect(prompt).not.toMatch(/score/i);
  });

  it("rejects malformed issue content instead of silently dropping it", async () => {
    const driftedIssue = { ...issue, fingerprint: undefined, unexpected: "ignored" };
    const result = await requestInstantCheck({ essayRepository: { findWorkspace: async () => base } as never, taskContextSource: { findResolution: async () => ({ availability: "READY", context: dynamicTaskContextFixture, limitationCodes: [] }) } as never, llm: captureLlm(() => undefined, { status: "no_high_value_issue", issues: [driftedIssue, driftedIssue, driftedIssue, driftedIssue], unexpected: true }) }, { sessionId, requestId: "request-drift", revisionId: "revision-client", taskType: "TASK_1", currentText: "The figure increased.", previousAnalyzedText: "" });

    expect(result).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it("keeps coaching Socratic when the model message gives a correction", async () => {
    const directAnswer = { ...issue, subtype: "subject-verb agreement", messageZh: "主语是复数，正确形式应该用 increased。" };
    const result = await requestInstantCheck({ essayRepository: { findWorkspace: async () => base } as never, taskContextSource: { findResolution: async () => ({ availability: "READY", context: dynamicTaskContextFixture, limitationCodes: [] }) } as never, llm: captureLlm(() => undefined, { status: "issues_found", issues: [directAnswer] }) }, { sessionId, requestId: "request-socratic", revisionId: "revision-client", taskType: "TASK_1", currentText: "The figures was changed.", previousAnalyzedText: "" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feedback.issues[0].messageZh).toContain("是不是需要再检查一下");
      expect(result.feedback.issues[0].messageZh).not.toContain("increased");
    }
  });

  it("keeps an article-level issue without inventing evidence text", async () => {
    const articleLevel = { type: "task_relevance", subtype: "overall position", severity: "high", targetText: "", messageZh: "The position is unclear.", labelEn: "Task relevance", fingerprint: "article-level", kind: "ielts_coaching" };
    const result = await requestInstantCheck({ essayRepository: { findWorkspace: async () => base } as never, taskContextSource: { findResolution: async () => ({ availability: "READY", context: dynamicTaskContextFixture, limitationCodes: [] }) } as never, llm: captureLlm(() => undefined, { status: "issues_found", issues: [articleLevel] }) }, { sessionId, requestId: "request-article", revisionId: "revision-client", taskType: "TASK_1", currentText: "The essay has several paragraphs.", previousAnalyzedText: "" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.feedback.issues[0].targetText).toBe("");
  });

  it("rejects non-canonical feedback envelopes", async () => {
    const result = await requestInstantCheck({ essayRepository: { findWorkspace: async () => base } as never, taskContextSource: { findResolution: async () => ({ availability: "READY", context: dynamicTaskContextFixture, limitationCodes: [] }) } as never, llm: captureLlm(() => undefined, { status: "issues_found", feedback: { issues: [issue] } }) }, { sessionId, requestId: "request-envelope", revisionId: "revision-client", taskType: "TASK_1", currentText: "The figure increases.", previousAnalyzedText: "" });

    expect(result).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });
});

describe("deterministic fixtures: exhaustive language errors without limits", () => {
  const make = (fingerprint: string, type: "grammar" | "spelling" | "vocabulary" | "clarity" | "task_accuracy", subtype: string, kind: "language_error" | "ielts_coaching", targetText = fingerprint) => ({ type, subtype, severity: "medium" as const, targetText, messageZh: "检查一下这处。", labelEn: `${type} · ${subtype}`, fingerprint, kind });

  const manyErrors = [
    make("fp-1", "grammar", "singular/plural", "language_error"),
    make("fp-2", "grammar", "subject-verb agreement", "language_error"),
    make("fp-3", "grammar", "tense", "language_error"),
    make("fp-4", "grammar", "article", "language_error"),
    make("fp-5", "spelling", "misspelling", "language_error"),
    make("fp-6", "vocabulary", "incorrect word choice", "language_error"),
    make("fp-7", "vocabulary", "collocation", "language_error"),
    make("fp-8", "clarity", "unclear reference", "ielts_coaching"),
  ];

  const runWith = (issues: unknown[]) => requestInstantCheck({
    essayRepository: { findWorkspace: async () => base } as never,
    taskContextSource: { findResolution: async () => ({ availability: "READY", context: dynamicTaskContextFixture, limitationCodes: [] }) } as never,
    llm: captureLlm(() => undefined, { status: "issues_found", issues }),
  }, { sessionId, requestId: "fixture", revisionId: "revision-client", taskType: "TASK_1", currentText: "A text with many errors.", previousAnalyzedText: "" });

  const runEmpty = () => requestInstantCheck({
    essayRepository: { findWorkspace: async () => base } as never,
    taskContextSource: { findResolution: async () => ({ availability: "READY", context: dynamicTaskContextFixture, limitationCodes: [] }) } as never,
    llm: captureLlm(() => undefined, { status: "no_high_value_issue", issues: [] }),
  }, { sessionId, requestId: "fixture-empty", revisionId: "revision-client", taskType: "TASK_1", currentText: "A clean sentence.", previousAnalyzedText: "" });

  it("accepts and keeps more than three distinct language errors (no issue-count limit)", async () => {
    const result = await runWith(manyErrors);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.feedback.issues).toHaveLength(8);
  });

  it("does not crowd a grammar error out even when weaker issues exist", async () => {
    const result = await runWith([manyErrors[3], manyErrors[7], manyErrors[4], manyErrors[0]]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feedback.issues).toHaveLength(4);
      expect(result.feedback.issues.some((item) => item.type === "grammar" && /singular|plural/i.test(item.subtype))).toBe(true);
    }
  });

  it("keeps mandatory vocabulary errors (incorrect word choice / collocation) with kind language_error", async () => {
    const result = await runWith([manyErrors[5], manyErrors[6]]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feedback.issues.every((item) => item.kind === "language_error")).toBe(true);
      expect(result.feedback.issues.map((item) => item.type)).toEqual(["vocabulary", "vocabulary"]);
    }
  });

  it("allows repetition-style coaching issues to be selective (kind ielts_coaching)", async () => {
    const result = await runWith([{ ...manyErrors[7], subtype: "repetition", labelEn: "Lexical Resource · repetition" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.feedback.issues[0].kind).toBe("ielts_coaching");
  });

  it("rejects a detector issue when kind is missing", async () => {
    const withoutKind = { type: "grammar", subtype: "tense", severity: "medium", targetText: "increases", messageZh: "检查一下。", labelEn: "Grammar · tense", fingerprint: "fp-nokind" };
    const result = await runWith([withoutKind]);
    expect(result).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it("still returns no_high_value_issue when nothing is reportable", async () => {
    const result = await runEmpty();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.feedback).toEqual({ status: "no_high_value_issue", issues: [] });
  });

  it("does not false-positive the corrected plural form", async () => {
    const result = await runEmpty();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.feedback.status).toBe("no_high_value_issue");
  });
});
