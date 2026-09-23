import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next.js development UI", () => {
  it("hides the development indicator from the product page", () => {
    expect(nextConfig.devIndicators).toBe(false);
  });
});
