import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_summaries",
  title: "List saved summaries",
  description:
    "List the signed-in user's saved PageSprint AI study summaries (title, subject, page count, created date). Optionally filter by a search term.",
  inputSchema: {
    query: z.string().trim().max(120).optional().describe("Optional text to filter title / subject / body."),
    limit: z.number().int().min(1).max(50).optional().describe("Max rows to return (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("summaries")
      .select("id,title,subject,page_count,created_at,share_token")
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (query) {
      const p = `%${query.replace(/[%_]/g, (m) => "\\" + m)}%`;
      q = q.or(`title.ilike.${p},subject.ilike.${p},summary_md.ilike.${p}`);
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { summaries: data ?? [] },
    };
  },
});
