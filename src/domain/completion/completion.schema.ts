import { z } from "zod";

export const completionStateSchema = z.enum(["IDLE", "WAITING", "REQUESTED", "CANCELLED", "SKIPPED"]);
export type CompletionState = z.infer<typeof completionStateSchema>;
