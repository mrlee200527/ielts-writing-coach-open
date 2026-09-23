import { describe, expect, it } from "vitest";
import { detectStablePrefix } from "../../src/presentation/writing/stable-prefix";

describe("detectStablePrefix", () => {
  it.each([
    ["This is useful,", "This is useful,", "", 14],
    ["This is useful.", "This is useful.", "", 14],
    ["Really?", "Really?", "", 6],
    ["Stop!", "Stop!", "", 4],
    ["First; second", "First;", " second", 5],
    ["Reason: explanation", "Reason:", " explanation", 6],
    ["这是草稿，", "这是草稿，", "", 4],
    ["这是草稿。", "这是草稿。", "", 4],
    ["真的吗？", "真的吗？", "", 3],
    ["停止！", "停止！", "", 2],
    ["第一；第二", "第一；", "第二", 2],
    ["原因：解释", "原因：", "解释", 2],
    ["虽然这个观点有道理，但是 I don't fully agree,", "虽然这个观点有道理，但是 I don't fully agree,", "", 32],
    ["Sentence one. Sentence two, unfinished tail", "Sentence one. Sentence two,", " unfinished tail", 26],
    ["He called it “consumer manipulation”", "", "He called it “consumer manipulation”", -1],
    ["He called it “consumer manipulation”.", "He called it “consumer manipulation”.", "", 36],
  ])("returns the last legal boundary without changing the original text: %s", (fullText, stablePrefix, editableTail, boundaryIndex) => {
    expect(detectStablePrefix(fullText)).toEqual({ stablePrefix, editableTail, boundaryIndex });
    expect(stablePrefix + editableTail).toBe(fullText);
  });

  it.each([
    "3.5",
    "6.5",
    "0.25",
    "1,000",
    "10,000",
    "12:30",
    "09:45",
    "12：30",
    "e.g.",
    "i.e.",
    "Mr.",
    "Mrs.",
    "Dr.",
    "etc.",
    "https://example.com",
    "example.com",
    "student@example.com",
  ])("conservatively rejects technical punctuation in %s", (fullText) => {
    expect(detectStablePrefix(fullText)).toEqual({ stablePrefix: "", editableTail: fullText, boundaryIndex: -1 });
  });

  it.each([
    ["The figure rose to 3.5", "", "The figure rose to 3.5", -1],
    ["For example, e.g. advertising", "For example,", " e.g. advertising", 11],
    ["Visit https://example.com for details", "", "Visit https://example.com for details", -1],
    ["Contact student@example.com for details", "", "Contact student@example.com for details", -1],
    ["Visit https://example.com.", "Visit https://example.com.", "", 25],
    ["Contact student@example.com!", "Contact student@example.com!", "", 27],
  ])("falls back to an earlier real boundary when later punctuation is false: %s", (fullText, stablePrefix, editableTail, boundaryIndex) => {
    expect(detectStablePrefix(fullText)).toEqual({ stablePrefix, editableTail, boundaryIndex });
  });
});
