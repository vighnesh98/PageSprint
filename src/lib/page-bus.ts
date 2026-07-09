// Tiny in-process event bus so the Extension tab can push imported pages
// into the always-mounted Workspace tab without prop drilling.
import type { UploadedPage } from "@/components/ps/uploader";

type Handler = (pages: UploadedPage[]) => void;
const handlers = new Set<Handler>();

export function onPagesImported(fn: Handler): () => void {
  handlers.add(fn);
  return () => { handlers.delete(fn); };
}

export function emitPagesImported(pages: UploadedPage[]) {
  handlers.forEach((h) => {
    try { h(pages); } catch { /* ignore */ }
  });
}
