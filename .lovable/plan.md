# Plan

## 1. Vision-detection & diagram extraction
- Add a `diagrams` storage bucket (public) keyed by `userId/summaryId/diagram-N.jpg`.
- New server fn `extractDiagrams({ pageImages, summaryMd })` in `src/lib/ai.functions.ts`:
  - For each page image, call `google/gemini-2.5-flash` (vision) with the summary's topic list, asking for `{ topic, bbox:[x,y,w,h] (0–1), caption }` JSON per detected diagram.
  - Crop client-side via canvas using the bbox, upload the JPEG to the `diagrams` bucket, return `{ topic, url, caption }[]`.
- Uploader workflow: when `profile.diagrams_enabled === true`, run extraction after the summary completes, then `update summaries.diagrams = [...]`.
- `summary-view.tsx`: drop the existing text-above behavior. Instead, render each diagram inline directly under the matching topic heading (matched by normalized topic string), as an `<img>` card with caption. No standalone gallery — diagrams live within their topic.
- Folder placement: diagrams belong to the summary, which already lives in the topic/subject folder — no separate folder tree needed. (If you want a literal folder-of-images view too, say so and I'll add it.)

## 2. Course-switch clean slate
- Replace the silent `syncCourseFolders` call in `settings.tsx` with an `AlertDialog` confirming the wipe.
- New server fn `switchCourse({ course })`: deletes all `summaries`, all `folders`, all `shared_imports` for the user; updates `profiles.course`; re-runs `syncCourseFolders`.
- Client also clears localStorage keys we own (`ps:*`) and invalidates every query.

## 3. Background process persistence
- Move the upload/OCR/summary job state out of `workspace.tsx` component state into a module-level `jobStore` (Zustand) so unmounting the workspace tab doesn't cancel it.
- Each job tracks `{ id, file, phase, progress, error, resultSummaryId }`; the workspace tab subscribes and renders the in-progress job when mounted, but the async pipeline keeps running.
- Show a small "Jobs running (N)" pill in the sidebar header so users see progress from any tab.
- Cancel button stays in the workspace tab. Navigating away no longer aborts.

## 4. Sidebar reorder + Global Search
- Sidebar order becomes: Workspace, History, Share History, **Global Search**, Theme toggle, **Settings**, user email, sign out.
- New `Global Search` view (`src/components/ps/global-search.tsx`):
  - Empty state on open (no history listed).
  - Search input with debounced fuzzy match against `summaries.title` + `summaries.summary_md` (substring, case-insensitive; uses Postgres `ilike` with `%term%` on both fields, scored client-side by match position).
  - Results list links into the summary view.
  - "Back" button returns to the previous sidebar tab (tracked via a `lastView` ref in `routes/index.tsx`).

## Technical notes
- DB: add `diagrams` storage bucket via tool; no schema migration needed (`summaries.diagrams` already exists).
- Cropping runs in the browser (canvas) since vision returns normalized bboxes and we already have page image data URLs in memory during processing.
- Vision call batches pages (max 6 per request) to keep latency/cost down.
- All new UI uses existing tokens — no hardcoded colors.

---

# 15 feature recommendations

1. **Flashcard mode** — auto-generate Q/A flashcards from any summary; spaced-repetition review tab.
2. **Quiz generator** — MCQ + short-answer quizzes per summary with instant grading.
3. **Topic-level chat** — "Ask this summary" RAG chat scoped to a single document.
4. **Cross-folder chat** — ask a question across an entire subject folder.
5. **Audio summaries** — TTS playback of any summary (Lovable AI TTS).
6. **Voice-note ingest** — record/upload audio lecture → transcribe → summarize.
7. **Handwriting OCR mode** — explicit pipeline tuned for handwritten notes.
8. **Cornell-notes export** — alternate summary layout (cue / notes / summary) + PDF export.
9. **Diagram labeling** — after diagram extraction, AI labels parts on hover.
10. **Study streak + daily plan** — gamified daily review queue based on what's been added.
11. **Shared classroom folders** — teacher shares a folder; students see read-only summaries.
12. **Public profile pages** — opt-in public page listing a user's shared summaries.
13. **Mobile camera capture** — snap pages from phone, auto-stitch, OCR.
14. **Exam mode** — timed mixed quiz across selected folders with score history.
15. **Highlight + sticky-note layer** — annotate any summary; notes searchable in Global Search.

Want me to proceed with sections 1–4? And tell me which of the 15 to queue up next.