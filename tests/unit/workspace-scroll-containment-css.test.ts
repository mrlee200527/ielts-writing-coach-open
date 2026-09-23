import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");
const rules = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
};
const ruleContaining = (selector: string, needle: string) => rules(selector).find((rule) => rule.includes(needle)) ?? "";

describe("writing workspace scroll containment", () => {
  it("keeps the document scrollable while giving only the three-column grid a near-viewport height", () => {
    const app = ruleContaining(".writing-app", "min-width: 1180px");
    expect(app).not.toMatch(/height:\s*100dvh/);
    expect(app).not.toMatch(/overflow:\s*hidden/);
    const desktopContent = ruleContaining(".workspace-content", "max-width: 1800px");
    expect(desktopContent).not.toMatch(/grid-template-rows/);
    expect(desktopContent).not.toMatch(/overflow:\s*hidden/);
    expect(ruleContaining(".workspace-grid", "310px")).toMatch(/height:\s*calc\(100dvh\s*-\s*88px\)/);
    expect(ruleContaining(".workspace-grid", "310px")).toMatch(/min-height:\s*0/);
  });

  it.each([".prompt-panel", ".editor-panel", ".feedback-column"])("lets %s shrink inside the grid", (selector) => {
    const desktopColumn = ruleContaining(selector, "min-height: 0");
    expect(desktopColumn).toMatch(/height:\s*100%/);
    expect(desktopColumn).toMatch(/min-height:\s*0/);
  });

  it("keeps issue-kind labels on one line without shrinking", () => {
    const issueKind = ruleContaining(".issue-kind", "white-space");
    expect(issueKind).toMatch(/white-space:\s*nowrap/);
    expect(issueKind).toMatch(/flex-shrink:\s*0/);
    expect(issueKind).toMatch(/align-self:\s*flex-start/);
  });

  it("keeps the feedback save badge on one line beside long status copy", () => {
    const saveBadge = ruleContaining(".save-badge", "font-size: 11px");
    expect(saveBadge).toMatch(/white-space:\s*nowrap/);
    expect(saveBadge).toMatch(/flex-shrink:\s*0/);
  });
});
