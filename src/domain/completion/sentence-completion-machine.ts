import type { CompletionState } from "./completion.schema";

export type SentenceTrigger = "PUNCTUATION_PAUSE" | "CURSOR_LEFT" | "NEXT_SENTENCE_STARTED";

export function sentenceTransition(trigger: SentenceTrigger): CompletionState {
  return trigger === "PUNCTUATION_PAUSE" ? "WAITING" : "REQUESTED";
}
