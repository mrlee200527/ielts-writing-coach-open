import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";

import { parseTaskContext } from "../../src/domain/task-context/task-context.schema";
import { stableUuid } from "../../src/domain/shared/ids";
import { MiMoClient } from "../../src/infrastructure/llm/mimo-client";
import { loadMiMoConfig } from "../../src/infrastructure/llm/mimo-config";
import { MiMoTaskContextAdapter } from "../../src/infrastructure/llm/mimo-task-context.adapter";

try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

let callCount = 0;
const config = loadMiMoConfig();
const client = new MiMoClient(config);
const adapter = new MiMoTaskContextAdapter(
  {
    complete: async (request) => {
      callCount += 1;
      return client.complete(request);
    },
  },
  config.model,
);

try {
  const image = await readFile("数据/剑雅作文材料/图片/C20-T1-T1.jpg");
  const result = await adapter.executeTaskContext({
    attemptId: stableUuid("mimo-real-task-context-attempt"),
    correlationId: stableUuid("mimo-real-task-context-call"),
    promptVersion: "task-context-v1",
    schemaVersion: 1,
    inputHash: createHash("sha256").update(image).digest("hex"),
    image: { mediaType: "image/jpeg", bytes: image },
    promptText: null,
    mode: "ANALYZE",
  });
  if (!result.ok) throw new Error(`TASK_CONTEXT_${result.code}`);
  parseTaskContext(result.value);
  console.log("GATE_B=PASS");
  console.log(`CALL_COUNT=${callCount}`);
  console.log(`MODEL=${config.model}`);
  console.log(`RESPONSE_ID_HASH=${createHash("sha256").update(result.responseId).digest("hex")}`);
  console.log("TASK_CONTEXT_SCHEMA=PASS");
} catch (error) {
  console.log("GATE_B=FAIL");
  console.log(`CALL_COUNT=${callCount}`);
  console.log(`MODEL=${config.model}`);
  console.log(`ERROR_CODE=${error instanceof Error ? error.message : "UNKNOWN"}`);
  process.exitCode = 1;
}
