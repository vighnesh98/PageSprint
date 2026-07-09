import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Generate (or return existing) public share token for a summary the user owns.
export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing, error: e1 } = await (context.supabase as any)
      .from("summaries")
      .select("id,share_token")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);
    if (existing?.share_token) return { token: existing.share_token as string };
    // generate via crypto
    const token = crypto.randomUUID();
    const { error: e2 } = await (context.supabase as any)
      .from("summaries")
      .update({ share_token: token, shared_at: new Date().toISOString() })
      .eq("id", data.id);
    if (e2) throw new Error(e2.message);
    return { token };
  });

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("summaries")
      .update({ share_token: null, shared_at: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// List summaries the current user has shared (those with share_token != null).
export const listMyShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("summaries")
      .select("id,title,subject,mode,summary_md,qa,page_count,folder_id,created_at,share_token,shared_at,diagrams")
      .not("share_token", "is", null)
      .order("shared_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// Public: anyone with the token can read.
export const getSharedSummary = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => z.object({ token: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("summaries")
      .select("id,title,subject,mode,summary_md,qa,page_count,created_at,diagrams")
      .eq("share_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This shared link is no longer available.");
    return row;
  });

// Auth: copy a shared summary into the current user's library (idempotent per source).
export const importSharedSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) => z.object({ token: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: src, error: e1 } = await (supabaseAdmin as any)
      .from("summaries")
      .select("id,user_id,title,subject,mode,summary_md,qa,page_count,diagrams")
      .eq("share_token", data.token)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!src) throw new Error("Shared link not found.");
    if (src.user_id === context.userId) return { ok: true, alreadyOwner: true };

    // Idempotent guard
    const { data: prior } = await (context.supabase as any)
      .from("shared_imports")
      .select("id,imported_summary_id")
      .eq("source_summary_id", src.id)
      .maybeSingle();
    if (prior?.imported_summary_id) return { ok: true, summaryId: prior.imported_summary_id };

    const { data: copy, error: e2 } = await (context.supabase as any)
      .from("summaries")
      .insert({
        user_id: context.userId,
        title: `${src.title} (shared)`,
        subject: src.subject,
        mode: src.mode,
        summary_md: src.summary_md,
        qa: src.qa ?? [],
        page_count: src.page_count ?? 0,
        folder_id: null,
        diagrams: src.diagrams ?? null,
      })
      .select()
      .single();
    if (e2) throw new Error(e2.message);

    await (context.supabase as any).from("shared_imports").insert({
      user_id: context.userId,
      source_summary_id: src.id,
      imported_summary_id: copy.id,
    });
    return { ok: true, summaryId: copy.id };
  });
