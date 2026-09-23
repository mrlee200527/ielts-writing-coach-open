import type { CompletionState } from "./completion.schema";

export type ParagraphTrigger = "AUTO" | "MANUAL";

export function paragraphTransition(trigger: ParagraphTrigger): CompletionState {
  return trigger === "MANUAL" ? "REQUESTED" : "WAITING";
}
