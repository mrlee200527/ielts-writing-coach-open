import { z } from "zod";

import { uuidSchema } from "../shared/ids";

export const factCertaintySchema = z.enum(["CERTAIN", "UNCERTAIN", "UNAVAILABLE"]);
export const uncertaintyCategorySchema = z.enum([
  "LABEL_UNREADABLE",
  "VALUE_AMBIGUOUS",
  "LEGEND_AMBIGUOUS",
  "TIME_RANGE_AMBIGUOUS",
  "STEP_AMBIGUOUS",
  "ARROW_AMBIGUOUS",
  "LOCATION_AMBIGUOUS",
  "DIRECTION_AMBIGUOUS",
  "IMAGE_QUALITY",
  "OTHER",
]);
export const taskContextLimitationCodeSchema = z.enum([
  "IMAGE_UNREADABLE",
  "TASK_TYPE_AMBIGUOUS",
  "LABELS_PARTIALLY_UNREADABLE",
  "VALUES_PARTIALLY_UNREADABLE",
  "LEGEND_UNCLEAR",
  "TIME_RANGE_UNCLEAR",
  "PROCESS_FLOW_UNCLEAR",
  "MAP_ORIENTATION_UNCLEAR",
  "NO_SAFE_CONTEXT",
]);

export const taskFactSchema = z.object({
  factId: uuidSchema,
  statement: z.string().min(1).max(500),
  certainty: factCertaintySchema,
  uncertaintyCategory: uncertaintyCategorySchema.nullable(),
  evidence: z.object({
    regionLabel: z.string().max(120).nullable(),
    sourceText: z.string().max(240).nullable(),
  }).strict(),
}).strict().superRefine((fact, context) => {
  if (fact.certainty !== "CERTAIN" && fact.uncertaintyCategory === null) {
    context.addIssue({ code: "custom", message: "UNCERTAINTY_CATEGORY_REQUIRED" });
  }
  if (fact.certainty === "CERTAIN" && fact.uncertaintyCategory !== null) {
    context.addIssue({ code: "custom", message: "CERTAIN_FACT_CATEGORY_MUST_BE_NULL" });
  }
});

const dynamicTaskSchema = z.object({
  kind: z.literal("DYNAMIC_CHART"),
  chartType: z.enum(["LINE", "BAR", "AREA", "MIXED", "OTHER"]),
  timeAxisFactIds: z.array(uuidSchema),
  seriesFactIds: z.array(uuidSchema),
  changeFactIds: z.array(uuidSchema),
}).strict();

const staticTaskSchema = z.object({
  kind: z.literal("STATIC_CHART"),
  chartType: z.enum(["BAR", "PIE", "TABLE", "MIXED", "OTHER"]),
  categoryFactIds: z.array(uuidSchema),
  seriesFactIds: z.array(uuidSchema),
  comparisonFactIds: z.array(uuidSchema),
}).strict();

const processTaskSchema = z.object({
  kind: z.literal("PROCESS"),
  processType: z.enum(["LINEAR", "CYCLICAL", "NATURAL", "MAN_MADE", "MIXED"]),
  stageFactIds: z.array(uuidSchema),
  edgeFactIds: z.array(uuidSchema),
}).strict();

const mapTaskSchema = z.object({
  kind: z.literal("MAP"),
  mapType: z.enum(["PAST_PRESENT", "BEFORE_AFTER", "PROPOSED", "MULTI_PERIOD"]),
  locationFactIds: z.array(uuidSchema),
  changeFactIds: z.array(uuidSchema),
  directionFactIds: z.array(uuidSchema),
}).strict();

const taskSchema = z.discriminatedUnion("kind", [
  dynamicTaskSchema,
  staticTaskSchema,
  processTaskSchema,
  mapTaskSchema,
]);

function referencedFactIds(task: z.infer<typeof taskSchema>): string[] {
  switch (task.kind) {
    case "DYNAMIC_CHART":
      return [...task.timeAxisFactIds, ...task.seriesFactIds, ...task.changeFactIds];
    case "STATIC_CHART":
      return [...task.categoryFactIds, ...task.seriesFactIds, ...task.comparisonFactIds];
    case "PROCESS":
      return [...task.stageFactIds, ...task.edgeFactIds];
    case "MAP":
      return [...task.locationFactIds, ...task.changeFactIds, ...task.directionFactIds];
  }
}

export const taskContextSchema = z.object({
  schemaVersion: z.literal(1),
  task: taskSchema,
  title: z.string().max(240).nullable(),
  units: z.array(z.string().min(1).max(80)),
  facts: z.array(taskFactSchema).min(1),
  limitations: z.array(taskContextLimitationCodeSchema),
}).strict().superRefine((context, refinement) => {
  const factIds = context.facts.map((fact) => fact.factId);
  if (new Set(factIds).size !== factIds.length) {
    refinement.addIssue({ code: "custom", message: "DUPLICATE_FACT_ID" });
  }

  const references = referencedFactIds(context.task);
  if (new Set(references).size !== references.length) {
    refinement.addIssue({ code: "custom", message: "DUPLICATE_FACT_REFERENCE" });
  }

  const knownFacts = new Set(factIds);
  if (references.some((factId) => !knownFacts.has(factId))) {
    refinement.addIssue({ code: "custom", message: "DANGLING_FACT_REFERENCE" });
  }
});

export type FactCertainty = z.infer<typeof factCertaintySchema>;
export type TaskFact = z.infer<typeof taskFactSchema>;
export type TaskContextLimitationCode = z.infer<typeof taskContextLimitationCodeSchema>;
export type TaskContext = z.infer<typeof taskContextSchema>;

export function parseTaskContext(input: unknown): TaskContext {
  return taskContextSchema.parse(input);
}
