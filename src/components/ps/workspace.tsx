import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PsUploader, type UploadedPage } from "./uploader";
import { SummaryView } from "./summary-view";
import {
  ocrPage,
  summarizeTexts,
  generateTopicQA,
  detectSubject,
  detectDiagramRegions,
} from "@/lib/ai.functions";
import { saveSummary, updateSummary, createFolder, updateSummaryDiagrams } from "@/lib/data.functions";
import { classifySummary, getProfile } from "@/lib/settings.functions";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createShareLink, revokeShareLink } from "@/lib/share.functions";
import { ShareDialog } from "./history";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  Download,
  Save,
  X,
  ScanLine,
  BookText,
  CheckCircle2,
  AlertTriangle,
  ListChecks,
  Tag,
  FileText,
  Pencil,
  Check,
  Quote,
  Share2,
  MoreHorizontal,
  Plus,
  FolderClosed,
  UploadCloud,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { exportSummaryPdf, exportTopicQuestionsPdf } from "@/lib/pdf-export";
import type { Folder } from "./sidebar";
import { findCitation, type CitationMatch } from "@/lib/citation";
import { onPagesImported } from "@/lib/page-bus";

type PageText = { index: number; text: string };
type LowConfidence = { snippet: string; reason: string };
type OcrPageText = PageText & { confidence?: number; lowConfidence?: LowConfidence[] };
type MCQ = { question: string; options: string[]; answer: string; evidence: string };
type TopicGroup = { topic: string; qa: MCQ[] };
type Phase = "idle" | "ocr" | "review" | "summarize" | "done";

