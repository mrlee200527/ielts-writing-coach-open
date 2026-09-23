import { z } from "zod";

export const bandScoreSchema = z
  .number()
  .min(0)
  .max(9)
  .refine((value) => Number.isInteger(value * 2), { message: "BAND_MUST_BE_HALF_STEP" });

const sharedFeedbackFields = {
    overallBand: bandScoreSchema,
    strengths: z.array(z.string().min(1)).min(1).max(3),
    improvements: z.array(z.string().min(1)).min(1).max(3),
    priorityImprovement: z.string().min(1),
};
export const essayFeedbackSchema = z.union([
  z.object({ ...sharedFeedbackFields, criteria: z.object({
        taskAchievement: bandScoreSchema,
        coherenceCohesion: bandScoreSchema,
        lexicalResource: bandScoreSchema,
        grammaticalRangeAccuracy: bandScoreSchema,
      }).strict() }).strict(),
  z.object({ ...sharedFeedbackFields, criteria: z.object({
        taskResponse: bandScoreSchema,
        coherenceCohesion: bandScoreSchema,
        lexicalResource: bandScoreSchema,
        grammaticalRangeAccuracy: bandScoreSchema,
      }).strict() }).strict(),
]);

export type BandScore = z.infer<typeof bandScoreSchema>;
export type EssayFeedback = z.infer<typeof essayFeedbackSchema>;

export function parseEssayFeedback(input: unknown): EssayFeedback {
  return essayFeedbackSchema.parse(input);
}
