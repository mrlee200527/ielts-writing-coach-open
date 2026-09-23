# Functional UI Working MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the existing IELTS Task 1 Working MVP into the supplied three-column prototype UI without changing its real persistence or MiMo contracts.

**Architecture:** Keep `WritingWorkspace` as the state owner and retain the existing PromptPanel, Tiptap editor, autosave controller, and Feedback API. Add small presentation-only sections for navigation, editor chrome, honest feedback empty states, journey, and memory; derive only word count, writing time, and save status from existing state.

**Tech Stack:** Next.js 16.3, React 19, Tiptap, TypeScript, CSS, Vitest, Playwright.

## Global Constraints

- Existing Task/Image/Editor/Autosave/Reload/MiMo feedback remain real.
- Missing scoring, inline analysis, modes, and learning memory remain honest placeholders.
- No Provider, API, database, schema, authentication, or platform changes.
- New York City remains browser/test fixture only; no sample-specific production logic.
- No real MiMo probe; no merge to main; checkpoint only after human approval.

---

### Task 1: Workspace composition

**Files:**
- Modify: `src/presentation/writing/writing-workspace.tsx`
- Create: `src/presentation/writing/workspace-sections.tsx`
- Test: `tests/unit/writing-workspace.test.tsx`

**Interfaces:**
- Consumes: existing `WritingWorkspaceSnapshot`, word count, timer, save state.
- Produces: header modes, three-column shell, journey, and honest learning-memory section.

- [ ] Add assertions for active/disabled modes, journey status, memory empty state, and real derived values.
- [ ] Run the affected test and observe missing-UI failures.
- [ ] Implement the minimum presentational sections and composition.
- [ ] Re-run affected tests to green.

### Task 2: Left and center working surfaces

**Files:**
- Modify: `src/presentation/writing/prompt-panel.tsx`
- Modify: `src/presentation/writing/essay-editor.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/prompt-panel.test.tsx`
- Test: `tests/unit/writing-workspace.test.tsx`

**Interfaces:**
- Consumes: real task image/prompt, `wordCount`, `elapsedMs`, editor value/onChange.
- Produces: prototype-like Task/Image/hint shell/stats and editor toolbar chrome without changing editor behavior.

- [ ] Add assertions for honest hint empty state, real word/time values, image containment hook, and supported toolbar controls.
- [ ] Run affected tests and observe missing-UI failures.
- [ ] Implement presentation-only markup and styles while preserving the approved generic prompt split.
- [ ] Re-run affected tests to green and browser-check the three-column geometry.

### Task 3: Real feedback and honest analysis shells

**Files:**
- Modify: `src/presentation/writing/feedback-panel.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/feedback-panel.test.tsx`

**Interfaces:**
- Consumes: existing feedback endpoint response and current save/word state.
- Produces: real feedback cards after response; waiting/ unavailable states before analysis.

- [ ] Add assertions that no score or personalized improvement is shown before real feedback, and that returned values map into the prototype cards.
- [ ] Run the feedback test and observe missing-UI failures.
- [ ] Recompose existing real feedback into realtime/score/priority cards with honest empty states.
- [ ] Re-run affected tests to green and browser-check density.

### Task 4: Verification and human gate

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: completed UI and existing main-flow test.
- Produces: verified Functional UI candidate for human review.

- [ ] Run affected Vitest suites, `tsc --noEmit`, full ESLint, `git diff --check`, and Writing Main Flow E2E.
- [ ] Browser-smoke the existing New York session at desktop widths for prompt/image/editor/feedback/no overflow/no runtime errors.
- [ ] Record exact verification evidence in `CHANGELOG.md`.
- [ ] Mark the page as ready for Human Visual Gate and stop without commit or merge.
