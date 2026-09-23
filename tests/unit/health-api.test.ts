import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/health/route";

describe("health endpoint", () => {
  it("returns 200 with { ok: true } as a readiness probe", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
