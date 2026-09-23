import type { InstantCheckLLMPort, InstantCheckLlmRequest, InstantCheckLlmResult } from "../../ports/instant-check-llm.port";
import type { MiMoClient } from "./mimo-client";
import { instantCheckModelIssueSchema, instantCheckModelOutputSchema, instantCheckOutputJsonSchema } from "./instant-check-output.schema";
import { z } from "zod";

const canonicalIssueTypes = new Set(["grammar", "spelling", "vocabulary", "task_accuracy", "task_relevance", "comparison", "clarity", "positive"]);
const issueTypeAliases: Readonly<Record<string, string>> = {};

function normalizeExplicitNoIssue(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.status === "no_high_value_issue" && !Object.hasOwn(record, "issues")) return { ...record, issues: [] };
  return value;
}

function structureDiagnostic(value: unknown, issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>) {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const issueValue = record?.issues;
  return JSON.stringify({
    topLevelType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
    keys: record ? Object.keys(record).sort() : [],
    status: typeof record?.status === "string" ? record.status : null,
    issuesPresent: record ? Object.hasOwn(record, "issues") : false,
    issuesType: Array.isArray(issueValue) ? "array" : issueValue === null ? "null" : typeof issueValue,
    issueCount: Array.isArray(issueValue) ? issueValue.length : null,
    validation: issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
  });
}

function canonicalizeOutput(value: unknown) {
  const normalized = normalizeExplicitNoIssue(value);
  if (typeof normalized !== "object" || normalized === null || Array.isArray(normalized)) {
    return instantCheckModelOutputSchema.safeParse(normalized);
  }
  const record = normalized as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "status" && key !== "issues") ||
      (record.status !== "issues_found" && record.status !== "no_high_value_issue") ||
      !Array.isArray(record.issues)) {
    return instantCheckModelOutputSchema.safeParse(normalized);
  }

  const issues = [];
  for (const [index, candidate] of record.issues.entries()) {
    const recovered = recoverKnownMissingMessageDrift(candidate);
    const canonical = instantCheckModelIssueSchema.safeParse(recovered);
    if (canonical.success) {
      issues.push(canonical.data);
      continue;
    }
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return instantCheckModelOutputSchema.safeParse(normalized);
    const candidateRecord = candidate as Record<string, unknown>;
    const type = candidateRecord.type;
    if (typeof type !== "string" || canonicalIssueTypes.has(type)) return instantCheckModelOutputSchema.safeParse(normalized);
    const alias = issueTypeAliases[type];
    if (alias) {
      const aliased = instantCheckModelIssueSchema.safeParse({ ...candidateRecord, type: alias });
      if (!aliased.success) return instantCheckModelOutputSchema.safeParse(normalized);
      console.warn("[instant-check] normalized issue type", { index, from: type, to: alias });
      issues.push(aliased.data);
      continue;
    }
    const typeOnlyDrift = instantCheckModelIssueSchema.safeParse({ ...candidateRecord, type: "grammar" });
    if (!typeOnlyDrift.success) return instantCheckModelOutputSchema.safeParse(normalized);
    console.warn("[instant-check] dropped issue", { index, reason: "UNKNOWN_ISSUE_TYPE" });
  }

  return instantCheckModelOutputSchema.safeParse({
    status: issues.length > 0 ? "issues_found" : "no_high_value_issue",
    issues,
  });
}

function recoverKnownMissingMessageDrift(candidate: unknown): unknown {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return candidate;
  const record = candidate as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const allowedKeys = ["kind", "labelEn", "severity", "subtype", "targetText", "type"];
  if (keys.join("|") !== allowedKeys.join("|")) return candidate;
  if (record.type !== "clarity" || typeof record.subtype !== "string" || typeof record.labelEn !== "string" || !/\p{Script=Han}/u.test(record.labelEn)) return candidate;
  return { ...record, labelEn: `Clarity · ${record.subtype}`, messageZh: record.labelEn };
}

function countJsonProperty(raw: string, property: string) {
  const token = JSON.stringify(property);
  let count = 0;
  let cursor = 0;
  while (cursor < raw.length) {
    const found = raw.indexOf(token, cursor);
    if (found < 0) break;
    let next = found + token.length;
    while (/\s/.test(raw[next] ?? "")) next += 1;
    if (raw[next] === ":") count += 1;
    cursor = found + token.length;
  }
  return count;
}

function preservesDetectorSemantics(raw: string, repaired: z.infer<typeof instantCheckModelOutputSchema>) {
  if (countJsonProperty(raw, "type") !== repaired.issues.length) return false;
  if (countJsonProperty(raw, "kind") !== repaired.issues.filter((issue) => issue.kind !== undefined).length) return false;

  let cursor = raw.indexOf(repaired.status);
  if (cursor < 0) return false;
  cursor += repaired.status.length;
  for (const issue of repaired.issues) {
    const values = [issue.type, issue.subtype, issue.severity, issue.targetText, issue.labelEn, issue.messageZh, ...(issue.kind === undefined ? [] : [issue.kind])];
    for (const value of values) {
      const found = raw.indexOf(value, cursor);
      if (found < 0) return false;
      cursor = found + value.length;
    }
  }
  return true;
}

