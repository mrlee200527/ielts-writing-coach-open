export type ChangedSpan = {
  /** The expanded inspection target (sentence/paragraph bounded), trimmed. */
  target: string;
  /** The sentence immediately before the target (context only), trimmed; "" when none. */
  surroundingBefore: string;
  /** The sentence immediately after the target (context only), trimmed; "" when none. */
  surroundingAfter: string;
  /** Offset of the target start in the current text (untrimmed extent). */
  targetStart: number;
  /** Offset of the target end in the current text (untrimmed extent). */
  targetEnd: number;
};

const isSentenceBoundary = (character: string) => character === "." || character === "!" || character === "?" || character === "…" || character === "\n";

function sentenceExtents(text: string): Array<{ start: number; end: number }> {
  const extents: Array<{ start: number; end: number }> = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    if (isSentenceBoundary(text[index])) {
      let end = index + 1;
      while (end < text.length && /\s/.test(text[end])) end += 1;
      extents.push({ start, end });
      start = end;
      index = end;
    } else {
      index += 1;
    }
  }
  if (start < text.length) extents.push({ start, end: text.length });
  return extents;
}

function containingExtent(extents: ReadonlyArray<{ start: number; end: number }>, offset: number) {
  const clamped = Math.min(Math.max(offset, 0), extents.length > 0 ? extents[extents.length - 1].end : 0);
  return extents.find((extent) => clamped >= extent.start && clamped < extent.end) ?? extents[extents.length - 1];
}

function longestCommonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function longestCommonSuffixLength(left: string, right: string, max: number): number {
  let length = 0;
  while (length < max && left[left.length - 1 - length] === right[right.length - 1 - length]) length += 1;
  return length;
}

const trim = (value: string) => value.trim();

export function computeChangedSpan(previous: string, current: string): ChangedSpan {
  if (previous === "") return { target: trim(current), surroundingBefore: "", surroundingAfter: "", targetStart: 0, targetEnd: current.length };
  if (current === "") return { target: "", surroundingBefore: "", surroundingAfter: "", targetStart: 0, targetEnd: 0 };
  const prefixLength = longestCommonPrefixLength(previous, current);
  const maxSuffix = Math.min(previous.length - prefixLength, current.length - prefixLength);
  const suffixLength = longestCommonSuffixLength(previous, current, maxSuffix);
  const rawStart = prefixLength;
  const rawEnd = current.length - suffixLength;
  // Trim surrounding whitespace inside the raw span to find the first real change.
  let contentStart = rawStart;
  while (contentStart < rawEnd && /\s/.test(current[contentStart])) contentStart += 1;
  let contentEnd = rawEnd;
  while (contentEnd > contentStart && /\s/.test(current[contentEnd - 1])) contentEnd -= 1;
  if (contentStart >= contentEnd) return { target: "", surroundingBefore: "", surroundingAfter: "", targetStart: 0, targetEnd: 0 };
  const extents = sentenceExtents(current);
  const startExtent = containingExtent(extents, contentStart);
  const endExtent = containingExtent(extents, contentEnd - 1);
  const targetStart = startExtent.start;
  const targetEnd = endExtent.end;
  const indexOfStart = extents.indexOf(startExtent);
  const indexOfEnd = extents.indexOf(endExtent);
  const before = indexOfStart > 0 ? extents[indexOfStart - 1] : undefined;
  const after = indexOfEnd >= 0 && indexOfEnd + 1 < extents.length ? extents[indexOfEnd + 1] : undefined;
  return {
    target: trim(current.slice(targetStart, targetEnd)),
    surroundingBefore: before ? trim(current.slice(before.start, before.end)) : "",
    surroundingAfter: after ? trim(current.slice(after.start, after.end)) : "",
    targetStart,
    targetEnd,
  };
}
