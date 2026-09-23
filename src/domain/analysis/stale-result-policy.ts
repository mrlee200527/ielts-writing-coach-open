import type { EssayStatus } from "../essay/essay.schema";
import { stableHash } from "../shared/hash";

export type StaleResult =
  | { stale: false }
  | { stale: true; reasonCode: "ESSAY_NOT_DRAFT" | "DEPENDENCY_CHANGED"; expectedHash: string; actualHash: string };

export function evaluateStaleness(status: EssayStatus, expected: unknown, actual: unknown): StaleResult {
  const expectedHash = stableHash(expected);
  const actualHash = stableHash(actual);
  if (status !== "DRAFT") return { stale: true, reasonCode: "ESSAY_NOT_DRAFT", expectedHash, actualHash };
  if (expectedHash !== actualHash) return { stale: true, reasonCode: "DEPENDENCY_CHANGED", expectedHash, actualHash };
  return { stale: false };
}
