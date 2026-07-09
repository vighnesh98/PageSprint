import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSharedSummary, importSharedSummary } from "@/lib/share.functions";
import { useAuth } from "@/hooks/use-auth";
import { SummaryView } from "@/components/ps/summary-view";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { exportSummaryPdf } from "@/lib/pdf-export";
import { Loader2, Download, Sparkles, BookOpen, ListChecks, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/s/$token")({
  head: () => ({
    meta: [
      { title: "Shared summary · PageSprint AI" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedSummaryPage,
});

function SharedSummaryPage() {
  const { token } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const fGet = useServerFn(getSharedSummary);
  const fImport = useServerFn(importSharedSummary);
  const [imported, setImported] = useState(false);

  const q = useQuery({
    queryKey: ["shared-summary", token],
    queryFn: () => fGet({ data: { token } }),
    retry: false,
  });

  // Auto-import to library on first authenticated view; no clicks needed.
  useEffect(() => {
    if (authLoading || !user || !q.data || imported) return;
    fImport({ data: { token } })
      .then((r) => {
        setImported(true);
        if (!r.alreadyOwner) toast.success("Saved to your library");
      })
      .catch(() => {});
  }, [user, authLoading, q.data, imported, token, fImport]);

  const qa = useMemo(
    () => ((q.data?.qa as { question: string; answer: string }[]) ?? []),
    [q.data],
  );

  if (q.isLoading || authLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Link unavailable</h1>
          <p className="text-sm text-muted-foreground">
            This shared summary may have been revoked or never existed.
          </p>
          <Button asChild><Link to="/">Go home</Link></Button>
        </div>
      </div>
    );
  }

  const r = q.data;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/[0.03]">
      <header className="border-b backdrop-blur-xl bg-background/80 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight text-sm hidden sm:inline">PageSprint AI</span>
          </Link>
          <span className="text-xs text-muted-foreground hidden sm:inline">· shared summary</span>
          <div className="flex-1" />
          {user ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-primary">
              <Check className="h-3.5 w-3.5" /> {imported ? "Saved to library" : "Saving…"}
            </span>
          ) : (
            <Button
              size="sm"
              onClick={() =>
                nav({
                  to: "/login",
                  search: { redirect: `/s/${token}` } as never,
                })
              }
            >
              Sign in to save <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="rounded-2xl border bg-card p-6 sm:p-8 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mb-2">
            {r.subject && (
              <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">{r.subject}</span>
            )}
            <span>{r.page_count} pages</span>
            <span>·</span>
            <span>{new Date(r.created_at).toLocaleDateString()}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{r.title}</h1>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
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
              <Download className="h-4 w-4 mr-1.5" /> Download PDF
            </Button>
            {qa.length > 0 && (
              <a href="#qa" className="inline-flex">
                <Button size="sm" variant="secondary" className="rounded-full">
                  <ListChecks className="h-4 w-4 mr-1.5" /> {qa.length} questions
                </Button>
              </a>
            )}
          </div>
        </div>

        <section className="rounded-2xl border bg-card p-6 sm:p-8 shadow-sm">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <BookOpen className="h-4 w-4 text-primary" /> Summary
          </h2>
          <SummaryView md={r.summary_md} diagrams={(r as any).diagrams ?? []} />
        </section>

        {qa.length > 0 && (
          <section id="qa" className="rounded-2xl border bg-card p-6 sm:p-8 shadow-sm">
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <ListChecks className="h-4 w-4 text-primary" /> Practice questions
            </h2>
            <Accordion type="multiple" className="space-y-1">
              {qa.map((it, i) => (
                <AccordionItem key={i} value={`qa-${i}`} className="border rounded-md px-3">
                  <AccordionTrigger className="text-sm text-left">{`Q${i + 1}. ${it.question}`}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">{it.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}

        <p className="text-center text-xs text-muted-foreground pt-2 pb-8">
          Powered by <Link to="/" className="text-foreground hover:underline">PageSprint AI</Link>
        </p>
      </main>
    </div>
  );
}
