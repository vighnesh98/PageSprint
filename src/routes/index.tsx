import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { PsSidebar, type Folder, type SidebarView } from "@/components/ps/sidebar";
import { PsWorkspace } from "@/components/ps/workspace";
import { PsHistory, ShareDialog } from "@/components/ps/history";
import { PsShareHistory } from "@/components/ps/share-history";
import { PsSettings } from "@/components/ps/settings";
import { PsGlobalSearch } from "@/components/ps/global-search";
import { PsExtension } from "@/components/ps/extension";
import { emitPagesImported } from "@/lib/page-bus";
import type { UploadedPage } from "@/components/ps/uploader";
import { getProfile, updateProfile, syncCourseFolders, COURSE_FOLDERS } from "@/lib/settings.functions";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  listSummaries,
  deleteSummary,
} from "@/lib/data.functions";
import { createShareLink, revokeShareLink } from "@/lib/share.functions";
import { exportSummaryPdf } from "@/lib/pdf-export";
import { SummaryView } from "@/components/ps/summary-view";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Download, FileText, Loader2, Trash2, Menu, Sparkles, Share2, ChevronDown, ListChecks } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";

type SummaryRow = {
  id: string; title: string; subject?: string | null; mode: string; summary_md: string;
  qa: unknown; page_count: number; folder_id: string | null; created_at: string;
  share_token?: string | null; diagrams?: { topic: string; dataUrl: string; caption: string }[] | null;
};

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} richColors position="bottom-right" />;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PageSprint AI — Turn notes into smart summaries" },
      { name: "description", content: "Upload notes, get bullet-point summaries and self-test Q&A in seconds." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<SidebarView>("workspace");
  const [previousView, setPreviousView] = useState<SidebarView>("workspace");
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [historySelectSignal, setHistorySelectSignal] = useState(false);
  const isMobileDevice = useIsMobile();

  const goToView = (v: SidebarView) => {
    setPreviousView(view);
    setView(v);
    setMobileOpen(false);
  };

  useEffect(() => {
    if (!loading && !user) {
      const here = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
      nav({ to: "/login", search: { redirect: here } as never, replace: true });
    }
  }, [loading, user, nav]);

  // Consume pending URL-import handoff from /i
  useEffect(() => {
    if (!user) return;
    try {
      const raw = sessionStorage.getItem("ps:pending-import");
      if (!raw) return;
      sessionStorage.removeItem("ps:pending-import");
      const pages = JSON.parse(raw) as UploadedPage[];
      if (Array.isArray(pages) && pages.length) {
        // Delay to let the always-mounted Workspace register its listener
        setTimeout(() => {
          setView("workspace");
          setActiveFolder(null);
          setTimeout(() => emitPagesImported(pages), 60);
        }, 30);
      }
    } catch { /* ignore */ }
  }, [user]);


  const fListFolders = useServerFn(listFolders);
  const fCreate = useServerFn(createFolder);
  const fRename = useServerFn(renameFolder);
  const fDelete = useServerFn(deleteFolder);

  const folders = useQuery({
    queryKey: ["folders"],
    queryFn: () => fListFolders(),
    enabled: !!user,
  });

  const createMut = useMutation({
    mutationFn: (name: string) => fCreate({ data: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["folders"] }),
  });
  const renameMut = useMutation({
    mutationFn: (v: { id: string; name: string }) => fRename({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["folders"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => fDelete({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["summaries"] });
      setActiveFolder(null);
    },
  });

  const folderObj: Folder[] = useMemo(
    () => (folders.data ?? []).map((f: any) => ({
      id: f.id, name: f.name, kind: f.kind, sort_order: f.sort_order,
    })),
    [folders.data],
  );

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sidebarProps = {
    folders: folderObj,
    activeFolder,
    view,
    onView: (v: SidebarView) => goToView(v),
    onSelect: (id: string | null) => {
      setActiveFolder(id);
      setMobileOpen(false);
    },
    onCreate: (name: string) => createMut.mutate(name),
    onRename: (id: string, name: string) => renameMut.mutate({ id, name }),
    onDelete: (id: string) => deleteMut.mutate(id),
    onSignOut: async () => {
      await supabase.auth.signOut();
      toast.success("Signed out");
    },
    userEmail: user.email,
  };

  const titleFor = () => {
    if (view === "history") return "Summary History";
    if (view === "shares") return "Share History";
    if (view === "search") return "Global Search";
    if (view === "extension") return "URL Extension";
    if (view === "settings") return "Settings";
    if (activeFolder) return folderObj.find((f) => f.id === activeFolder)?.name ?? "Folder";
    return "Workspace";
  };

  const subtitleFor = () => {
    if (view === "history") return "All saved sessions across folders.";
    if (view === "shares") return "Read-only links you've generated.";
    if (view === "search") return "Find any summary by title, subject, or content.";
    if (view === "extension") return "Auto-import files from URLs into your workspace.";
    if (view === "settings") return "Account, course, diagrams, and data controls.";
    if (activeFolder) return "Summaries saved in this folder.";
    return "Upload pages, choose a mode, generate a summary.";
  };

  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      {!isMobileDevice && (
        <aside className="flex w-64 shrink-0 border-r h-screen sticky top-0">
          <PsSidebar {...sidebarProps} />
        </aside>
      )}

      <main className="flex-1 min-w-0">
        <header className="border-b px-4 sm:px-6 py-3 sm:py-4 sticky top-0 bg-background/85 backdrop-blur-xl z-10 flex items-center gap-3">
          {isMobileDevice && (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72 max-w-[85vw]">
                <PsSidebar {...sidebarProps} />
              </SheetContent>
            </Sheet>
          )}
          {isMobileDevice && (
            <div className="flex items-center gap-2 mr-1">
              <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
                <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-sm sm:text-base font-semibold tracking-tight truncate">{titleFor()}</h1>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 truncate">{subtitleFor()}</p>
          </div>
          <Badge variant="secondary" className="hidden sm:inline-flex shrink-0">
            {isMobileDevice ? "Mobile" : "Laptop / PC"}
          </Badge>
        </header>

        <div className="p-4 sm:p-6 max-w-6xl mx-auto">
          {/* Workspace stays mounted so OCR/summary/uploads keep running when user navigates away. */}
          <div className={view === "workspace" && !activeFolder ? "" : "hidden"}>
            <PsWorkspace folders={folderObj} activeFolder={activeFolder} />
          </div>
          {view === "workspace" && activeFolder ? (
            <FolderView folderId={activeFolder} folders={folderObj} />
          ) : view === "history" ? (
            <PsHistory
              folders={folderObj}
              initialSelectMode={historySelectSignal}
              onSelectModeConsumed={() => setHistorySelectSignal(false)}
            />
          ) : view === "shares" ? (
            <PsShareHistory />
          ) : view === "search" ? (
            <PsGlobalSearch onBack={() => goToView(previousView === "search" ? "workspace" : previousView)} />
          ) : view === "extension" ? (
            <PsExtension onOpenWorkspace={() => goToView("workspace")} />
          ) : view === "settings" ? (
            <PsSettings
              userEmail={user.email}
              onGoDeleteHistory={() => {
                setHistorySelectSignal(true);
                goToView("history");
              }}
            />
          ) : null}
        </div>

      </main>

      <CourseFirstTimePrompt />


      <ThemedToaster />
    </div>
  );
}

function FolderView({ folderId, folders }: { folderId: string; folders: Folder[] }) {
  const qc = useQueryClient();
  const fList = useServerFn(listSummaries);
  const fDel = useServerFn(deleteSummary);
  const fShare = useServerFn(createShareLink);
  const fRevoke = useServerFn(revokeShareLink);
  const [open, setOpen] = useState<string | null>(null);
  const [shareDialog, setShareDialog] = useState<{ id: string; title: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const q = useQuery({
    queryKey: ["summaries", folderId],
    queryFn: () => fList({ data: { folderId } }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => fDel({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      toast.success("Deleted");
    },
  });
  const shareMut = useMutation({
    mutationFn: ({ id }: { id: string; title: string }) => fShare({ data: { id } }),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      setShareDialog({ id: vars.id, title: vars.title, token: r.token });
    },
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => fRevoke({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
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
  const rows = (q.data ?? []) as SummaryRow[];
  const folder = folders.find((f) => f.id === folderId);

  if (!rows.length) {
    return (
      <div className="text-center py-24 text-muted-foreground text-sm">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
        No summaries in this folder yet. Switch to{" "}
        <strong className="text-foreground">Workspace</strong> to create one.
      </div>
    );
  }
  return (
    <>
      <div className="grid gap-2.5">
        {rows.map((r) => {
          const qa = (r.qa as { question: string; answer: string }[]) ?? [];
          const isOpen = open === r.id;
          return (
            <article
              key={r.id}
              className={`rounded-xl border bg-card overflow-hidden transition-all ${
                isOpen ? "ring-1 ring-primary/40 shadow-md" : "hover:border-foreground/20 hover:shadow-sm"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.id)}
                className="w-full text-left flex items-center gap-3 px-3 sm:px-4 py-3"
              >
                <div
                  className={`h-9 w-9 shrink-0 rounded-lg grid place-items-center text-[10px] font-bold ${
                    r.subject ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {(r.subject ?? r.title).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{r.title}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                    {r.subject && <span className="text-primary font-medium">{r.subject}</span>}
                    <span>· {r.page_count}p</span>
                    <span>· {new Date(r.created_at).toLocaleDateString()}</span>
                    {r.share_token && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        · <Share2 className="h-3 w-3" /> shared
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>

              {isOpen && (
                <div className="border-t bg-muted/20 animate-fade-in">
                  <div className="px-3 sm:px-4 py-2 flex flex-wrap items-center gap-1.5 border-b bg-background/60">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full h-7 text-xs"
                      onClick={() => shareMut.mutate({ id: r.id, title: r.title })}
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
                          diagrams: r.diagrams ?? [],
                        })
                      }
                    >
                      <Download className="h-3.5 w-3.5 mr-1" /> PDF
                    </Button>
                    <div className="flex-1" />
                  </div>

                  <div className="p-4 sm:p-5">
                    <SummaryView md={r.summary_md} diagrams={r.diagrams ?? []} />
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

function CourseFirstTimePrompt() {
  const qc = useQueryClient();
  const fGet = useServerFn(getProfile);
  const fUpdate = useServerFn(updateProfile);
  const fSync = useServerFn(syncCourseFolders);
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: () => fGet() });
  const [choice, setChoice] = useState<"A" | "B" | "">("");
  const [saving, setSaving] = useState(false);

  const open = !!profileQ.data && !profileQ.data.course;

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      await fUpdate({ data: { course: choice } });
      await fSync({ data: { course: choice } });
      await qc.invalidateQueries({ queryKey: ["profile"] });
      await qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success(`Course ${choice} selected`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Choose your course</DialogTitle>
          <DialogDescription>
            Your course determines the mandatory folders and how summaries are auto-classified. You can change this later in Settings.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={choice} onValueChange={(v) => setChoice(v as "A" | "B")} className="grid sm:grid-cols-2 gap-3">
          {(["A", "B"] as const).map((c) => (
            <Label
              key={c}
              htmlFor={`first-course-${c}`}
              className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/50 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <RadioGroupItem value={c} id={`first-course-${c}`} className="mt-0.5" />
              <div className="space-y-1">
                <div className="text-sm font-medium">Course {c}</div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  {COURSE_FOLDERS[c].join(" · ")}
                </div>
              </div>
            </Label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button onClick={save} disabled={!choice || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
