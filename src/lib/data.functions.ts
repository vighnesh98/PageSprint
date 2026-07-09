import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("folders")
      .select("id,name,created_at,kind,sort_order")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string; created_at: string; kind?: string; sort_order?: number }[];
  });

export const createFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string }) => z.object({ name: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("folders")
      .insert({ name: data.name, user_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const renameFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name: string }) => z.object({ id: z.string().uuid(), name: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("folders").update({ name: data.name }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("folders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listSummaries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { folderId?: string | null }) => z.object({ folderId: z.string().uuid().nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = (context.supabase as any).from("summaries").select("id,title,subject,mode,summary_md,qa,page_count,folder_id,created_at,share_token,diagrams").order("created_at", { ascending: false });
    if (data.folderId) q = q.eq("folder_id", data.folderId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateSummaryDiagrams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; diagrams: { topic: string; dataUrl: string; caption: string }[] }) =>
    z.object({
      id: z.string().uuid(),
      diagrams: z.array(z.object({
        topic: z.string(),
        dataUrl: z.string(),
        caption: z.string(),
      })).max(40),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("summaries")
      .update({ diagrams: data.diagrams })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    title: string; subject?: string | null; mode: string; summary_md: string;
    qa: { question: string; answer: string }[]; page_count: number; folder_id?: string | null;
  }) => z.object({
    title: z.string().min(1).max(200),
    subject: z.string().max(120).nullable().optional(),
    mode: z.string().min(1).max(40),
    summary_md: z.string().min(1),
    qa: z.array(z.object({ question: z.string(), answer: z.string() })),
    page_count: z.number().int().min(0),
    folder_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("summaries")
      .insert({
        user_id: context.userId,
        title: data.title,
        subject: data.subject ?? null,
        mode: data.mode,
        summary_md: data.summary_md,
        qa: data.qa,
        page_count: data.page_count,
        folder_id: data.folder_id ?? null,
      } as any)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string; title: string; subject?: string | null; folder_id?: string | null;
  }) => z.object({
    id: z.string().uuid(),
    title: z.string().min(1).max(200),
    subject: z.string().max(120).nullable().optional(),
    folder_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("summaries")
      .update({
        title: data.title,
        subject: data.subject ?? null,
        folder_id: data.folder_id ?? null,
      } as any)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("summaries").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
