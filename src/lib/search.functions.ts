import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const searchSummaries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q: string }) => z.object({ q: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const q = data.q.trim();
    // Escape % and _ for ILIKE
    const safe = q.replace(/[%_]/g, (m) => "\\" + m);
    const pattern = `%${safe}%`;
    const { data: rows, error } = await (context.supabase as any)
      .from("summaries")
      .select("id,title,subject,folder_id,created_at,page_count,summary_md,diagrams")
      .or(`title.ilike.${pattern},summary_md.ilike.${pattern},subject.ilike.${pattern}`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (rows ?? []) as {
      id: string; title: string; subject: string | null; folder_id: string | null;
      created_at: string; page_count: number; summary_md: string;
      diagrams?: { topic: string; dataUrl: string; caption: string }[] | null;
    }[];
  });
