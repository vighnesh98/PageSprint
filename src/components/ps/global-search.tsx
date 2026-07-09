import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchSummaries } from "@/lib/search.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search, Loader2, FileText } from "lucide-react";
import { SummaryView } from "./summary-view";

export function PsGlobalSearch({ onBack }: { onBack: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const run = useServerFn(searchSummaries);

  // debounce
  useMemo(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: () => run({ data: { q: debounced } }),
    enabled: debounced.length >= 1,
  });

  // Client-side fuzzy ranking — substring with position score
  const results = useMemo(() => {
    const rows = query.data ?? [];
    const term = debounced.toLowerCase();
    if (!term) return [];
    return [...rows]
      .map((r) => {
        const t = r.title.toLowerCase();
        const titleIdx = t.indexOf(term);
        const bodyIdx = r.summary_md.toLowerCase().indexOf(term);
        const score =
          (titleIdx === 0 ? 100 : titleIdx > 0 ? 60 - Math.min(40, titleIdx) : 0) +
          (bodyIdx >= 0 ? 30 - Math.min(20, Math.floor(bodyIdx / 50)) : 0);
        return { r, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.r);
  }, [query.data, debounced]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="rounded-full">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search across all your summaries…"
          className="pl-9 h-11 text-base"
        />
        {query.isFetching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {!debounced ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Start typing to find any summary by title, subject, or content.
        </div>
      ) : results.length === 0 && !query.isFetching ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No matches for <strong className="text-foreground">{debounced}</strong>.
        </div>
      ) : (
        <div className="grid gap-2">
          {results.map((r) => {
            const isOpen = openId === r.id;
            return (
              <article
                key={r.id}
                className={`rounded-xl border bg-card overflow-hidden transition-all ${
                  isOpen ? "ring-1 ring-primary/40 shadow-md" : "hover:border-foreground/20"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : r.id)}
                  className="w-full text-left flex items-center gap-3 px-3 sm:px-4 py-3"
                >
                  <div className="h-9 w-9 shrink-0 rounded-lg grid place-items-center bg-primary/10 text-primary">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{highlightTitle(r.title, debounced)}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground mt-0.5">
                      {r.subject && <span className="text-primary font-medium">{r.subject}</span>}
                      <span>· {r.page_count}p</span>
                      <span>· {new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t bg-muted/20 p-4">
                    <SummaryView md={r.summary_md} diagrams={(r as any).diagrams ?? []} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function highlightTitle(title: string, term: string) {
  if (!term) return title;
  const idx = title.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return title;
  return (
    <>
      {title.slice(0, idx)}
      <mark className="bg-primary/20 text-foreground rounded px-0.5">{title.slice(idx, idx + term.length)}</mark>
      {title.slice(idx + term.length)}
    </>
  );
}
