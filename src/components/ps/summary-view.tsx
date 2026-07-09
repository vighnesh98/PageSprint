// Lightweight Markdown-ish renderer for AI summaries.
// Auto-highlights key definitions; optionally renders diagrams under their topic header.
import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { ImageLightbox } from "./image-lightbox";

export type SummaryDiagram = { topic: string; dataUrl: string; caption: string };


function normTopic(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function SummaryView({
  md,
  onBulletClick,
  citationMode = false,
  diagrams = [],
}: {
  md: string;
  onBulletClick?: (bulletText: string) => void;
  citationMode?: boolean;
  diagrams?: SummaryDiagram[];
}) {
  const [zoom, setZoom] = useState<SummaryDiagram | null>(null);
  const renderFigure = (d: SummaryDiagram, key: string | number) => (
    <figure key={key} className="group relative rounded-lg border bg-card overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setZoom(d)}
        className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-primary"
        aria-label={`View ${d.caption || d.topic} fullscreen`}
      >
        <img src={d.dataUrl} alt={d.caption || d.topic} className="w-full h-auto object-contain bg-background transition-transform group-hover:scale-[1.01]" loading="lazy" />
        <span className="absolute top-2 right-2 h-7 w-7 rounded-full bg-background/85 backdrop-blur grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
          <Maximize2 className="h-3.5 w-3.5 text-foreground" />
        </span>
      </button>
      {d.caption && (
        <figcaption className="px-3 py-2 text-[11px] text-muted-foreground border-t">{d.caption}</figcaption>
      )}
    </figure>
  );

  const lines = md.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let currentHeader: string | null = null;
  const diagramsByTopic = new Map<string, SummaryDiagram[]>();
  for (const d of diagrams) {
    const k = normTopic(d.topic);
    const arr = diagramsByTopic.get(k) ?? [];
    arr.push(d);
    diagramsByTopic.set(k, arr);
  }

  const flushDiagramsForHeader = (header: string | null, key: string) => {
    if (!header) return;
    const items = diagramsByTopic.get(normTopic(header));
    if (!items?.length) return;
    blocks.push(
      <div key={`dg-${key}`} className="my-3 grid sm:grid-cols-2 gap-3">
        {items.map((d, i) => renderFigure(d, i))}
      </div>
    );
    // Mark as consumed so it doesn't re-render
    diagramsByTopic.delete(normTopic(header));
  };



  const flushList = (key: string) => {
    if (!listBuf.length) return;
    const items = listBuf.slice();
    blocks.push(
      <ul key={`ul-${key}`}>
        {items.map((l, i) => {
          const clickable = citationMode && !!onBulletClick;
          return (
            <li
              key={i}
              onClick={clickable ? () => onBulletClick!(l) : undefined}
              className={
                clickable
                  ? "cursor-pointer rounded-md transition-colors hover:bg-primary/10 hover:ring-1 hover:ring-primary/30 px-1 -mx-1"
                  : undefined
              }
              title={clickable ? "Jump to source OCR line" : undefined}
              dangerouslySetInnerHTML={{ __html: highlight(inline(l)) }}
            />
          );
        })}
      </ul>,
    );
    listBuf = [];
  };
  function inline(s: string) {
    return s
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
  // Precise keyword highlighting — only underlines named terms introduced by
  // explicit definitional cues. No capitalised-word guessing (which was
  // painting random text).
  function highlight(html: string) {
    // "Label: definition" — only when the label is short (≤ 6 words) and starts the line.
    html = html.replace(
      /^([A-Z][A-Za-z0-9][A-Za-z0-9 \-/'’()]{0,48}?)(\s*[:—–]\s+)(.+)$/,
      (m: string, term: string, sep: string, body: string) => {
        if (term.trim().split(/\s+/).length > 6) return m;
        return `<mark class="def-term">${term}</mark>${sep}<span class="def-body">${body}</span>`;
      },
    );
    // "... is/are/was/were called|known as|termed|referred to as <TERM>"
    const stop = "(?=[.,;:!?)]|\\s+(?:and|or|which|when|where|because|by|in|on|for|with|to|from|of|due|through|via|as|—|–)\\b|$)";
    html = html.replace(
      new RegExp(
        `\\b(is|are|was|were)\\s+(called|known\\s+as|termed|referred\\s+to\\s+as)\\s+([A-Za-z][A-Za-z0-9 \\-/'’()]{1,60}?)${stop}`,
        "gi",
      ),
      (_m, v: string, rel: string, term: string) =>
        `${v} <em class="def-rel">${rel}</em> <mark class="def-key">${term.trim()}</mark>`,
    );
    // "<TERM> is/are defined as ..." — underline the leading term (short only).
    html = html.replace(
      /(^|(?<=[.!?]\s)|(?<=:\s))([A-Z][A-Za-z0-9 \-/'’()]{1,50}?)\s+(is|are)\s+defined\s+as\s+/,
      (m: string, pre: string, term: string, v: string) => {
        if (term.trim().split(/\s+/).length > 6) return m;
        return `${pre}<mark class="def-key">${term.trim()}</mark> ${v} <em class="def-rel">defined as</em> `;
      },
    );
    return html;
  }
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(String(idx)); return; }
    if (/^---+$/.test(line.trim())) {
      flushList(String(idx));
      flushDiagramsForHeader(currentHeader, `hr-${idx}`);
      currentHeader = null;
      blocks.push(<hr key={`hr-${idx}`} className="my-4 border-border" />);
      return;
    }
    const headerOnly = line.trim().match(/^\*\*(.+?)\*\*\s*:?\s*$/);
    if (headerOnly) {
      flushList(String(idx));
      flushDiagramsForHeader(currentHeader, `pre-${idx}`);
      currentHeader = headerOnly[1];
      blocks.push(<h2 key={`h-${idx}`}>{headerOnly[1]}</h2>);
      return;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) { listBuf.push(bullet[2]); return; }
    flushList(String(idx));
    blocks.push(<p key={`p-${idx}`} dangerouslySetInnerHTML={{ __html: highlight(inline(line)) }} />);
  });
  flushList("end");
  flushDiagramsForHeader(currentHeader, "end");

  // Any diagrams whose topic didn't match a header — append as an "Other diagrams" section
  const leftover: SummaryDiagram[] = [];
  diagramsByTopic.forEach((arr) => leftover.push(...arr));
  if (leftover.length) {
    blocks.push(
      <div key="dg-other" className="mt-4">
        <h2>Diagrams</h2>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          {leftover.map((d, i) => renderFigure(d, `lo-${i}`))}
        </div>
      </div>
    );
  }

  return (
    <div className="prose-summary text-sm text-foreground/90">
      {blocks}
      <ImageLightbox
        src={zoom?.dataUrl ?? null}
        alt={zoom?.caption || zoom?.topic}
        caption={zoom?.caption}
        onClose={() => setZoom(null)}
      />
    </div>
  );
}

