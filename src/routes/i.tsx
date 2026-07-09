import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { fetchRemoteFiles } from "@/lib/extension.functions";
import { pdfToImageDataUrls } from "@/lib/pdf-to-images";
import type { UploadedPage } from "@/components/ps/uploader";

type Search = { u?: string | string[] };

export const Route = createFileRoute("/i")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const u = raw.u;
    if (typeof u === "string") return { u };
    if (Array.isArray(u)) return { u: u.filter((x): x is string => typeof x === "string") };
    return {};
  },
  component: ImportPage,
});

function ImportPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const { u } = Route.useSearch();
  const runFetch = useServerFn(fetchRemoteFiles);
  const started = useRef(false);
  const [status, setStatus] = useState<string>("Preparing…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/login", search: { redirect: window.location.pathname + window.location.search } as never, replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;

    const urls = (Array.isArray(u) ? u : u ? [u] : []).filter(Boolean);
    if (!urls.length) {
      setError("No URLs supplied. Use /i?u=<file-url>&u=<file-url>");
      return;
    }

    (async () => {
      try {
        setStatus(`Fetching ${urls.length} file${urls.length === 1 ? "" : "s"}…`);
        const { files, errors } = await runFetch({ data: { urls } });
        const out: UploadedPage[] = [];
        for (const f of files) {
          if (f.mime === "application/pdf") {
            const blob = await (await fetch(f.dataUrl)).blob();
            const file = new File([blob], f.name, { type: "application/pdf" });
            const pgs = await pdfToImageDataUrls(file);
            pgs.forEach((p) => out.push({ id: crypto.randomUUID(), dataUrl: p.dataUrl, name: p.name }));
          } else {
            out.push({ id: crypto.randomUUID(), dataUrl: f.dataUrl, name: f.name });
          }
        }
        if (!out.length) {
          setError(errors.map((e) => `${e.url}: ${e.error}`).join("\n") || "No files could be imported.");
          return;
        }
        sessionStorage.setItem("ps:pending-import", JSON.stringify(out));
        setStatus(`Imported ${files.length} file${files.length === 1 ? "" : "s"} · ${out.length} page${out.length === 1 ? "" : "s"}. Opening Workspace…`);
        setTimeout(() => nav({ to: "/", replace: true }), 400);
      } catch (e) {
        setError((e as Error).message || "Import failed");
      }
    })();
  }, [loading, user, u, runFetch, nav]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm text-center space-y-3 animate-fade-in">
        {error ? (
          <>
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <h1 className="text-base font-semibold">Import failed</h1>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{error}</p>
            <button
              onClick={() => nav({ to: "/" })}
              className="mt-2 text-xs underline text-primary"
            >
              Back to Workspace
            </button>
          </>
        ) : status.startsWith("Imported") ? (
          <>
            <CheckCircle2 className="h-8 w-8 mx-auto text-primary" />
            <h1 className="text-base font-semibold">Done</h1>
            <p className="text-xs text-muted-foreground">{status}</p>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
            <h1 className="text-base font-semibold">URL Import</h1>
            <p className="text-xs text-muted-foreground">{status}</p>
          </>
        )}
      </div>
    </div>
  );
}
