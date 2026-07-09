import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listMyShares, revokeShareLink } from "@/lib/share.functions";
import { SummaryView } from "./summary-view";
import { ShareDialog } from "./history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Share2,
  Copy,
  Check,
  Link2Off,
  ExternalLink,
  Search,
  ChevronDown,
  Download,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { exportSummaryPdf } from "@/lib/pdf-export";

type ShareRow = {
  id: string;
  title: string;
  subject?: string | null;
  mode: string;
  summary_md: string;
  qa: unknown;
  page_count: number;
  folder_id: string | null;
  created_at: string;
  share_token: string;
  shared_at: string | null;
};

export function PsShareHistory() {
  const qc = useQueryClient();
  const fList = useServerFn(listMyShares);
  const fRevoke = useServerFn(revokeShareLink);
  const [open, setOpen] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [shareDialog, setShareDialog] = useState<{ id: string; title: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const q = useQuery({
    queryKey: ["my-shares"],
    queryFn: () => fList(),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => fRevoke({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      qc.invalidateQueries({ queryKey: ["summaries"] });
      toast.success("Link revoked");
      setShareDialog(null);
    },
  });

  if (q.isLoading)
    return (
      <div className="grid gap-3 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-muted/40" />
        ))}
      </div>
    );

  const rows = ((q.data ?? []) as ShareRow[]).filter((r) =>
    !query
      ? true
      : r.title.toLowerCase().includes(query.toLowerCase()) ||
        (r.subject ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  if (!q.data?.length) {
    return (
      <div className="text-center py-24 text-muted-foreground text-sm">
        <Share2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
        No shared links yet.
        <p className="mt-1 text-xs">Open any saved summary and click <strong>Share</strong> to create a read-only link.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 mb-4 flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/15 grid place-items-center shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div>
          <div className="font-semibold text-sm">Your share history</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            All read-only links you've generated. Recipients can view, download, and (after sign-in) auto-save to their own library.
          </p>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shared summaries…"
          className="pl-9 h-10 rounded-full bg-card"
        />
      </div>

      <div className="grid gap-2.5">
        {rows.map((r) => {
          const isOpen = open === r.id;
          const url =
            typeof window !== "undefined" ? `${window.location.origin}/s/${r.share_token}` : "";
          const qa = (r.qa as { question: string; answer: string }[]) ?? [];
          return (
            <article
              key={r.id}
              className={`rounded-xl border bg-card overflow-hidden transition-all ${
                isOpen ? "ring-1 ring-primary/40 shadow-md" : "hover:border-foreground/20 hover:shadow-sm"
              }`}
            >
              <div className="flex items-center gap-3 px-3 sm:px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 text-primary grid place-items-center">
                    <Share2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.title}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                      {r.subject && <span className="text-primary font-medium">{r.subject}</span>}
                      <span>· {r.page_count}p</span>
                      <span>
                        · shared {r.shared_at ? new Date(r.shared_at).toLocaleString() : "—"}
                      </span>
                    </div>
                  </div>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  title="Copy link"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setCopiedId(r.id);
                      toast.success("Link copied");
                      setTimeout(() => setCopiedId(null), 1500);
                    } catch {
                      toast.error("Could not copy");
                    }
                  }}
                >
                  {copiedId === r.id ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <a href={url} target="_blank" rel="noreferrer" className="h-8 px-2 grid place-items-center text-muted-foreground hover:text-foreground" title="Open">
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="h-8 w-8 grid place-items-center text-muted-foreground"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
              </div>

              {isOpen && (
                <div className="border-t bg-muted/20">
                  <div className="px-3 sm:px-4 py-2 flex flex-wrap items-center gap-1.5 border-b bg-background/60">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full h-7 text-xs"
                      onClick={() =>
                        setShareDialog({ id: r.id, title: r.title, token: r.share_token })
                      }
                    >
                      <Share2 className="h-3.5 w-3.5 mr-1" /> Manage link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full h-7 text-xs"
                      onClick={() =>
                        exportSummaryPdf({
                          title: r.title,
                          subject: r.subject,
                          summaryMd: r.summary_md,
                          qa,
                          diagrams: (r as any).diagrams ?? [],
                        })
                      }
                    >
                      <Download className="h-3.5 w-3.5 mr-1" /> PDF
                    </Button>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("Revoke this share link?")) revokeMut.mutate(r.id);
                      }}
                    >
                      <Link2Off className="h-3.5 w-3.5 mr-1" /> Revoke
                    </Button>
                  </div>
                  <div className="p-4 sm:p-5">
                    <SummaryView md={r.summary_md} diagrams={(r as any).diagrams ?? []} />
                    {qa.length > 0 && (
                      <div className="mt-5 border-t pt-4">
                        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                          <ListChecks className="h-4 w-4 text-primary" /> Practice Q&amp;A
                        </h3>
                        <Accordion type="multiple" className="space-y-1">
                          {qa.map((it, i) => (
                            <AccordionItem
                              key={i}
                              value={`qa-${i}`}
                              className="border rounded-md px-3 bg-card"
                            >
                              <AccordionTrigger className="text-sm text-left">{`Q${i + 1}. ${it.question}`}</AccordionTrigger>
                              <AccordionContent className="text-sm text-muted-foreground">
                                {it.answer}
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <ShareDialog
        item={shareDialog}
        copied={copied}
        setCopied={setCopied}
        onClose={() => setShareDialog(null)}
        onRevoke={(id) => revokeMut.mutate(id)}
        revoking={revokeMut.isPending}
      />
    </>
  );
}
