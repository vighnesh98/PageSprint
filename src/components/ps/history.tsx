import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { listSummaries, deleteSummary } from "@/lib/data.functions";
import { createShareLink, revokeShareLink } from "@/lib/share.functions";
import { SummaryView } from "./summary-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  FileText,
  Trash2,
  Download,
  Share2,
  Search,
  ChevronDown,
  ListChecks,
  Copy,
  Check,
  Link2Off,
  Clock,
  X,
  CheckSquare,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { exportSummaryPdf } from "@/lib/pdf-export";
import type { Folder } from "./sidebar";

type SummaryRow = {
  id: string;
  title: string;
  subject?: string | null;
  mode: string;
  summary_md: string;
  qa: unknown;
  page_count: number;
  folder_id: string | null;
  created_at: string;
  share_token?: string | null;
  diagrams?: { topic: string; dataUrl: string; caption: string }[] | null;
};

export function PsHistory({
  folders,
  initialSelectMode = false,
  onSelectModeConsumed,
}: {
  folders: Folder[];
  initialSelectMode?: boolean;
  onSelectModeConsumed?: () => void;
}) {
  const qc = useQueryClient();
  const fetchList = useServerFn(listSummaries);
  const del = useServerFn(deleteSummary);
  const share = useServerFn(createShareLink);
  const revoke = useServerFn(revokeShareLink);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [shareDialog, setShareDialog] = useState<{ id: string; title: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    if (initialSelectMode) {
      setSelectMode(true);
      setSelected(new Set());
      onSelectModeConsumed?.();
      toast.message("Select summaries to delete", {
        description: "Tap items to select — you get one shot to clear whatever you want.",
      });
    }
  }, [initialSelectMode, onSelectModeConsumed]);

  const q = useQuery({
    queryKey: ["summaries", "all"],
    queryFn: () => fetchList({ data: {} }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      toast.success("Deleted");
    },
  });

  const shareMut = useMutation({
    mutationFn: ({ id }: { id: string; title: string }) => share({ data: { id } }),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      setShareDialog({ id: vars.id, title: vars.title, token: r.token });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      toast.success("Link revoked");
      setShareDialog(null);
    },
  });

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const rows = (q.data ?? []) as SummaryRow[];
  const filtered = query
    ? rows.filter((r) => {
        const s = query.toLowerCase();
        return (
          r.title.toLowerCase().includes(s) ||
          (r.subject ?? "").toLowerCase().includes(s) ||
          r.summary_md.toLowerCase().includes(s)
        );
      })
    : rows;

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const runBulkDelete = async () => {
    if (!selected.size) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selected);
      // Delete in parallel
      const results = await Promise.allSettled(ids.map((id) => del({ data: { id } })));
      const failed = results.filter((r) => r.status === "rejected").length;
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      if (failed) toast.warning(`Deleted ${ids.length - failed} · ${failed} failed`);
      else toast.success(`Deleted ${ids.length} summar${ids.length === 1 ? "y" : "ies"}`);
      setSelected(new Set());
      setSelectMode(false);
      setConfirmOpen(false);
    } finally {
      setBulkDeleting(false);
    }
  };

  if (q.isLoading)
    return (
      <div className="grid gap-3 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-muted/40" />
        ))}
      </div>
    );

  if (!rows.length) {
    return (
      <div className="text-center py-24 text-muted-foreground text-sm">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
        No saved summaries yet.
      </div>
    );
  }

  // Group by date bucket
  const buckets: Record<string, SummaryRow[]> = {};
  const today = new Date();
  const dayKey = (d: Date) => d.toDateString();
  for (const r of filtered) {
    const d = new Date(r.created_at);
    const diffDays = Math.floor((+today - +d) / 86400000);
    const label =
      dayKey(d) === dayKey(today)
        ? "Today"
        : diffDays === 1
          ? "Yesterday"
          : diffDays < 7
            ? "This week"
            : diffDays < 30
              ? "This month"
              : "Earlier";
    (buckets[label] ??= []).push(r);
  }
  const order = ["Today", "Yesterday", "This week", "This month", "Earlier"];

  return (
    <>
      <div className="sticky top-[60px] -mx-4 sm:mx-0 px-4 sm:px-0 py-3 mb-3 bg-background/85 backdrop-blur-xl z-[5] space-y-2">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, subject, or content…"
            className="pl-9 h-10 rounded-full bg-card"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!selectMode ? (
            <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={() => setSelectMode(true)}>
              <CheckSquare className="h-3.5 w-3.5 mr-1.5" /> Select
            </Button>
          ) : (
            <>
              <div className="text-xs font-medium">
                {selected.size} selected
              </div>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={selectAllVisible}>
                Select all visible
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearSelection} disabled={!selected.size}>
                Clear
              </Button>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="destructive"
                className="h-8 rounded-full text-xs"
                onClick={() => setConfirmOpen(true)}
                disabled={!selected.size}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete {selected.size || ""}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-full text-xs"
                onClick={() => { setSelectMode(false); setSelected(new Set()); }}
              >
                <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {order.map((label) => {
          const list = buckets[label];
          if (!list?.length) return null;
          return (
            <div key={label}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  {label}
                </span>
                <span className="text-[11px] text-muted-foreground">· {list.length}</span>
              </div>
              <div className="grid gap-2 sm:gap-2.5">
                {list.map((r) => {
                  const folder = folders.find((f) => f.id === r.folder_id);
                  const qa = (r.qa as { question: string; answer: string }[]) ?? [];
                  const diagrams = r.diagrams ?? [];
                  const isOpen = open === r.id;
                  const isSelected = selected.has(r.id);
                  return (
                    <article
                      key={r.id}
                      className={`group rounded-xl border bg-card transition-all overflow-hidden ${
                        isSelected
                          ? "ring-2 ring-destructive/60"
                          : isOpen
                            ? "ring-1 ring-primary/40 shadow-md"
                            : "hover:border-foreground/20 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-center gap-1 pr-2">
                        {selectMode && (
                          <div className="pl-3">
                            <Checkbox checked={isSelected} onCheckedChange={() => toggleSel(r.id)} />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => selectMode ? toggleSel(r.id) : setOpen(isOpen ? null : r.id)}
                          className="flex-1 min-w-0 text-left flex items-center gap-3 px-3 sm:px-4 py-3"
                        >
                          <div
                            className={`h-9 w-9 shrink-0 rounded-lg grid place-items-center text-[10px] font-bold transition-colors ${
                              r.subject
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {(r.subject ?? r.title).slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">{r.title}</div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                              {r.subject && (
                                <span className="text-primary font-medium">{r.subject}</span>
                              )}
                              {folder && <span>· {folder.name}</span>}
                              <span>· {r.page_count}p</span>
                              {diagrams.length > 0 && <span>· {diagrams.length} diagram{diagrams.length === 1 ? "" : "s"}</span>}
                              <span>· {new Date(r.created_at).toLocaleDateString()}</span>
                              {r.share_token && (
                                <span className="inline-flex items-center gap-1 text-primary">
                                  · <Share2 className="h-3 w-3" /> shared
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        {!selectMode && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 shrink-0"
                              title={r.share_token ? "Manage share link" : "Share"}
                              onClick={() => shareMut.mutate({ id: r.id, title: r.title })}
                              disabled={shareMut.isPending}
                            >
                              <Share2 className={`h-4 w-4 ${r.share_token ? "text-primary" : ""}`} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 shrink-0 text-muted-foreground hover:text-destructive"
                              title="Delete"
                              onClick={() => {
                                if (confirm(`Delete "${r.title}"?`)) removeMut.mutate(r.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <button
                              type="button"
                              onClick={() => setOpen(isOpen ? null : r.id)}
                              className="h-8 w-8 grid place-items-center text-muted-foreground"
                              aria-label={isOpen ? "Collapse" : "Expand"}
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                              />
                            </button>
                          </>
                        )}
                      </div>

                      {isOpen && !selectMode && (
                        <div className="border-t bg-muted/20 animate-fade-in">
                          <div className="px-3 sm:px-4 py-2 flex flex-wrap items-center gap-1.5 border-b bg-background/60">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full h-7 text-xs"
                              onClick={() => shareMut.mutate({ id: r.id, title: r.title })}
                              disabled={shareMut.isPending}
                            >
                              <Share2 className="h-3.5 w-3.5 mr-1" />
                              {r.share_token ? "Share link" : "Share"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full h-7 text-xs"
                              onClick={() =>
                                exportSummaryPdf({
                                  title: r.title,
                                  folderName: folder?.name,
                                  subject: r.subject,
                                  summaryMd: r.summary_md,
                                  qa,
                                  diagrams,
                                })
                              }
                            >
                              <Download className="h-3.5 w-3.5 mr-1" /> PDF
                            </Button>
                            <div className="flex-1" />
                          </div>
                          <div className="p-4 sm:p-5">
                            <SummaryView md={r.summary_md} diagrams={diagrams} />
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
            </div>
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} summar{selected.size === 1 ? "y" : "ies"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected summaries and any share links attached to them. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void runBulkDelete(); }}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ShareDialog({
  item,
  copied,
  setCopied,
  onClose,
  onRevoke,
  revoking,
}: {
  item: { id: string; title: string; token: string } | null;
  copied: boolean;
  setCopied: (b: boolean) => void;
  onClose: () => void;
  onRevoke: (id: string) => void;
  revoking: boolean;
}) {
  const url =
    item && typeof window !== "undefined"
      ? `${window.location.origin}/s/${item.token}`
      : "";
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" /> Share read-only link
          </DialogTitle>
          <DialogDescription className="text-xs">
            Anyone with this link can view, download the PDF, and see the practice questions.
            When they sign in it's auto-saved to their library.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl bg-muted/40 p-3 border space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {item?.title}
          </div>
          <div className="flex items-center gap-2">
            <Input value={url} readOnly className="font-mono text-xs h-9 bg-background" />
            <Button
              size="sm"
              className="shrink-0"
              onClick={async () => {
                if (!url) return;
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  toast.success("Link copied");
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  toast.error("Could not copy");
                }
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="flex justify-between gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => item && onRevoke(item.id)}
            disabled={revoking}
          >
            <Link2Off className="h-4 w-4 mr-1.5" /> Revoke link
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
