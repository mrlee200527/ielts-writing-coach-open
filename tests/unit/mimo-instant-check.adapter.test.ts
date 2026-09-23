import { describe, expect, it } from "vitest";
import { MiMoInstantCheckAdapter } from "../../src/infrastructure/llm/mimo-instant-check.adapter";

const issue = { type: "grammar", subtype: "tense", severity: "medium", targetText: "increases", labelEn: "Grammar · tense", messageZh: "这里的时态合适吗？", kind: "language_error" };
const request = { sessionId: "s", requestId: "q", revisionId: "v", promptVersion: "instant-v3", promptText: "check" };
const adapterFor = (value: string) => new MiMoInstantCheckAdapter({ complete: async () => ({ responseId: "r", finishReason: "stop", content: value }) }, "mimo-v2.5");
const adapterForResponses = (responses: Array<{ responseId: string; finishReason: string | null; content: string | null }>) => {
  const calls: unknown[] = [];
  let index = 0;
  const adapter = new MiMoInstantCheckAdapter({ complete: async (input) => {
    calls.push(input);
    return responses[Math.min(index++, responses.length - 1)];
  } }, "mimo-v2.5");
  return { adapter, calls };
};

describe("MiMoInstantCheckAdapter canonical output", () => {
  it("accepts the canonical issues array and explicitly requires issues in the prompt", async () => {
    let system = "";
    let responseFormat: unknown;
    const value = { status: "issues_found", issues: [issue] };
    const adapter = new MiMoInstantCheckAdapter({ complete: async (input) => { system = String(input.messages[0].content); responseFormat = input.responseFormat; return { responseId: "r", finishReason: "stop", content: JSON.stringify(value) }; } }, "mimo-v2.5");
    const result = await adapter.executeInstantCheck(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(value);
    expect(system).toContain("issues is REQUIRED in every response");
    expect(system).toContain('return "issues": []');
    expect(system).toContain("Never omit the issues field");
    expect(system).toContain('write the subtype member exactly as "subtype": "..."');
    expect(system).toContain("Never output a bare subtype string");
    expect(responseFormat).toEqual({ type: "json_object" });
  });

  it("requires JSON-safe quoting when messageZh mentions one or multiple English terms", async () => {
    let system = "";
    const adapter = new MiMoInstantCheckAdapter({ complete: async (input) => {
      system = String(input.messages[0].content);
      return { responseId: "r", finishReason: "stop", content: JSON.stringify({ status: "no_high_value_issue", issues: [] }) };
    } }, "mimo-v2.5");

    await adapter.executeInstantCheck(request);

    expect(system).toContain('Never use unescaped ASCII double quotes (") inside messageZh');
    expect(system).toContain("use Chinese quotation marks, single quotes, or no quotation marks");
    expect(system).toContain("例如：请检查 proportion 的介词搭配；比较 'population' 与 'people' 的含义。");
  });

  it("accepts canonical no_high_value_issue with an empty array", async () => {
    const result = await adapterFor('{"status":"no_high_value_issue","issues":[]}').executeInstantCheck(request);
    expect(result).toMatchObject({ ok: true, value: { status: "no_high_value_issue", issues: [] } });
  });

  it("recovers only the confirmed duplicate-label drift that displaced a clarity messageZh", async () => {
    const drift = {
      type: "clarity", subtype: "referential_clarity", severity: "medium", targetText: "The percentage of widowed adults decreased slightly.",
      labelEn: "句子未明确说明百分比的基准是什么，这会让考官感到困惑。", kind: "language_error",
    };
    const result = await adapterFor(JSON.stringify({ status: "issues_found", issues: [drift] })).executeInstantCheck(request);
    expect(result).toMatchObject({ ok: true, value: { status: "issues_found", issues: [{ ...drift, labelEn: "Clarity · referential_clarity", messageZh: drift.labelEn }] } });
  });

  it("still rejects an unsafe missing messageZh that does not match the confirmed drift", async () => {
    const unsafe = { type: "clarity", subtype: "referential_clarity", severity: "medium", targetText: "text", labelEn: "Unclear reference", kind: "language_error" };
    const result = await adapterFor(JSON.stringify({ status: "issues_found", issues: [unsafe] })).executeInstantCheck(request);
    expect(result).toMatchObject({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it("normalizes only no_high_value_issue with a missing issues field", async () => {
    const result = await adapterFor('{"status":"no_high_value_issue"}').executeInstantCheck(request);
    expect(result).toMatchObject({ ok: true, value: { status: "no_high_value_issue", issues: [] } });
  });

  it.each(["null", "{}", '"not-an-array"'])("rejects invalid issues value %s", async (issues) => {
    const result = await adapterFor(`{"status":"issues_found","issues":${issues}}`).executeInstantCheck(request);
    expect(result).toMatchObject({ ok: false, code: "INVALID_STRUCTURE", diagnostic: expect.stringContaining('"issuesType"') });
  });

  it("derives status from surviving canonical issues", async () => {
    const withIssue = await adapterFor(JSON.stringify({ status: "no_high_value_issue", issues: [issue] })).executeInstantCheck(request);
    const withoutIssue = await adapterFor('{"status":"issues_found","issues":[]}').executeInstantCheck(request);
    expect(withIssue).toMatchObject({ ok: true, value: { status: "issues_found", issues: [issue] } });
    expect(withoutIssue).toMatchObject({ ok: true, value: { status: "no_high_value_issue", issues: [] } });
  });

  it("drops one unknown issue type while preserving canonical siblings", async () => {
    const sibling = { ...issue, subtype: "articles", targetText: "the chart", labelEn: "Grammar · articles" };
    const drifted = { ...issue, type: "language_accuracy", subtype: "noun-number", targetText: "five district" };
    const result = await adapterFor(JSON.stringify({ status: "issues_found", issues: [issue, drifted, sibling] })).executeInstantCheck(request);
    expect(result).toMatchObject({ ok: true, value: { status: "issues_found", issues: [issue, sibling] } });
  });

  it("derives no_high_value_issue when every issue has an unknown type", async () => {
    const drifted = { ...issue, type: "language_accuracy" };
    const result = await adapterFor(JSON.stringify({ status: "issues_found", issues: [drifted] })).executeInstantCheck(request);
    expect(result).toMatchObject({ ok: true, value: { status: "no_high_value_issue", issues: [] } });
  });

  it("rejects malformed or wrapped JSON", async () => {
    const malformed = await adapterFor('{"status":"no_high_value_issue","issues":[').executeInstantCheck(request);
    const wrapped = await adapterFor('```json\n{"status":"no_high_value_issue","issues":[]}\n```').executeInstantCheck(request);
    expect(malformed).toEqual({ ok: false, code: "INVALID_JSON" });
    expect(wrapped).toEqual({ ok: false, code: "INVALID_JSON" });
  });

  it("repairs one unescaped messageZh quote without changing candidate semantics", async () => {
    const repairedIssue = { ...issue, subtype: "collocation", targetText: "proportion on", labelEn: "Collocation", messageZh: '请检查 "proportion" 的介词搭配。' };
    const malformed = '{"status":"issues_found","issues":[{"type":"grammar","subtype":"collocation","severity":"medium","targetText":"proportion on","labelEn":"Collocation","messageZh":"请检查 "proportion" 的介词搭配。","kind":"language_error"}]}';
    const { adapter, calls } = adapterForResponses([
      { responseId: "detector", finishReason: "stop", content: malformed },
      { responseId: "repair", finishReason: "stop", content: JSON.stringify({ status: "issues_found", issues: [repairedIssue] }) },
    ]);

    const result = await adapter.executeInstantCheck(request);

    expect(result).toMatchObject({ ok: true, value: { issues: [repairedIssue] }, responseId: "detector" });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1])).not.toContain(request.promptText);
  });

  it("repairs a missing subtype key while preserving the original subtype value", async () => {
    const malformed = '{"status":"issues_found","issues":[{"type":"grammar","subject_verb_agreement","severity":"medium","targetText":"population are","labelEn":"Agreement","messageZh":"检查主谓一致。","kind":"language_error"}]}';
    const repairedIssue = { ...issue, subtype: "subject_verb_agreement", targetText: "population are", labelEn: "Agreement", messageZh: "检查主谓一致。" };
    const { adapter } = adapterForResponses([
      { responseId: "detector", finishReason: "stop", content: malformed },
      { responseId: "repair", finishReason: "stop", content: JSON.stringify({ status: "issues_found", issues: [repairedIssue] }) },
    ]);

    expect(await adapter.executeInstantCheck(request)).toMatchObject({ ok: true, value: { issues: [repairedIssue] } });
  });

  it("fails closed when repair output is still not JSON", async () => {
    const { adapter } = adapterForResponses([
      { responseId: "detector", finishReason: "stop", content: "not json" },
      { responseId: "repair", finishReason: "stop", content: "still not json" },
    ]);
    expect(await adapter.executeInstantCheck(request)).toEqual({ ok: false, code: "INVALID_JSON" });
  });

  it("rejects a repair that adds a candidate", async () => {
    const malformed = '{"status":"issues_found","issues":[{"type":"grammar","tense","severity":"medium","targetText":"increases","labelEn":"Grammar · tense","messageZh":"这里的时态合适吗？"}]}';
    const { adapter } = adapterForResponses([
      { responseId: "detector", finishReason: "stop", content: malformed },
      { responseId: "repair", finishReason: "stop", content: JSON.stringify({ status: "issues_found", issues: [issue, issue] }) },
    ]);
    expect(await adapter.executeInstantCheck(request)).toEqual({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it("requires repaired JSON to pass the existing canonical schema", async () => {
    const malformed = '{"status":"issues_found","issues":[{"type":"grammar","tense","severity":"medium","targetText":"increases","labelEn":"Grammar · tense","messageZh":"这里的时态合适吗？"}]}';
    const { adapter } = adapterForResponses([
      { responseId: "detector", finishReason: "stop", content: malformed },
      { responseId: "repair", finishReason: "stop", content: JSON.stringify({ status: "issues_found", issues: [{ ...issue, severity: "urgent" }] }) },
    ]);
    expect(await adapter.executeInstantCheck(request)).toMatchObject({ ok: false, code: "INVALID_STRUCTURE" });
  });

  it("fails closed when the repair provider does not complete", async () => {
    const { adapter } = adapterForResponses([
      { responseId: "detector", finishReason: "stop", content: "not json" },
      { responseId: "repair", finishReason: "length", content: null },
    ]);
    expect(await adapter.executeInstantCheck(request)).toEqual({ ok: false, code: "INCOMPLETE" });
  });

  it("does not call repair for normal valid JSON", async () => {
    const { adapter, calls } = adapterForResponses([
      { responseId: "detector", finishReason: "stop", content: JSON.stringify({ status: "issues_found", issues: [issue] }) },
    ]);
    expect(await adapter.executeInstantCheck(request)).toMatchObject({ ok: true, value: { issues: [issue] } });
    expect(calls).toHaveLength(1);
  });

  it("accepts more than three issues because the issue-count limit is removed", async () => {
    const value = { status: "issues_found", issues: [issue, issue, issue, issue, issue] };
    const result = await adapterFor(JSON.stringify(value)).executeInstantCheck(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as { issues: unknown[] }).issues).toHaveLength(5);
  });

  it("preserves ten canonical siblings when one issue type drifts", async () => {
    const siblings = Array.from({ length: 11 }, (_, index) => ({
      ...issue,
      subtype: `tense-${index}`,
      targetText: `target-${index}`,
      labelEn: `Grammar · tense ${index}`,
    }));
    const drifted = { ...issue, type: "language_accuracy", subtype: "drifted" };
    const result = await adapterFor(JSON.stringify({ status: "issues_found", issues: [...siblings.slice(0, 6), drifted, ...siblings.slice(6)] })).executeInstantCheck(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as { issues: unknown[] }).issues).toEqual(siblings);
  });

  it("system prompt removes any issue-count limit and per-pattern grammar mandates", async () => {
    let system = "";
    const adapter = new MiMoInstantCheckAdapter({ complete: async (input) => { system = String(input.messages[0].content); return { responseId: "r", finishReason: "stop", content: '{"status":"no_high_value_issue","issues":[]}' }; } }, "mimo-v2.5");
    await adapter.executeInstantCheck(request);
    expect(system).toContain("There is no issue-count limit");
    expect(system).toMatch(/report every clear language error in the INSPECTION TARGET/i);
    expect(system).toContain("language_error, confirmed_error, or ielts_coaching");
    expect(system).toContain("Socratic");
    expect(system).not.toContain("at most 3");
    expect(system).not.toContain("high-value Socratic");
    expect(system).not.toContain("five district");
    expect(system).not.toContain("singular/plural error when present");
  });
});
