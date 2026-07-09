import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 20;

const InputSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(MAX_FILES),
});

export type FetchedFile = {
  url: string;
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
};

/**
 * Server-side download of remote files. Bypasses browser CORS and returns
 * base64 data URLs the client can hand to the uploader / PDF splitter.
 * Only images and PDFs are accepted.
 */
export const fetchRemoteFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { urls: string[] }) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const results: FetchedFile[] = [];
    const errors: { url: string; error: string }[] = [];

    await Promise.all(
      data.urls.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "PageSprint/1.0" },
            redirect: "follow",
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const mime = (res.headers.get("content-type") || "application/octet-stream")
            .split(";")[0]
            .trim()
            .toLowerCase();

          const isImage = mime.startsWith("image/");
          const isPdf = mime === "application/pdf" || /\.pdf(\?|$)/i.test(url);
          if (!isImage && !isPdf) throw new Error(`Unsupported type: ${mime}`);

          const buf = await res.arrayBuffer();
          if (buf.byteLength > MAX_BYTES) throw new Error(`File too large (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`);

          const b64 = Buffer.from(buf).toString("base64");
          const finalMime = isPdf ? "application/pdf" : mime;
          const nameGuess =
            (() => {
              try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); }
              catch { return ""; }
            })() || `remote-${Date.now()}${isPdf ? ".pdf" : ".jpg"}`;

          results.push({
            url,
            name: nameGuess,
            mime: finalMime,
            size: buf.byteLength,
            dataUrl: `data:${finalMime};base64,${b64}`,
          });
        } catch (e) {
          errors.push({ url, error: (e as Error).message || "Fetch failed" });
        }
      }),
    );

    return { files: results, errors };
  });
