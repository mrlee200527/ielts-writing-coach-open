import { describe, expect, it } from "vitest";
import { createIdempotencyKey } from "../../src/domain/analysis/idempotency-key";

describe("analysis idempotency key", () => {
  it("is stable for the architecture tuple", () => {
    const input = { scope: "SENTENCE", revisionId: "r1", inputHash: "h1", promptVersion: "v1" } as const;
    expect(createIdempotencyKey(input)).toBe(createIdempotencyKey({ ...input }));
    expect(createIdempotencyKey(input)).not.toBe(createIdempotencyKey({ ...input, inputHash: "h2" }));
  });
});