export function PsWorkspace({
  folders,
  activeFolder,
}: {
  folders: Folder[];
  activeFolder: string | null;
}) {
  const [pages, setPages] = useState<UploadedPage[]>([]);
  const [instructions, setInstructions] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [folderId, setFolderId] = useState<string | "none">(activeFolder ?? "none");


  const [pageTexts, setPageTexts] = useState<OcrPageText[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [diagrams, setDiagrams] = useState<import("@/lib/diagrams-crop").CroppedDiagram[]>([]);
  const [debugRegions, setDebugRegions] = useState<import("@/lib/diagrams-crop").DiagramRegion[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [extractingDiagrams, setExtractingDiagrams] = useState(false);
  const [savedSummaryId, setSavedSummaryId] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [ocrTextOpen, setOcrTextOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [citationMode, setCitationMode] = useState(false);
  const [citation, setCitation] = useState<
    | { match: CitationMatch; bullet: string }
    | { match: null; bullet: string }
    | null
  >(null);

  // Topic Q&A popup state
  const [topicOpen, setTopicOpen] = useState(false);
  const [topics, setTopics] = useState<TopicGroup[]>([]);
  const [showAnswers, setShowAnswers] = useState(true);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});

  const [phase, setPhase] = useState<Phase>("idle");
  const [ocrDone, setOcrDone] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [summarizeStart, setSummarizeStart] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);

  const qc = useQueryClient();
  const runOcr = useServerFn(ocrPage);
  const runSummarize = useServerFn(summarizeTexts);
  const runTopicQA = useServerFn(generateTopicQA);
  const runDetectSubject = useServerFn(detectSubject);
  const runSave = useServerFn(saveSummary);
  const runUpdate = useServerFn(updateSummary);
  const runCreateFolder = useServerFn(createFolder);
  const runDetectDiagrams = useServerFn(detectDiagramRegions);
  const runUpdateDiagrams = useServerFn(updateSummaryDiagrams);
  const runGetProfile = useServerFn(getProfile);
  const createFolderMut = useMutation({
    mutationFn: (name: string) => runCreateFolder({ data: { name } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      setFolderId(row.id);
      setNewFolderName("");
      toast.success(`Folder "${row.name}" created`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const total = pages.length;
  const ocrPct = total ? (ocrDone / total) * 85 : 0;
  const summarizePct = (() => {
    if (phase !== "summarize" || !summarizeStart) return 85;
    const elapsed = (Date.now() - summarizeStart) / 1000;
    return Math.min(99, 85 + (elapsed / 8) * 14);
  })();
  const overall = Math.round(
    phase === "ocr" ? ocrPct : phase === "summarize" ? summarizePct : phase === "done" ? 100 : 0,
  );

  const etaSeconds = (() => {
    if (phase === "ocr" && startTime && ocrDone > 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const perPage = elapsed / ocrDone;
      return Math.max(1, Math.round(perPage * (total - ocrDone) + 8));
    }
    if (phase === "summarize" && summarizeStart) {
      const elapsed = (Date.now() - summarizeStart) / 1000;
      return Math.max(1, Math.round(8 - elapsed));
    }
    return null;
  })();

  const fmtEta = (s: number | null) => {
    if (s == null) return "estimating…";
    if (s < 60) return `~${s}s remaining`;
    const m = Math.floor(s / 60);
    return `~${m}m ${s % 60}s remaining`;
  };

  useEffect(() => {
    if (phase !== "ocr" && phase !== "summarize") return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const startOcr = async () => {
    if (!pages.length || runningRef.current) return;
    runningRef.current = true;
    cancelledRef.current = false;
    setPhase("ocr");
    setOcrDone(0);
    setStartTime(Date.now());
    setSummarizeStart(null);
    setSummary("");
    setDiagrams([]);
    setDebugRegions([]);
    setSavedSummaryId(null);
    setTopics([]);
    setPageTexts([]);
    try {
      toast.message(`Sending ${pages.length} OCR request${pages.length === 1 ? "" : "s"} for ${pages.length} uploaded page${pages.length === 1 ? "" : "s"}.`);
      // Concurrency-limited parallel OCR — avoids gateway rate limits on many pages
      const CONCURRENCY = 3;
      let results: OcrPageText[] = [];
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const batch: (OcrPageText | null)[] = new Array(pages.length).fill(null);
        let done = 0;
        setOcrDone(0);
        let cursor = 0;
        const worker = async () => {
          while (true) {
            if (cancelledRef.current) return;
            const i = cursor;
            cursor += 1;
            if (i >= pages.length) return;
            // Per-page retry with backoff (already retries inside server fn; one extra here for network glitches)
            let r: OcrPageText | null = null;
            for (let tries = 0; tries < 3 && !r && !cancelledRef.current; tries += 1) {
              r = await runOcr({ data: { index: i, dataUrl: pages[i].dataUrl } }).catch(() => null);
              if (!r && tries < 2) await new Promise((res) => setTimeout(res, 800 * (tries + 1)));
            }
            if (cancelledRef.current) return;
            if (r) {
              batch[i] = r;
              done += 1;
              setOcrDone(done);
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker));
        results = batch.filter((x): x is OcrPageText => Boolean(x));
        if (results.length === pages.length) break;
        toast.warning(`OCR request count mismatch (${results.length}/${pages.length}). Retrying missing pages…`);
      }
      if (cancelledRef.current) return;
      if (results.length !== pages.length) {
        setPhase("idle");
        toast.error(`OCR cancelled: expected ${pages.length} requests but received ${results.length}. Please try again.`);
        return;
      }
      setPageTexts(results);
      toast.success(`OCR complete — ${results.length}/${pages.length} pages extracted`);
      setPhase("review");
      // Auto-continue to summary generation — no extra click required
      runningRef.current = false;
      void runSummary(results);
      return;
    } catch (e) {
      if (!cancelledRef.current) toast.error((e as Error).message || "OCR failed");
      setPhase("idle");
    } finally {
      runningRef.current = false;
    }
  };

  const runSummary = async (overridePages?: OcrPageText[]) => {
    const texts = overridePages ?? pageTexts;
    if (runningRef.current || !texts.length) return;
    runningRef.current = true;
    cancelledRef.current = false;
    setPhase("summarize");
    setSummarizeStart(Date.now());
    try {
      const { summary } = await runSummarize({
        data: {
          pageTexts: texts,
          mode: "big-picture",
          instructions:
            (instructions ? instructions + "\n\n" : "") +
            "Organize the summary TOPIC-WISE: use multiple **bold section headers**, each one a clearly named topic, followed by bullets. Bold key terms with **double asterisks** inside bullets.",
        },
      });
      if (cancelledRef.current) return;
      setSummary(summary);
      setPhase("done");
      toast.success("Summary generated");
      setTimeout(() => setPhase((p) => (p === "done" ? "idle" : p)), 1200);

      // Auto-detect subject & title
      let detectedSubject = "";
      let detectedTitle = "";
      try {
        const det = await runDetectSubject({ data: { summaryMd: summary } });
        detectedSubject = det.subject || "";
        detectedTitle = det.title || "";
        if (detectedSubject) setSubject(detectedSubject);
        if (detectedTitle && !title.trim()) setTitle(detectedTitle);
      } catch {
        /* non-fatal */
      }
      let savedId: string | null = null;
      try {
        const row = await runSave({
          data: {
            title: title.trim() || detectedTitle || `Study session · ${new Date().toLocaleDateString()}`,
            subject: detectedSubject || subject || null,
            mode: "big-picture",
            summary_md: summary,
            qa: [],
            page_count: pages.length,
            folder_id: folderId === "none" ? null : folderId,
          },
        });
        savedId = row.id;
        setSavedSummaryId(row.id);
        qc.invalidateQueries({ queryKey: ["summaries"] });
        toast.success("Added to history automatically");
      } catch (err) {
        toast.error((err as Error).message || "Could not auto-save history");
      }

      // Diagram extraction — always attempted so the debug panel is useful.
      try {
        setExtractingDiagrams(true);
        setDebugRegions([]);
        toast.message("Scanning pages for diagrams…");
        const topicList = Array.from(summary.matchAll(/^\*\*(.+?)\*\*\s*:?\s*$/gm)).map((m) => m[1].trim());
        // Fire ALL pages in parallel — one request per page, just like OCR does.
        const regionArrays = await Promise.all(pages.map((p, i) =>
          runDetectDiagrams({ data: { index: i, dataUrl: p.dataUrl, topics: topicList } })
            .catch(() => [] as import("@/lib/diagrams-crop").DiagramRegion[]),
        ));
        const allRegions: import("@/lib/diagrams-crop").DiagramRegion[] =
          regionArrays.flat() as import("@/lib/diagrams-crop").DiagramRegion[];
        setDebugRegions(allRegions);
        const { cropDiagrams } = await import("@/lib/diagrams-crop");
        const cropped = await cropDiagrams(
          pages.map((p, i) => ({ index: i, dataUrl: p.dataUrl })),
          allRegions,
        );
        setDiagrams(cropped);
        if (savedId && cropped.length) {
          try {
            await runUpdateDiagrams({ data: { id: savedId, diagrams: cropped.map(({ topic, dataUrl, caption }) => ({ topic, dataUrl, caption })) } });
            qc.invalidateQueries({ queryKey: ["summaries"] });
          } catch { /* non-fatal */ }
        }
        if (cropped.length) toast.success(`Found ${cropped.length} diagram${cropped.length === 1 ? "" : "s"} (${allRegions.length} region${allRegions.length === 1 ? "" : "s"} detected)`);
        else if (allRegions.length) toast.warning(`Detected ${allRegions.length} region(s) but crops were too small — open Diagram debug`);
        else toast.message("No diagrams detected on these pages");
      } catch { /* non-fatal */ } finally {
        setExtractingDiagrams(false);
      }
    } catch (e) {
      if (!cancelledRef.current) toast.error((e as Error).message || "Summary failed");
      setPhase("review");
    } finally {
      runningRef.current = false;
    }
  };

  const detectDiagramsNow = async () => {
    if (!pages.length || !summary || extractingDiagrams) return;
    setExtractingDiagrams(true);
    setDebugRegions([]);
    try {
      toast.message(`Re-scanning ${pages.length} page${pages.length === 1 ? "" : "s"} for diagrams…`);
      const topicList = Array.from(summary.matchAll(/^\*\*(.+?)\*\*\s*:?\s*$/gm)).map((m) => m[1].trim());
      const regionArrays = await Promise.all(pages.map((p, i) =>
        runDetectDiagrams({ data: { index: i, dataUrl: p.dataUrl, topics: topicList } })
          .catch(() => [] as import("@/lib/diagrams-crop").DiagramRegion[]),
      ));
      const allRegions: import("@/lib/diagrams-crop").DiagramRegion[] =
        regionArrays.flat() as import("@/lib/diagrams-crop").DiagramRegion[];
      setDebugRegions(allRegions);
      const { cropDiagrams } = await import("@/lib/diagrams-crop");
      const cropped = await cropDiagrams(pages.map((p, i) => ({ index: i, dataUrl: p.dataUrl })), allRegions);
      setDiagrams(cropped);
      if (savedSummaryId && cropped.length) {
        try {
          await runUpdateDiagrams({ data: { id: savedSummaryId, diagrams: cropped.map(({ topic, dataUrl, caption }) => ({ topic, dataUrl, caption })) } });
          qc.invalidateQueries({ queryKey: ["summaries"] });
        } catch { /* non-fatal */ }
      }
      setDebugOpen(true);
      if (cropped.length) toast.success(`${cropped.length} diagram${cropped.length === 1 ? "" : "s"} · ${allRegions.length} region${allRegions.length === 1 ? "" : "s"} detected`);
      else if (allRegions.length) toast.warning(`Detected ${allRegions.length} region(s) but none cropped — open debug panel`);
      else toast.message("No diagrams detected on these pages");
    } finally {
      setExtractingDiagrams(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    runningRef.current = false;
    setPhase(pageTexts.length ? "review" : "idle");
    toast.message("Cancelled");
  };

  const updatePageText = (index: number, text: string) => {
    setPageTexts((prev) => prev.map((p) => (p.index === index ? { ...p, text } : p)));
  };


  const topicMut = useMutation({
    mutationFn: async () => runTopicQA({ data: { summaryMd: summary, questionsPerTopic: 5 } }),
    onSuccess: (d) => {
      setTopics(d.topics);
      setSelectedAnswers({});
      setTopicOpen(true);
      toast.success(`${d.topics.length} topics · ${d.topics.reduce((n, t) => n + t.qa.length, 0)} MCQs`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runClassify = useServerFn(classifySummary);

  const saveMut = useMutation({
    mutationFn: async () => {
      // Auto-classify into a system folder when none picked.
      let chosenFolder = folderId === "none" ? null : folderId;
      if (!chosenFolder && summary) {
        try {
          const profile = await runGetProfile();
          if (profile?.course) {
            const subjectName = await runClassify({ data: { text: summary, course: profile.course } });
            const match = folders.find(
              (f) => (f as any).kind === "system" && f.name.toLowerCase() === subjectName.toLowerCase(),
            );
            if (match) {
              chosenFolder = match.id;
              setFolderId(match.id);
              toast.message(`Auto-classified into ${match.name}`);
            }
          }
        } catch {
          // non-fatal; fall through and save unassigned
        }
      }
      return savedSummaryId
        ? runUpdate({
            data: {
              id: savedSummaryId,
              title: title.trim() || `Study session · ${new Date().toLocaleDateString()}`,
              subject: subject || null,
              folder_id: chosenFolder,
            },
          })
        : runSave({
            data: {
              title: title.trim() || `Study session · ${new Date().toLocaleDateString()}`,
              subject: subject || null,
              mode: "big-picture",
              summary_md: summary,
              qa: [],
              page_count: pages.length,
              folder_id: chosenFolder,
            },
          });
    },
    onSuccess: (row) => {
      if (row?.id) setSavedSummaryId(row.id);
      qc.invalidateQueries({ queryKey: ["summaries"] });
      toast.success("Saved to your library");
      setSaveDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runShare = useServerFn(createShareLink);
  const runRevoke = useServerFn(revokeShareLink);
  const [shareDialog, setShareDialog] = useState<{ id: string; title: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const shareMut = useMutation({
    mutationFn: (id: string) => runShare({ data: { id } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      setShareDialog({ id: savedSummaryId!, title: title.trim() || "Summary", token: r.token });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => runRevoke({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      toast.success("Link revoked");
      setShareDialog(null);
    },
  });

  const handleExport = () => {
    const folderName = folders.find((f) => f.id === (folderId === "none" ? "" : folderId))?.name;
    exportSummaryPdf({
      title: title.trim() || "PageSprint Summary",
      folderName,
      subject: subject || null,
      summaryMd: summary,
      qa: [],
      diagrams: diagrams.map(({ topic, dataUrl, caption }) => ({ topic, dataUrl, caption })),
    });
  };

  const handleExportTopicPdf = (includeAnswers: boolean) => {
    exportTopicQuestionsPdf({
      title: (title.trim() || "PageSprint MCQs") + (includeAnswers ? " — Answers" : " — Questions"),
      subject: subject || null,
      topics,
      includeAnswers,
    });
  };

  const busy = phase === "ocr" || phase === "summarize";

  useEffect(() => {
    setFolderId(activeFolder ?? "none");
  }, [activeFolder]);

  // Receive pages imported by the Extension tab
  useEffect(() => {
    return onPagesImported((incoming) => {
      setPages((prev) => [...prev, ...incoming]);
      toast.success(`${incoming.length} page${incoming.length === 1 ? "" : "s"} added from Extension`);
    });
  }, []);

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-in">

      {/* Top stepper — clean, modern */}
      <Stepper phase={phase} hasSummary={!!summary} hasPages={pages.length > 0} />

      {/* Upload pages — primary action */}
      <section className="relative overflow-hidden bg-card border rounded-2xl p-5 sm:p-6 shadow-sm transition-all hover:shadow-md">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 grid place-items-center ring-1 ring-primary/15">
              <UploadCloud className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-none">Upload pages</h2>
              <p className="text-[11px] text-muted-foreground mt-1.5">Drop images of your notes to get started</p>
            </div>
          </div>
          {pages.length > 0 && (
            <span className="rounded-full bg-primary/10 text-primary px-2.5 py-1 text-[11px] font-medium tabular-nums">
              {pages.length} page{pages.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <PsUploader pages={pages} setPages={setPages} />

        {pages.length > 0 && !busy && (
          <div className="mt-4">
            <Button onClick={startOcr} disabled={busy} size="lg" className="w-full transition-transform active:scale-[0.98] shadow-sm">
              <Sparkles className="h-4 w-4 mr-2" />
              {summary ? "Make new summary" : "Extract & summarize"}
            </Button>
            {summary && (
              <p className="mt-2 text-[11px] text-muted-foreground text-center">
                Add or swap pages above, then generate again. Your current summary stays saved in history.
              </p>
            )}
          </div>
        )}



        {busy && (
          <div className="mt-5 rounded-xl border bg-muted/30 p-4 shadow-inner animate-fade-in">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                {phase === "ocr" ? (
                  <><ScanLine className="h-4 w-4 text-primary animate-pulse" /> Reading pages — {ocrDone}/{total} done</>
                ) : (
                  <><BookText className="h-4 w-4 text-primary animate-pulse" /> Building topic-wise summary…</>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={cancel} className="h-7 shrink-0 px-2 text-muted-foreground hover:text-destructive">
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            </div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold tabular-nums text-foreground">{overall}%</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">{fmtEta(etaSeconds)}</span>
            </div>
            <Progress value={overall} className="h-2" />
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                {phase === "ocr" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 text-primary" />}
                Extract text ({ocrDone}/{total})
              </div>
              <div className="flex items-center gap-1.5">
                {phase === "summarize" ? <Loader2 className="h-3 w-3 animate-spin" /> : phase === "ocr" ? <span className="h-3 w-3 rounded-full border border-muted-foreground/40" /> : <CheckCircle2 className="h-3 w-3 text-primary" />}
                Synthesize summary
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Summary settings — moved below upload */}
      <section className="bg-card/40 border border-dashed rounded-2xl p-4 sm:p-5 transition-all hover:bg-card hover:border-solid">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-7 w-7 rounded-md bg-muted grid place-items-center">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold">Summary settings</h2>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">Optional</span>
        </div>
        <Label className="text-xs mb-1.5 block text-muted-foreground" htmlFor="ins">
          Custom AI instructions
        </Label>
        <Textarea id="ins" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder='e.g. "Focus on formulas and definitions"' />
      </section>


      {/* Inline "Review extracted text" section removed — available via the "OCR text" button in the summary toolbar */}

      {summary && (
        <>
          <section className="bg-card border rounded-xl p-5 animate-fade-in">
            <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Summary
                {subject && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[11px] font-medium">
                    <Tag className="h-3 w-3" /> {subject}
                  </span>
                )}
              </h2>
            </div>
            {/* Compact toolbar: OCR text · Edit · More */}
            <div className="mb-4 flex items-center gap-2 transition-all">
              <Button onClick={() => setOcrTextOpen(true)} size="sm" variant="outline" className="rounded-full shrink-0 transition-transform active:scale-95">
                <FileText className="h-4 w-4 mr-1.5" /> OCR text
              </Button>
              <Button
                onClick={() => setEditingSummary((v) => !v)}
                size="sm"
                variant={editingSummary ? "default" : "outline"}
                className="rounded-full shrink-0 transition-transform active:scale-95"
              >
                {editingSummary ? <><Check className="h-4 w-4 mr-1.5" /> Done</> : <><Pencil className="h-4 w-4 mr-1.5" /> Edit</>}
              </Button>
              <Button
                onClick={() => setSaveDialogOpen(true)}
                size="sm"
                variant="default"
                className="rounded-full shrink-0 transition-transform active:scale-95"
              >
                <Save className="h-4 w-4 mr-1.5" /> Save
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="secondary" className="rounded-full shrink-0 transition-transform active:scale-95" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1.5">
                  <button
                    onClick={() => topicMut.mutate()}
                    disabled={topicMut.isPending}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {topicMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4 text-primary" />}
                    Questions by topic
                  </button>
                  <button
                    onClick={() => {
                      setCitationMode((v) => {
                        const nv = !v;
                        toast.message(nv ? "Citations on — tap any bullet" : "Citations off");
                        return nv;
                      });
                    }}
                    disabled={!pageTexts.length}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Quote className="h-4 w-4 text-primary" /> {citationMode ? "Citations on" : "Citations"}
                  </button>
                  <button
                    onClick={handleExport}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                  >
                    <Download className="h-4 w-4 text-primary" /> Export PDF
                  </button>
                  <button
                    onClick={() => {
                      if (!savedSummaryId) {
                        setSaveDialogOpen(true);
                        toast.message("Save first, then share");
                        return;
                      }
                      shareMut.mutate(savedSummaryId);
                    }}
                    disabled={shareMut.isPending}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Share2 className="h-4 w-4 text-primary" /> Share
                  </button>
                </PopoverContent>
              </Popover>
            </div>


            {editingSummary ? (
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={Math.min(28, Math.max(12, summary.split("\n").length + 2))}
                className="font-mono text-xs leading-relaxed"
              />
            ) : (
              <>
                {extractingDiagrams && (
                  <div className="mb-3 text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Detecting diagrams…
                  </div>
                )}
                <SummaryView
                  md={summary}
                  diagrams={diagrams}
                  citationMode={citationMode && pageTexts.length > 0}
                  onBulletClick={(bullet) => {
                    const m = findCitation(bullet, pageTexts);
                    setCitation({ match: m, bullet });
                  }}
                />
              </>
            )}
          </section>

          {/* Diagram debug panel */}
          <section className="bg-card border rounded-xl p-4 sm:p-5 animate-fade-in">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Diagram debug
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {debugRegions.length} region{debugRegions.length === 1 ? "" : "s"} · {diagrams.length} cropped
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="rounded-full h-7 text-xs" onClick={detectDiagramsNow} disabled={extractingDiagrams || !pages.length}>
                  {extractingDiagrams ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ScanLine className="h-3.5 w-3.5 mr-1" />}
                  Re-detect
                </Button>
                <Button size="sm" variant="ghost" className="rounded-full h-7 text-xs" onClick={() => setDebugOpen((v) => !v)}>
                  {debugOpen ? "Hide" : "Show"} details
                </Button>
              </div>
            </div>
            {debugOpen && (
              <div className="mt-3 space-y-3">
                {debugRegions.length === 0 && !extractingDiagrams && (
                  <div className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
                    No regions returned by the vision model. Common causes: notes are pure text, images too low-resolution, or the model considered drawings ambiguous. Try Re-detect or upload higher-res photos.
                  </div>
                )}
                {debugRegions.length > 0 && (
                  <div className="grid gap-2">
                    {debugRegions.map((r, i) => {
                      const [x, y, w, h] = r.bbox;
                      const page = pages[r.pageIndex];
                      return (
                        <div key={i} className="rounded-lg border bg-muted/20 p-2 flex gap-3">
                          <div className="relative shrink-0 w-24 h-24 rounded-md overflow-hidden bg-background border">
                            {page && (
                              <>
                                <img src={page.dataUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
                                <div
                                  className="absolute border-2 border-primary bg-primary/15"
                                  style={{
                                    left: `${Math.max(0, x) * 100}%`,
                                    top: `${Math.max(0, y) * 100}%`,
                                    width: `${Math.max(0, Math.min(1, w)) * 100}%`,
                                    height: `${Math.max(0, Math.min(1, h)) * 100}%`,
                                  }}
                                />
                              </>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 text-xs space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground">{r.topic || "Figure"}</span>
                              <span className="rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-mono tabular-nums">
                                {typeof r.confidence === "number" ? `${r.confidence}%` : "—"}
                              </span>
                              <span className="text-muted-foreground">page {r.pageIndex + 1}</span>
                            </div>
                            <div className="text-muted-foreground line-clamp-2">{r.caption || <em>(no caption)</em>}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              bbox [x {x.toFixed(3)} · y {y.toFixed(3)} · w {w.toFixed(3)} · h {h.toFixed(3)}]
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>




        </>
      )}

      {/* Topic-wise questions popup — cleaner, mobile-friendly */}
      <Dialog open={topicOpen} onOpenChange={setTopicOpen}>
        <DialogContent className="max-w-3xl w-[96vw] sm:w-full max-h-[92vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 no-print border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-5 w-5 text-primary" /> Questions by topic
            </DialogTitle>
            <DialogDescription className="text-xs">
              Generated only from your summary{subject ? <> · {subject}</> : null} · {topics.length} topics · {topics.reduce((n, t) => n + t.qa.length, 0)} MCQs
            </DialogDescription>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full bg-muted p-0.5 text-xs">
                <button
                  onClick={() => setShowAnswers(false)}
                  className={`px-3 py-1 rounded-full transition-colors ${!showAnswers ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}
                >
                  Quiz me
                </button>
                <button
                  onClick={() => setShowAnswers(true)}
                  className={`px-3 py-1 rounded-full transition-colors ${showAnswers ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}
                >
                  Show answers
                </button>
              </div>
              <div className="flex-1" />
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => handleExportTopicPdf(false)}>
                <Download className="h-4 w-4 mr-1" /> Questions
              </Button>
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => handleExportTopicPdf(true)}>
                <Download className="h-4 w-4 mr-1" /> + Answers
              </Button>
            </div>
            {/* Topic chips for fast navigation */}
            {topics.length > 1 && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {topics.map((t, ti) => (
                  <a
                    key={ti}
                    href={`#topic-${ti}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(`topic-${ti}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className="shrink-0 rounded-full bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-medium px-2.5 py-1"
                  >
                    {ti + 1}. {t.topic.length > 22 ? t.topic.slice(0, 22) + "…" : t.topic}
                  </a>
                ))}
              </div>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 print-area bg-muted/20">
            <h2 className="hidden print:block text-xl font-bold mb-1">
              {title.trim() || "PageSprint Questions"}
            </h2>
            {subject && <p className="hidden print:block text-sm mb-3">Subject: {subject}</p>}
            {topics.length === 0 ? (
              <p className="text-sm text-muted-foreground">No topics yet.</p>
            ) : (
              <div className="space-y-5">
                {topics.map((t, ti) => (
                  <div key={ti} id={`topic-${ti}`} className="rounded-xl border bg-card shadow-sm overflow-hidden scroll-mt-4">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary/10 to-transparent border-b">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold">{ti + 1}</span>
                      <h3 className="text-sm font-semibold">{t.topic}</h3>
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">{t.qa.length} MCQs</span>
                    </div>
                    <ol className="divide-y">
                      {t.qa.map((qa, qi) => {
                        const key = `${ti}-${qi}`;
                        const picked = selectedAnswers[key];
                        return (
                          <li key={qi} className="p-3 sm:p-4">
                            <div className="flex gap-2 text-sm font-medium">
                              <span className="text-primary tabular-nums shrink-0">Q{qi + 1}.</span>
                              <span>{qa.question}</span>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {qa.options.slice(0, 4).map((opt, oi) => {
                                const correct = isCorrectOption(opt, qa.answer);
                                const isPicked = picked === opt;
                                const showState = isPicked || (showAnswers && correct);
                                return (
                                  <button
                                    key={oi}
                                    type="button"
                                    onClick={() => setSelectedAnswers((prev) => ({ ...prev, [key]: opt }))}
                                    className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-xs sm:text-sm transition-all min-h-11 ${
                                      showState
                                        ? correct
                                          ? "border-primary bg-primary/10 text-foreground"
                                          : isPicked
                                            ? "border-destructive bg-destructive/10 text-foreground"
                                            : "bg-card hover:bg-accent"
                                        : "bg-card hover:bg-accent active:bg-accent/80"
                                    }`}
                                  >
                                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-background text-[10px] font-bold">{String.fromCharCode(65 + oi)}</span>
                                    <span className="flex-1">{opt}</span>
                                    {showState && correct && <Check className="h-4 w-4 text-primary shrink-0" />}
                                    {showState && isPicked && !correct && <X className="h-4 w-4 text-destructive shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                            {(showAnswers || picked) && (
                              <div className="mt-3 rounded-md border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs leading-relaxed">
                                <div className="font-semibold text-foreground">Answer: {qa.answer}</div>
                                <div className="mt-0.5 text-muted-foreground">📖 {qa.evidence}</div>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ocrTextOpen} onOpenChange={setOcrTextOpen}>
        <DialogContent className="max-w-2xl w-[96vw] sm:w-full max-h-[88vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-primary" /> Extracted OCR text
            </DialogTitle>
            <DialogDescription className="text-xs">Edit any mistakes, then re-run summary if needed.</DialogDescription>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="rounded-full" onClick={startOcr} disabled={busy}>
                <ScanLine className="h-3.5 w-3.5 mr-1" /> Re-run OCR
              </Button>
              <Button size="sm" className="rounded-full" onClick={() => { setOcrTextOpen(false); void runSummary(); }} disabled={busy || !pageTexts.length}>
                <BookText className="h-3.5 w-3.5 mr-1" /> Rebuild summary
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
            {pageTexts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No OCR text yet — extract pages first.</p>
            ) : pageTexts.map((p) => (
              <div key={p.index} className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
                  <Label className="text-xs text-muted-foreground">Page {p.index + 1}</Label>
                  <div className="flex items-center gap-2">
                    <span className={cnConfidence(p.confidence)}>
                      {(p.confidence ?? 70) < 60 ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                      {confidenceLabel(p.confidence)}
                    </span>
                    {p.lowConfidence?.length ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[11px] font-medium">
                        <AlertTriangle className="h-3 w-3" /> {p.lowConfidence.length} flag{p.lowConfidence.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </div>
                {p.lowConfidence?.length ? (
                  <div className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/10 p-2 text-[11px]">
                    <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Likely misreads
                    </div>
                    <ul className="space-y-1">
                      {p.lowConfidence.slice(0, 4).map((item, i) => (
                        <li key={i} className="text-muted-foreground"><mark className="rounded bg-amber-500/20 px-1 text-foreground">{item.snippet}</mark> — {item.reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Textarea rows={6} value={p.text} onChange={(e) => updatePageText(p.index, e.target.value)} className="font-mono text-xs" />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Citation source dialog — page thumbnail + highlighted OCR lines */}
      <Dialog open={!!citation} onOpenChange={(o) => !o && setCitation(null)}>
        <DialogContent className="max-w-3xl w-[96vw] sm:w-full max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Quote className="h-5 w-5 text-primary" /> Source citation
            </DialogTitle>
            <DialogDescription className="text-xs line-clamp-2">
              {citation?.bullet}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {!citation?.match ? (
              <div className="text-sm text-muted-foreground text-center py-10">
                No matching OCR line found for this bullet — the summary may paraphrase too broadly.
              </div>
            ) : (
              <CitationContent
                match={citation.match}
                pages={pages}
                pageTexts={pageTexts}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ShareDialog
        item={shareDialog}
        copied={copied}
        setCopied={setCopied}
        onClose={() => setShareDialog(null)}
        onRevoke={(id) => revokeMut.mutate(id)}
        revoking={revokeMut.isPending}
      />

      {/* Save dialog — collects title/subject/folder */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-4 w-4 text-primary" /> Save summary
            </DialogTitle>
            <DialogDescription className="text-xs">
              Title and subject are auto-detected — edit if needed. Pick or create a folder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-1 block">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto-detected" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Auto-detected" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Folder</Label>
              <Select value={folderId} onValueChange={(v) => setFolderId(v as string)}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {folders.map((f) => (<SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>))}
                </SelectContent>
              </Select>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Create new folder…"
                  className="h-9"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newFolderName.trim()) {
                      e.preventDefault();
                      createFolderMut.mutate(newFolderName.trim());
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!newFolderName.trim() || createFolderMut.isPending}
                  onClick={() => createFolderMut.mutate(newFolderName.trim())}
                  className="shrink-0"
                >
                  {createFolderMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stepper({ phase, hasSummary, hasPages }: { phase: Phase; hasSummary: boolean; hasPages: boolean }) {
  const step2Active = hasSummary || phase === "summarize" || phase === "ocr";
  const step1Done = step2Active;
  const step2Done = hasSummary && phase !== "summarize";

  // Progress fill between steps (0 → 100)
  const fill = step2Done ? 100 : phase === "summarize" ? 75 : phase === "ocr" ? 50 : hasPages ? 20 : 0;

  return (
    <div className="sticky top-[60px] z-[5] -mx-4 sm:mx-0 px-4 sm:px-6 py-3 bg-background/85 backdrop-blur-xl rounded-none sm:rounded-2xl sm:border">
      <div className="flex items-center gap-3 sm:gap-4">
        <StepperItem
          n={1}
          label="Upload pages"
          icon={<UploadCloud className="h-3.5 w-3.5" />}
          active={!step1Done}
          done={step1Done}
        />
        <div className="relative flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-primary/70 transition-all duration-700 ease-out"
            style={{ width: `${fill}%` }}
          />
        </div>
        <StepperItem
          n={2}
          label="Summary"
          icon={<Sparkles className="h-3.5 w-3.5" />}
          active={step2Active && !step2Done}
          done={step2Done}
        />
      </div>
    </div>
  );
}

function StepperItem({
  n, label, active, done, icon,
}: { n: number; label: string; active: boolean; done: boolean; icon: React.ReactNode }) {
  const state = done ? "done" : active ? "active" : "idle";
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span
        className={[
          "relative inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300",
          state === "done" && "bg-primary text-primary-foreground shadow-sm",
          state === "active" && "bg-primary text-primary-foreground shadow-md ring-4 ring-primary/20",
          state === "idle" && "bg-muted text-muted-foreground border",
        ].filter(Boolean).join(" ")}
      >
        {done ? <Check className="h-4 w-4" /> : <span className="sm:hidden">{icon}</span>}
        {!done && <span className="hidden sm:inline">{n}</span>}
        {state === "active" && (
          <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping opacity-60" />
        )}
      </span>
      <div className="hidden sm:flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Step {n}</span>
        <span className={`text-xs font-semibold ${state === "idle" ? "text-muted-foreground" : "text-foreground"}`}>{label}</span>
      </div>
    </div>
  );
}


function CitationContent({
  match,
  pages,
  pageTexts,
}: {
  match: CitationMatch;
  pages: UploadedPage[];
  pageTexts: OcrPageText[];
}) {
  const page = pages[match.pageIndex];
  const ocr = pageTexts.find((p) => p.index === match.pageIndex);
  const lines = ocr?.text.split(/\n+/) ?? [];
  const highlightSet = new Set(match.lineIndices);
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Page {match.pageIndex + 1} thumbnail
        </div>
        {page ? (
          <a
            href={page.dataUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border overflow-hidden bg-muted"
          >
            <img
              src={page.dataUrl}
              alt={`Page ${match.pageIndex + 1}`}
              className="w-full h-auto"
            />
          </a>
        ) : (
          <div className="text-xs text-muted-foreground">Page image not available.</div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Matched OCR line{match.lineIndices.length === 1 ? "" : "s"}
        </div>
        <div className="rounded-lg border bg-card p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
          {lines.map((ln, i) => (
            <div
              key={i}
              ref={(el) => {
                if (el && highlightSet.has(i) && i === match.lineIndices[0]) {
                  el.scrollIntoView({ block: "center", behavior: "smooth" });
                }
              }}
              className={
                highlightSet.has(i)
                  ? "bg-primary/20 border-l-2 border-primary px-2 py-0.5 rounded my-0.5 text-foreground"
                  : "text-muted-foreground px-2 py-0.5"
              }
            >
              {ln || " "}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function confidenceLabel(confidence = 70) {
  if (confidence < 55) return "Low confidence";
  if (confidence < 80) return "Medium confidence";
  return "High confidence";
}

function cnConfidence(confidence = 70) {
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium";
  if (confidence < 55) return `${base} bg-destructive/15 text-destructive`;
  if (confidence < 80) return `${base} bg-amber-500/15 text-amber-700 dark:text-amber-400`;
  return `${base} bg-primary/15 text-primary`;
}

function isCorrectOption(option: string, answer: string) {
  const clean = (v: string) => v.trim().toLowerCase().replace(/^[a-d][.)]\s*/, "");
  return clean(option) === clean(answer) || clean(option).includes(clean(answer)) || clean(answer).includes(clean(option));
}


