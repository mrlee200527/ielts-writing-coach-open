import { describe, expect, it } from "vitest";

import { loadMiMoConfig } from "../../src/infrastructure/llm/mimo-config";

describe("loadMiMoConfig", () => {
  it("fails closed when any required MiMo setting is missing", () => {
    expect(() => loadMiMoConfig({})).toThrow("MIMO_CONFIGURATION_MISSING");
    expect(() => loadMiMoConfig({ MIMO_API_KEY: "key", MIMO_BASE_URL: "https://example.test/v1" })).toThrow(
      "MIMO_CONFIGURATION_MISSING",
    );
  });

  it.each([
    "http://remote.example/v1",
    "https://user:password@example.test/v1",
    "https://example.test/v1?secret=value",
    "https://example.test/v1#fragment",
  ])("rejects unsafe base URL %s", (baseUrl) => {
    expect(() => loadMiMoConfig({ MIMO_API_KEY: "key", MIMO_BASE_URL: baseUrl, MIMO_MODEL: "mimo-v2.5" })).toThrow(
      "MIMO_CONFIGURATION_INVALID",
    );
  });

  it("returns exact configured values and permits local HTTP development", () => {
    expect(
      loadMiMoConfig({ MIMO_API_KEY: " key ", MIMO_BASE_URL: "http://127.0.0.1:8080/v1/", MIMO_MODEL: " mimo-v2.5 " }),
    ).toEqual({ apiKey: "key", baseUrl: "http://127.0.0.1:8080/v1", model: "mimo-v2.5" });
  });
});
