import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { InstantEvidenceLocation } from "./instant-feedback-location";
import { instantFeedbackTone } from "./instant-feedback-location";

export type InstantEvidenceDecoration = InstantEvidenceLocation & { pmFrom: number; pmTo: number; messageZh?: string };
export const instantFeedbackPluginKey = new PluginKey<DecorationSet>("instantFeedback");

type TextSegment = { plainFrom: number; plainTo: number; pmFrom: number; pmTo: number };

export function mapEvidenceToDocument(doc: ProseMirrorNode, locations: readonly InstantEvidenceLocation[]): InstantEvidenceDecoration[] {
  const segments: TextSegment[] = [];
  let plainOffset = 0;
  doc.forEach((block, blockOffset, index) => {
    if (index > 0) plainOffset += 1;
    const blockPlainStart = plainOffset;
    if (block.type.name === "paragraph") {
      block.descendants((node, relativePosition) => {
        if (!node.isText || !node.text) return;
        segments.push({ plainFrom: plainOffset, plainTo: plainOffset + node.text.length, pmFrom: blockOffset + 1 + relativePosition, pmTo: blockOffset + 1 + relativePosition + node.text.length });
        plainOffset += node.text.length;
      });
    } else {
      plainOffset = blockPlainStart + block.textBetween(0, block.content.size, "\n").length;
    }
  });

  return locations.flatMap((location) => {
    const start = segments.find((segment) => location.from >= segment.plainFrom && location.from < segment.plainTo);
    const end = segments.find((segment) => location.to > segment.plainFrom && location.to <= segment.plainTo);
    if (!start || !end) return [];
    const coveredPlainLength = segments
      .filter((segment) => segment.plainTo > location.from && segment.plainFrom < location.to)
      .reduce((length, segment) => length + Math.min(segment.plainTo, location.to) - Math.max(segment.plainFrom, location.from), 0);
    if (coveredPlainLength !== location.to - location.from) return [];
    return [{ ...location, pmFrom: start.pmFrom + location.from - start.plainFrom, pmTo: end.pmFrom + location.to - end.plainFrom }];
  });
}

export const InstantFeedbackExtension = Extension.create({
  name: "instantFeedback",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: instantFeedbackPluginKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, current) {
          const next = transaction.getMeta(instantFeedbackPluginKey) as { ranges: InstantEvidenceDecoration[]; active: string | null } | undefined;
          if (!next) return current.map(transaction.mapping, transaction.doc);
          const decorations: Decoration[] = next.ranges.map((range) => Decoration.inline(range.pmFrom, range.pmTo, {
            class: `instant-evidence feedback-tone-${instantFeedbackTone(range.type)}${range.fingerprint === next.active ? " is-active" : ""}`,
            "data-feedback-id": range.fingerprint,
            "data-testid": `instant-evidence-${range.fingerprint}`,
          }));
          return DecorationSet.create(transaction.doc, decorations);
        },
      },
      props: { decorations: (state) => instantFeedbackPluginKey.getState(state) },
    })];
  },
});
