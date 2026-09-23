export type StablePrefix = {
  stablePrefix: string;
  editableTail: string;
  boundaryIndex: number;
};

const legalBoundaries = new Set([",", ".", "?", "!", ";", ":", "，", "。", "？", "！", "；", "："]);
const abbreviations = new Set(["e.g.", "i.e.", "mr.", "mrs.", "dr.", "etc."]);

const tokenBoundsAt = (text: string, index: number) => {
  let start = index;
  let end = index + 1;
  while (start > 0 && !/\s/u.test(text[start - 1])) start -= 1;
  while (end < text.length && !/\s/u.test(text[end])) end += 1;
  return { start, end, token: text.slice(start, end) };
};

const matchesTechnicalToken = (rawToken: string) => {
  const token = rawToken.replace(/^[\[({<“‘"']+|[\])}>”’"']+$/gu, "");
  const lower = token.toLowerCase();
  if (abbreviations.has(lower)) return true;
  if (/^https?:\/\/[^\s]+$/iu.test(token)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@.]+$/u.test(token)) return true;
  return /^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?:[/?#][^\s]*)?$/iu.test(token);
};

const isTechnicalToken = (rawToken: string, candidateOffset: number) => {
  if (candidateOffset === rawToken.length - 1 && matchesTechnicalToken(rawToken.slice(0, -1))) return false;
  return matchesTechnicalToken(rawToken);
};

const isFalseBoundary = (text: string, index: number) => {
  const character = text[index];
  const before = text[index - 1];
  const after = text[index + 1];
  if ((character === "." || character === "," || character === ":" || character === "：") && /\d/u.test(before ?? "") && /\d/u.test(after ?? "")) return true;
  const token = tokenBoundsAt(text, index);
  return isTechnicalToken(token.token, index - token.start);
};

export function detectStablePrefix(fullText: string): StablePrefix {
  for (let boundaryIndex = fullText.length - 1; boundaryIndex >= 0; boundaryIndex -= 1) {
    if (!legalBoundaries.has(fullText[boundaryIndex]) || isFalseBoundary(fullText, boundaryIndex)) continue;
    return {
      stablePrefix: fullText.slice(0, boundaryIndex + 1),
      editableTail: fullText.slice(boundaryIndex + 1),
      boundaryIndex,
    };
  }
  return { stablePrefix: "", editableTail: fullText, boundaryIndex: -1 };
}