export class MiMoInstantCheckAdapter implements InstantCheckLLMPort {
  constructor(private readonly client: Pick<MiMoClient, "complete">, private readonly model: string) {}
  async executeInstantCheck(request: InstantCheckLlmRequest): Promise<InstantCheckLlmResult> {
    try {
      const completion = await this.client.complete({ responseFormat: { type: "json_object" }, messages: [
        { role: "system", content: "You are an IELTS writing coach. Return exactly one JSON object matching the schema below. issues is REQUIRED in every response; return \"issues\": [] when there is no reportable issue. There is no issue-count limit: report every clear language error in the INSPECTION TARGET, and selectively add higher-order IELTS coaching issues that materially matter for the target band. Never omit the issues field. In every issue object, write the subtype member exactly as \"subtype\": \"...\". Never output a bare subtype string. Never use unescaped ASCII double quotes (\") inside messageZh; when mentioning English terms there, use Chinese quotation marks, single quotes, or no quotation marks. 例如：请检查 proportion 的介词搭配；比较 'population' 与 'people' 的含义。 Do not wrap JSON in Markdown or add commentary. Do not include scores. Do not rewrite or provide corrected answers; use a short Socratic hint that helps the student notice and fix the problem independently. Use English labels and concise natural Chinese coaching questions. Classify every issue as language_error, confirmed_error, or ielts_coaching. Schema: " + JSON.stringify(instantCheckOutputJsonSchema) },
        { role: "user", content: request.promptText },
      ] });
      if (completion.finishReason === "content_filter") return { ok: false, code: "REFUSAL" };
      if (completion.finishReason !== "stop" || !completion.content) return { ok: false, code: "INCOMPLETE" };
      let parsed: unknown;
      let repairedRaw: string | null = null;
      try { parsed = JSON.parse(completion.content); }
      catch {
        const repair = await this.client.complete({ responseFormat: { type: "json_object" }, messages: [
          { role: "system", content: "Repair JSON syntax only. Return exactly one JSON object and no commentary. Preserve the original status, issue count, issue order, every field, and every scalar value exactly. Do not add, delete, reorder, infer, translate, or rewrite any issue or value. Only insert or escape JSON syntax required to make the original content parseable. Required schema: " + JSON.stringify(instantCheckOutputJsonSchema) },
          { role: "user", content: completion.content },
        ] });
        if (repair.finishReason === "content_filter") return { ok: false, code: "REFUSAL" };
        if (repair.finishReason !== "stop" || !repair.content) return { ok: false, code: "INCOMPLETE" };
        repairedRaw = repair.content;
        try { parsed = JSON.parse(repair.content); }
        catch { return { ok: false, code: "INVALID_JSON" }; }
      }
      const canonical = canonicalizeOutput(parsed);
      if (!canonical.success) return { ok: false, code: "INVALID_STRUCTURE", diagnostic: structureDiagnostic(parsed, canonical.error.issues) };
      if (repairedRaw !== null && !preservesDetectorSemantics(completion.content, canonical.data)) return { ok: false, code: "INVALID_STRUCTURE" };
      return { ok: true, value: canonical.data, model: this.model, responseId: completion.responseId };
    } catch (error) {
      if (error instanceof Error && error.message === "MIMO_TIMEOUT") return { ok: false, code: "TIMEOUT" };
      if (error instanceof Error && error.message === "MIMO_NETWORK") return { ok: false, code: "NETWORK" };
      return { ok: false, code: "TERMINAL" };
    }
  }
  async executeInstantCheckGatekeeper(request: InstantCheckLlmRequest) {
    try {
      const completion = await this.client.complete({ responseFormat: { type: "json_object" }, messages: [
        { role: "system", content: "Return only JSON with decisions for the supplied candidate fingerprints. Do not add or rewrite issues. Schema: {\"decisions\":[{\"fingerprint\":\"string\",\"decision\":\"SHOW|HOLD|REJECT\"}]}" },
        { role: "user", content: request.promptText },
      ] });
      if (completion.finishReason === "content_filter") return { ok: false as const, code: "REFUSAL" as const };
      if (completion.finishReason !== "stop" || !completion.content) return { ok: false as const, code: "INCOMPLETE" as const };
      let parsed: unknown;
      try { parsed = JSON.parse(completion.content); } catch { return { ok: false as const, code: "INVALID_JSON" as const }; }
      const result = z.object({ decisions: z.array(z.object({ fingerprint: z.string().min(1), decision: z.enum(["SHOW", "HOLD", "REJECT"]) }).strict()) }).strict().safeParse(parsed);
      if (!result.success) return { ok: false as const, code: "INVALID_STRUCTURE" as const };
      return { ok: true as const, decisions: result.data.decisions, model: this.model, responseId: completion.responseId };
    } catch (error) {
      if (error instanceof Error && error.message === "MIMO_TIMEOUT") return { ok: false as const, code: "TIMEOUT" as const };
      if (error instanceof Error && error.message === "MIMO_NETWORK") return { ok: false as const, code: "NETWORK" as const };
      return { ok: false as const, code: "TERMINAL" as const };
    }
  }
}
