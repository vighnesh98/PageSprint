import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Zap, ArrowRight, Globe, FileText, Image as ImageIcon, ShieldCheck, Bookmark } from "lucide-react";
import { toast } from "sonner";

/**
 * Extension tab — address-bar import only. No in-app paste box.
 * Users craft or bookmark a URL like /i?u=<FILE_URL> and hit Enter in Chrome.
 */
export function PsExtension({ onOpenWorkspace: _onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://study67.lovable.app";
  const demoPdf = "https://arxiv.org/pdf/1706.03762.pdf";
  const demoImg = "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Whole_world_-_land_and_oceans.jpg/640px-Whole_world_-_land_and_oceans.jpg";
  const addrSingle = `${origin}/i?u=${encodeURIComponent(demoPdf)}`;
  const addrMulti = `${origin}/i?u=${encodeURIComponent(demoPdf)}&u=${encodeURIComponent(demoImg)}`;

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => {
      setCopied(s);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 sm:p-8">
        <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background/80 backdrop-blur px-3 py-1 text-[11px] font-medium">
            <Zap className="h-3 w-3 text-primary" /> Address-bar import
          </div>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
            Paste a link. Get a summary.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Type a specially-formed URL into Chrome (or any browser) and hit Enter. We fetch the
            files, drop them straight into Workspace, and you're ready to summarize — zero clicks
            inside the app.
          </p>
        </div>
      </div>

      {/* URL format */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">The URL format</h3>
        </div>
        <div className="rounded-lg bg-muted/60 border p-3 font-mono text-xs break-all">
          {origin}/i?u=<span className="text-primary font-semibold">&lt;FILE_URL_1&gt;</span>
          <span className="text-muted-foreground">&amp;</span>u=<span className="text-primary font-semibold">&lt;FILE_URL_2&gt;</span>
          <span className="text-muted-foreground"> …</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Repeat <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">&amp;u=…</code> for
          each file. Chrome percent-encodes URLs automatically when you paste them. PDFs auto-split
          into pages.
        </p>
      </div>

      {/* Demos */}
      <div className="grid sm:grid-cols-2 gap-4">
        {[
          { label: "One PDF", icon: FileText, url: addrSingle, note: "Downloads and splits into pages" },
          { label: "PDF + image", icon: ImageIcon, url: addrMulti, note: "Two files, one shot" },
        ].map(({ label, icon: Icon, url, note }) => (
          <div key={label} className="rounded-2xl border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 grid place-items-center">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-[11px] text-muted-foreground">{note}</div>
              </div>
            </div>
            <code className="flex-1 text-[10.5px] font-mono text-muted-foreground break-all leading-relaxed">
              {url}
            </code>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => copy(url)}>
                {copied === url ? <><Check className="h-3.5 w-3.5 mr-1.5" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy</>}
              </Button>
              <Button size="sm" asChild className="flex-1 h-8 text-xs">
                <a href={url}>Try it <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></a>
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6">
        <h3 className="text-sm font-semibold mb-3">How it works</h3>
        <ol className="space-y-3">
          {[
            "Bookmark the URL template — or type it directly into Chrome's address bar.",
            "Swap in your own file link(s) after each u= parameter.",
            "Press Enter — we fetch server-side (no CORS pain) and split PDFs into pages.",
            "You land in Workspace with pages ready to summarize.",
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <div className="h-6 w-6 shrink-0 rounded-full bg-primary/10 text-primary text-[11px] font-semibold grid place-items-center">
                {i + 1}
              </div>
              <div className="text-sm text-muted-foreground">{step}</div>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-lg border bg-muted/40 p-3 flex items-start gap-2 text-xs text-muted-foreground">
          <Bookmark className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
          <span>
            Pro tip: bookmark <code className="text-foreground">{origin}/i?u=</code> in Chrome and
            append your file URL — one click imports anything into Workspace.
          </span>
        </div>
      </div>

      {/* Supported */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">What's supported</h3>
        </div>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <li>• Direct file URLs: PNG, JPG, WEBP, HEIC, PDF</li>
          <li>• Up to 20 files per request</li>
          <li>• 25 MB per file</li>
          <li>• Fetched server-side — bypasses browser CORS</li>
          <li>• Not stored — held in memory only during processing</li>
          <li>• Won't work behind login / paywall / HTML pages</li>
        </ul>
      </div>
    </div>
  );
}
