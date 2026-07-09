import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSummariesTool from "./tools/list-summaries";
import getSummaryTool from "./tools/get-summary";
import listFoldersTool from "./tools/list-folders";

// The OAuth issuer MUST be the direct Supabase host. On publish, SUPABASE_URL
// is rewritten to the `.lovable.cloud` proxy which mcp-js rejects. VITE_SUPABASE_PROJECT_ID
// is inlined by Vite at build time and survives publish unchanged.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "pagesprint-mcp",
  title: "PageSprint AI",
  version: "0.1.0",
  instructions:
    "Read-only access to the signed-in user's PageSprint AI study library. Use `list_folders` and `list_summaries` to discover items, then `get_summary` for the full Markdown, Q&A, and diagrams.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listSummariesTool, getSummaryTool, listFoldersTool],
});
