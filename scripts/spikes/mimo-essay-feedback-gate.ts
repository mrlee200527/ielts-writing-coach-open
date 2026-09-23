import { createHash } from "node:crypto";
import { loadEnvFile } from "node:process";

import { parseEssayFeedback } from "../../src/domain/feedback/essay-feedback.schema";
import { MiMoClient } from "../../src/infrastructure/llm/mimo-client";
import { loadMiMoConfig } from "../../src/infrastructure/llm/mimo-config";
import { MiMoEssayFeedbackAdapter } from "../../src/infrastructure/llm/mimo-essay-feedback.adapter";

try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const essay = `The bar charts compare the proportions of Australian men and women in six age groups who regularly exercised in 2010. Overall, women were more active than men in every group except those aged fifteen to twenty-four. Female participation remained comparatively stable across most ages, whereas the male figures varied more noticeably.

Among the youngest people, 52.8 percent of males exercised regularly, compared with 47.7 percent of females. The male rate then fell sharply to 42.2 percent for the 25-to-34 group and reached its lowest point, 39.5 percent, among people aged 35 to 44. By contrast, the corresponding female proportions increased to 48.9 percent and 52.5 percent respectively.

For those aged 45 to 54, the difference was also substantial: 53.3 percent of women exercised, while the figure for men was 43.1 percent. In the 55-to-64 category, female participation peaked at 53 percent, compared with 45.1 percent for males. Finally, the rates converged among people aged 65 and over, at 47.1 percent for women and 46.7 percent for men. Thus, the gender gap was widest in middle age and almost disappeared in the oldest group.`;

let callCount = 0;
const config = loadMiMoConfig();
const client = new MiMoClient(config);
const adapter = new MiMoEssayFeedbackAdapter(
  {
    complete: async (request) => {
      callCount += 1;
      return client.complete(request);
    },
  },
  config.model,
);

try {
  const result = await adapter.executeEssayFeedback({
    sessionId: "working-mvp-real-feedback-gate",
    promptVersion: "essay-feedback-v1",
    inputHash: createHash("sha256").update(essay).digest("hex"),
    promptText: [
      "Provide non-official IELTS Academic Writing Task 1 feedback for this essay.",
      "The chart facts in the essay are the source context for this fixed provider gate.",
      essay,
    ].join("\n\n"),
  });
  if (!result.ok) throw new Error(`ESSAY_FEEDBACK_${result.code}`);
  parseEssayFeedback(result.value);
  console.log("GATE_D=PASS");
  console.log(`CALL_COUNT=${callCount}`);
  console.log(`MODEL=${config.model}`);
  console.log(`RESPONSE_ID_HASH=${createHash("sha256").update(result.responseId).digest("hex")}`);
  console.log("ESSAY_FEEDBACK_SCHEMA=PASS");
} catch (error) {
  console.log("GATE_D=FAIL");
  console.log(`CALL_COUNT=${callCount}`);
  console.log(`MODEL=${config.model}`);
  console.log(`ERROR_CODE=${error instanceof Error && /^ESSAY_FEEDBACK_[A-Z_]+$/.test(error.message) ? error.message : "ESSAY_FEEDBACK_INVALID_STRUCTURE"}`);
  process.exitCode = 1;
}
