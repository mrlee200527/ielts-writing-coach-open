const band = { enum: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9] } as const;

export const task1EssayFeedbackOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["overallBand", "criteria", "strengths", "improvements", "priorityImprovement"],
  properties: {
    overallBand: band,
    criteria: {
      type: "object",
      additionalProperties: false,
      required: ["taskAchievement", "coherenceCohesion", "lexicalResource", "grammaticalRangeAccuracy"],
      properties: {
        taskAchievement: band,
        coherenceCohesion: band,
        lexicalResource: band,
        grammaticalRangeAccuracy: band,
      },
    },
    strengths: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    improvements: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    priorityImprovement: { type: "string" },
  },
} as const;
export const task2EssayFeedbackOutputJsonSchema = {
  ...task1EssayFeedbackOutputJsonSchema,
  properties: { ...task1EssayFeedbackOutputJsonSchema.properties, criteria: {
    type: "object", additionalProperties: false,
    required: ["taskResponse", "coherenceCohesion", "lexicalResource", "grammaticalRangeAccuracy"],
    properties: { taskResponse: band, coherenceCohesion: band, lexicalResource: band, grammaticalRangeAccuracy: band },
  } },
} as const;
export const essayFeedbackOutputJsonSchema = task1EssayFeedbackOutputJsonSchema;
