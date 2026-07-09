import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const COURSE_FOLDERS: Record<"A" | "B", string[]> = {
  A: ["Zoology", "Biology", "Physics", "Chemistry", "Unknown"],
  B: ["English", "SST", "Science", "Comp", "Hindi", "Marathi", "Unknown"],
};

function systemOrder(course: "A" | "B", name: string) {
  const idx = COURSE_FOLDERS[course].indexOf(name);
  if (idx < 0) return 999;
  if (name === "Unknown") return 9999; // pin Unknown last
  return idx; // 0..n-1
}

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles" as never)
      .select("course,diagrams_enabled")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      const { data: ins, error: e2 } = await context.supabase
        .from("profiles" as never)
        .insert({ user_id: context.userId } as never)
        .select("course,diagrams_enabled")
        .single();
      if (e2) throw new Error(e2.message);
      return ins as { course: "A" | "B" | null; diagrams_enabled: boolean };
    }
    return data as { course: "A" | "B" | null; diagrams_enabled: boolean };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { course?: "A" | "B"; diagrams_enabled?: boolean }) =>
    z.object({
      course: z.enum(["A", "B"]).optional(),
      diagrams_enabled: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.course !== undefined) patch.course = data.course;
    if (data.diagrams_enabled !== undefined) patch.diagrams_enabled = data.diagrams_enabled;
    const { error } = await context.supabase
      .from("profiles" as never)
      .update(patch as never)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const syncCourseFolders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { course: "A" | "B" }) => z.object({ course: z.enum(["A", "B"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const names = COURSE_FOLDERS[data.course];
    // Fetch existing system folders for this user
    const { data: existing, error } = await context.supabase
      .from("folders")
      .select("id,name,kind")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const have = new Map(((existing ?? []) as { id: string; name: string; kind: string }[]).map(f => [f.name, f]));

    // Insert missing system folders
    const toInsert = names
      .filter(n => !have.has(n))
      .map(n => ({
        user_id: context.userId,
        name: n,
        kind: "system",
        sort_order: systemOrder(data.course, n),
      }));
    if (toInsert.length) {
      const { error: e2 } = await context.supabase.from("folders").insert(toInsert as never);
      if (e2) throw new Error(e2.message);
    }

    // Update kind/sort for matching folders (in case user previously had a same-name user folder)
    for (const n of names) {
      const f = have.get(n);
      if (f && f.kind !== "system") {
        await context.supabase
          .from("folders")
          .update({ kind: "system", sort_order: systemOrder(data.course, n) } as never)
          .eq("id", f.id);
      }
    }

    // Demote previously-system folders that aren't in the new course set (so user can delete them)
    for (const f of (existing ?? []) as { id: string; name: string; kind: string }[]) {
      if (f.kind === "system" && !names.includes(f.name)) {
        await context.supabase
          .from("folders")
          .update({ kind: "user", sort_order: 1000 } as never)
          .eq("id", f.id);
      }
    }

    return { ok: true };
  });

export const deleteAllHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("summaries")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Clean-slate course switch: wipe all summaries, folders, share imports, then set new course + sync folders. */
export const switchCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { course: "A" | "B" }) => z.object({ course: z.enum(["A", "B"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("summaries").delete().eq("user_id", context.userId);
    await context.supabase.from("folders").delete().eq("user_id", context.userId);
    await context.supabase.from("shared_imports" as never).delete().eq("user_id", context.userId);
    await context.supabase
      .from("profiles" as never)
      .update({ course: data.course } as never)
      .eq("user_id", context.userId);
    // Insert system folders for the new course
    const names = COURSE_FOLDERS[data.course];
    const rows = names.map((n) => ({
      user_id: context.userId,
      name: n,
      kind: "system",
      sort_order: systemOrder(data.course, n),
    }));
    const { error } = await context.supabase.from("folders").insert(rows as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Cascades via auth.users FK on profiles; folders/summaries rows are user-scoped — delete explicitly.
    await context.supabase.from("summaries").delete().eq("user_id", context.userId);
    await context.supabase.from("folders").delete().eq("user_id", context.userId);
    await context.supabase.from("shared_imports" as never).delete().eq("user_id", context.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export const classifySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text: string; course: "A" | "B" }) =>
    z.object({ text: z.string().min(1), course: z.enum(["A", "B"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");
    const allowed = COURSE_FOLDERS[data.course];
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `Classify study notes into exactly ONE of these subjects: ${allowed.join(", ")}. If the content does not clearly fit any subject, choose "Unknown". Respond with ONLY the subject name, nothing else.`,
          },
          { role: "user", content: data.text.slice(0, 4000) },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) return "Unknown";
    const json = await res.json();
    const raw = String(json?.choices?.[0]?.message?.content ?? "").trim();
    const match = allowed.find(s => s.toLowerCase() === raw.toLowerCase());
    return match ?? "Unknown";
  });
