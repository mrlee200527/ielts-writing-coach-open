import { stableUuid } from "../domain/shared/ids";

const fact = (name: string, statement: string) => ({
  factId: stableUuid(`task-context-fact:${name}`),
  statement,
  certainty: "CERTAIN" as const,
  uncertaintyCategory: null,
  evidence: { regionLabel: name, sourceText: statement },
});

export const dynamicTaskContextFixture = {
  schemaVersion: 1 as const,
  task: {
    kind: "DYNAMIC_CHART" as const,
    chartType: "LINE" as const,
    timeAxisFactIds: [stableUuid("task-context-fact:dynamic-time")],
    seriesFactIds: [stableUuid("task-context-fact:dynamic-series")],
    changeFactIds: [stableUuid("task-context-fact:dynamic-change")],
  },
  title: "Population change",
  units: ["millions"],
  facts: [
    fact("dynamic-time", "The chart covers 2000 to 2020."),
    fact("dynamic-series", "The blue line represents City A."),
    fact("dynamic-change", "City A increased over the period."),
  ],
  limitations: [],
};

export const staticTaskContextFixture = {
  schemaVersion: 1 as const,
  task: {
    kind: "STATIC_CHART" as const,
    chartType: "PIE" as const,
    categoryFactIds: [stableUuid("task-context-fact:static-category")],
    seriesFactIds: [stableUuid("task-context-fact:static-series")],
    comparisonFactIds: [stableUuid("task-context-fact:static-comparison")],
  },
  title: "Household spending",
  units: ["percent"],
  facts: [
    fact("static-category", "Housing is a spending category."),
    fact("static-series", "The chart shows household expenditure."),
    fact("static-comparison", "Housing has the largest share."),
  ],
  limitations: [],
};

export const processTaskContextFixture = {
  schemaVersion: 1 as const,
  task: {
    kind: "PROCESS" as const,
    processType: "LINEAR" as const,
    stageFactIds: [stableUuid("task-context-fact:process-stage")],
    edgeFactIds: [stableUuid("task-context-fact:process-edge")],
  },
  title: "Paper production",
  units: [],
  facts: [
    fact("process-stage", "Pulp is pressed into sheets."),
    fact("process-edge", "Drying follows pressing."),
  ],
  limitations: [],
};

export const mapTaskContextFixture = {
  schemaVersion: 1 as const,
  task: {
    kind: "MAP" as const,
    mapType: "BEFORE_AFTER" as const,
    locationFactIds: [stableUuid("task-context-fact:map-location")],
    changeFactIds: [stableUuid("task-context-fact:map-change")],
    directionFactIds: [stableUuid("task-context-fact:map-direction")],
  },
  title: "Town centre redevelopment",
  units: [],
  facts: [
    fact("map-location", "A park is beside the river."),
    fact("map-change", "The car park was replaced by housing."),
    fact("map-direction", "The school is north of the park."),
  ],
  limitations: [],
};

export const taskContextFixtures = [
  dynamicTaskContextFixture,
  staticTaskContextFixture,
  processTaskContextFixture,
  mapTaskContextFixture,
] as const;
