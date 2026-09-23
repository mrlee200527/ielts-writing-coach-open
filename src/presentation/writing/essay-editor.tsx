"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { InstantIssue } from "./instant-check-controller";
import { instantFeedbackTone, locateInstantEvidence } from "./instant-feedback-location";
import { InstantFeedbackExtension, instantFeedbackPluginKey, mapEvidenceToDocument } from "./instant-feedback-extension";

const contentFromText = (value: string) => ({
  type: "doc",
  content: value.split("\n").map((paragraph) => ({ type: "paragraph", content: paragraph ? [{ type: "text", text: paragraph }] : [] })),
});

export type EssayEditorHandle = { revealFeedback: (fingerprint: string) => void };
type EssayEditorProps = { value: string; onChange: (value: string, content: unknown) => void; onSelectionChange?: (text: string) => void; instantIssues?: readonly InstantIssue[]; activeInstantFingerprint?: string | null; onInstantMarkerClick?: (fingerprint: string) => void };

export const EssayEditor = forwardRef<EssayEditorHandle, EssayEditorProps>(function EssayEditor({ value, onChange, onSelectionChange = () => undefined, instantIssues = [], activeInstantFingerprint = null, onInstantMarkerClick = () => undefined }, ref) {
  const [bubbleFingerprint, setBubbleFingerprint] = useState<string | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const previousValueRef = useRef(value);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const [bubblePosition, setBubblePosition] = useState<{ top: number; left: number } | null>(null);
  const editor = useEditor({
    extensions: [StarterKit, InstantFeedbackExtension],
    content: contentFromText(value),
    immediatelyRender: false,
    editorProps: { attributes: { "data-testid": "essay-editor", "aria-label": "Task 1 正文编辑器" } },
    onUpdate: ({ editor: current }) => onChange(current.getText({ blockSeparator: "\n" }), current.getJSON()),
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      onSelectionChange(current.state.doc.textBetween(from, to, "\n"));
    },
  });
  useEffect(() => {
    if (!editor) return;
    const locations = locateInstantEvidence(editor.getText({ blockSeparator: "\n" }), instantIssues);
    const ranges = mapEvidenceToDocument(editor.state.doc, locations).map((range) => ({ ...range, messageZh: instantIssues.find((issue) => issue.fingerprint === range.fingerprint)?.messageZh }));
    const reliable = new Set(ranges.map((range) => range.fingerprint));
    editor.view.dispatch(editor.state.tr.setMeta(instantFeedbackPluginKey, { ranges, active: activeInstantFingerprint }));
  }, [activeInstantFingerprint, bubbleFingerprint, editor, instantIssues, value]);
  const positionBubble = useCallback(() => {
    const region = scrollRegionRef.current;
    if (!region || !bubbleFingerprint || !editor) { setBubblePosition(null); return; }
    const marker = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("[data-feedback-id]")).find((element) => element.dataset.feedbackId === bubbleFingerprint);
    if (!marker) { setBubblePosition(null); return; }
    const markerRect = marker.getBoundingClientRect(); const regionRect = region.getBoundingClientRect();
    const width = 280; const left = Math.max(10, Math.min(markerRect.left - regionRect.left, Math.max(10, region.clientWidth - width - 10)));
    setBubblePosition({ top: markerRect.bottom - regionRect.top + region.scrollTop + 8, left });
  }, [bubbleFingerprint, editor]);
  useEffect(() => {
    positionBubble(); const region = scrollRegionRef.current;
    region?.addEventListener("scroll", positionBubble); window.addEventListener("resize", positionBubble);
    return () => { region?.removeEventListener("scroll", positionBubble); window.removeEventListener("resize", positionBubble); };
  }, [positionBubble, value]);
  useEffect(() => {
    const next = locateInstantEvidence(value, instantIssues)[0]?.fingerprint ?? null;
    setBubbleFingerprint(next);
    if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
    if (next) bubbleTimerRef.current = window.setTimeout(() => { setBubbleFingerprint(null); bubbleTimerRef.current = null; }, 3000);
  }, [instantIssues]);
  useEffect(() => {
    if (!activeInstantFingerprint || !locateInstantEvidence(value, instantIssues).some((location) => location.fingerprint === activeInstantFingerprint)) return;
    setBubbleFingerprint(activeInstantFingerprint);
    if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => { setBubbleFingerprint(null); bubbleTimerRef.current = null; }, 3000);
  }, [activeInstantFingerprint, instantIssues, value]);
  useEffect(() => {
    if (previousValueRef.current === value) return;
    previousValueRef.current = value;
    setBubbleFingerprint(null);
    if (bubbleTimerRef.current !== null) { window.clearTimeout(bubbleTimerRef.current); bubbleTimerRef.current = null; }
  }, [value]);
  useEffect(() => () => { if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current); }, []);
  useImperativeHandle(ref, () => ({
    revealFeedback(fingerprint) {
      if (!editor) return;
      const marker = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("[data-feedback-id]")).find((element) => element.dataset.feedbackId === fingerprint);
      marker?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
  }), [editor]);
  return <div className="editor-surface">
    <div className="editor-toolbar" role="toolbar" aria-label="编辑工具">
      <button type="button" aria-label="加粗" disabled={!editor} className={editor?.isActive("bold") ? "active" : ""} onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></button>
      <button type="button" aria-label="斜体" disabled={!editor} className={editor?.isActive("italic") ? "active" : ""} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button>
      <button type="button" aria-label="项目符号列表" disabled={!editor} className={editor?.isActive("bulletList") ? "active" : ""} onClick={() => editor?.chain().focus().toggleBulletList().run()}>☷</button>
      <span className="toolbar-divider" />
      <button type="button" aria-label="撤销" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>↶</button>
      <button type="button" aria-label="重做" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>↷</button>
    </div>
    <div className="editor-scroll-region" ref={scrollRegionRef} onMouseDownCapture={(event) => {
      if (event.target instanceof Element && event.target.closest(".instant-coaching-action")) event.preventDefault();
    }} onClick={(event) => {
      const marker = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-feedback-id]") : null;
      if (!marker?.dataset.feedbackId) return;
      onInstantMarkerClick(marker.dataset.feedbackId);
      if (event.target instanceof Element && event.target.closest(".instant-coaching-action")) return;
      if (bubbleTimerRef.current !== null) { window.clearTimeout(bubbleTimerRef.current); bubbleTimerRef.current = null; }
      setBubbleFingerprint((current) => current === marker.dataset.feedbackId ? null : marker.dataset.feedbackId ?? null);
    }}><EditorContent editor={editor} />{bubbleFingerprint && bubblePosition ? (() => { const issue = instantIssues.find((candidate) => candidate.fingerprint === bubbleFingerprint); return issue ? <div style={bubblePosition} className={`instant-coaching-bubble feedback-tone-${instantFeedbackTone(issue.type)}`} data-testid={`instant-coaching-bubble-${issue.fingerprint}`} data-message={issue.messageZh}><span>{issue.messageZh}</span><button type="button" className="instant-coaching-action" data-feedback-id={issue.fingerprint} aria-label="查看对应反馈" title="查看对应反馈">↗</button></div> : null; })() : null}</div>
  </div>;
});
