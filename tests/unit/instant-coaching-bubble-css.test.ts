import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("instant coaching bubble pointer behavior", () => {
  it("keeps essay evidence text-editable while only the small action accepts pointers", () => {
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toMatch(/\.instant-evidence\s*\{[^}]*cursor:\s*text;/);
    expect(css).toMatch(/\.instant-coaching-bubble\s*\{[^}]*pointer-events:\s*none;/);
    expect(css).toMatch(/\.instant-coaching-action\s*\{[^}]*pointer-events:\s*auto;/);
  });
});
