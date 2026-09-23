import { essayRevisionSchema, type EssayRevision } from "./revision.schema";
import { stableHash } from "../shared/hash";
import { deepFreeze, type DeepReadonly } from "../shared/deep-freeze";

interface CreateRevisionInput {
  id: string;
  sessionId: string;
  previous?: Pick<EssayRevision, "revisionNo">;
  plainText: string;
  content: unknown;
  now: Date;
}

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words?.length ?? 0;
}

export function createNextRevision(input: CreateRevisionInput): DeepReadonly<EssayRevision> {
  const revision = essayRevisionSchema.parse({
    id: input.id,
    sessionId: input.sessionId,
    revisionNo: (input.previous?.revisionNo ?? 0) + 1,
    plainText: input.plainText,
    content: structuredClone(input.content),
    wordCount: countWords(input.plainText),
    textHash: stableHash(input.plainText),
    createdAt: input.now.toISOString(),
  });
  return deepFreeze(revision);
}
