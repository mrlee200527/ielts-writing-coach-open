import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import type { TaskContextLlmResult } from "../../../src/ports/task-context-llm.port";
import { parseTaskContext, type TaskContext, type TaskContextLimitationCode } from "../../../src/domain/task-context/task-context.schema";
import {
  dynamicTaskContextFixture,
  mapTaskContextFixture,
  processTaskContextFixture,
  staticTaskContextFixture,
} from "../../../src/testing/task-context-fixtures";

type TaskKind = TaskContext["task"]["kind"];
type ExpectedStatus = "READY" | "DEGRADED" | "UNAVAILABLE";

interface GoldenMetadata {
  fixtureId: string;
  kind: TaskKind;
  expectedStatus: ExpectedStatus;
  expectedCertainFacts: number;
  expectedUncertaintyCategories: string[];
  expectedLimitationCodes: TaskContextLimitationCode[];
  forbiddenClaims: string[];
  reviewedAt: string;
  schemaVersion: 1;
  promptVersion: string;
  sha256: string;
}

export interface TaskContextGoldenCase {
  metadata: GoldenMetadata;
  pngBytes: Uint8Array;
  replay: TaskContextLlmResult;
}

const metadata = JSON.parse(
  readFileSync(new URL("./goldens.json", import.meta.url), "utf8"),
) as GoldenMetadata[];

const clearContexts: Record<TaskKind, TaskContext> = {
  DYNAMIC_CHART: parseTaskContext(dynamicTaskContextFixture),
  STATIC_CHART: parseTaskContext(staticTaskContextFixture),
  PROCESS: parseTaskContext(processTaskContextFixture),
  MAP: parseTaskContext(mapTaskContextFixture),
};

const uncertainContexts: Record<TaskKind, TaskContext> = {
  DYNAMIC_CHART: uncertainContext(
    clearContexts.DYNAMIC_CHART,
    2,
    "TIME_RANGE_AMBIGUOUS",
    "The exact time range for the final change is unclear.",
    "TIME_RANGE_UNCLEAR",
  ),
  STATIC_CHART: uncertainContext(
    clearContexts.STATIC_CHART,
    2,
    "VALUE_AMBIGUOUS",
    "The exact value for Housing is unclear.",
    "VALUES_PARTIALLY_UNREADABLE",
  ),
  PROCESS: uncertainContext(
    clearContexts.PROCESS,
    1,
    "ARROW_AMBIGUOUS",
    "The definite sequence after pressing is unclear.",
    "PROCESS_FLOW_UNCLEAR",
  ),
  MAP: uncertainContext(
    clearContexts.MAP,
    2,
    "DIRECTION_AMBIGUOUS",
    "The exact direction of the school is unclear.",
    "MAP_ORIENTATION_UNCLEAR",
  ),
};

export const taskContextGoldenCases: readonly TaskContextGoldenCase[] = metadata.map((entry) => {
  const pngBytes = createGoldenPng(entry.fixtureId);
  const context = entry.expectedStatus === "READY"
    ? clearContexts[entry.kind]
    : entry.expectedStatus === "DEGRADED"
      ? uncertainContexts[entry.kind]
      : null;
  const replay: TaskContextLlmResult = context
    ? { ok: true, value: structuredClone(context), model: "fixed-golden-replay", responseId: `replay:${entry.fixtureId}` }
    : { ok: false, code: "TERMINAL" };
  return { metadata: entry, pngBytes, replay };
});

export class DeterministicTaskContextReplay {
  private readonly bySha256: ReadonlyMap<string, TaskContextLlmResult>;

  constructor(cases: readonly TaskContextGoldenCase[]) {
    this.bySha256 = new Map(cases.map((golden) => [golden.metadata.sha256, golden.replay]));
  }

  async execute(pngBytes: Uint8Array): Promise<TaskContextLlmResult> {
    const sha256 = createHash("sha256").update(pngBytes).digest("hex");
    return structuredClone(this.bySha256.get(sha256) ?? { ok: false, code: "TERMINAL" as const });
  }
}

export function embeddedGoldenFixtureId(pngBytes: Uint8Array): string | null {
  const bytes = Buffer.from(pngBytes);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "tEXt") {
      const data = bytes.toString("utf8", dataStart, dataEnd);
      if (data.startsWith("fixtureId\0")) return data.slice("fixtureId\0".length);
    }
    offset = dataEnd + 4;
  }
  return null;
}

function uncertainContext(
  context: TaskContext,
  factIndex: number,
  uncertaintyCategory: NonNullable<TaskContext["facts"][number]["uncertaintyCategory"]>,
  statement: string,
  limitation: TaskContextLimitationCode,
): TaskContext {
  return parseTaskContext({
    ...context,
    facts: context.facts.map((fact, index) => index === factIndex
      ? { ...fact, statement, certainty: "UNCERTAIN", uncertaintyCategory }
      : fact),
    limitations: [limitation],
  });
}

function createGoldenPng(fixtureId: string): Uint8Array {
  const width = 4;
  const height = 3;
  const seed = createHash("sha256").update(fixtureId).digest();
  const raw = Buffer.alloc(height * (1 + width * 3));
  let seedIndex = 0;
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (1 + width * 3);
    raw[rowStart] = 0;
    for (let column = 0; column < width * 3; column += 1) {
      raw[rowStart + 1 + column] = (seed[seedIndex % seed.length] + row * 17 + column * 31) & 0xff;
      seedIndex += 1;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.from(`fixtureId\0${fixtureId}`, "utf8")),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
