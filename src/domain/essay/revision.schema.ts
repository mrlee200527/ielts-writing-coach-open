import { z } from "zod";

import { uuidSchema } from "../shared/ids";

export const essayRevisionSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  revisionNo: z.number().int().positive(),
  plainText: z.string(),
  content: z.unknown(),
  wordCount: z.number().int().nonnegative(),
  textHash: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type EssayRevision = z.infer<typeof essayRevisionSchema>;
