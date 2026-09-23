import { stableHash } from "../shared/hash";

interface IdempotencyInput {
  scope: string;
  revisionId: string;
  inputHash: string;
  promptVersion: string;
}

export function createIdempotencyKey(input: IdempotencyInput): string {
  return stableHash({
    scope: input.scope,
    revisionId: input.revisionId,
    inputHash: input.inputHash,
    promptVersion: input.promptVersion,
  });
}
