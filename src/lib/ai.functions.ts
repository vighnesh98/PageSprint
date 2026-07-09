import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

async function callAI(body: unknown, maxRetries = 4) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await fetch(GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return res.json();
      const txt = await res.text();
      if (res.status === 402) throw new Error("AI credits exhausted. Please add funds in Workspace Usage.");
      // Retry on transient errors (rate limit + 5xx)
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 600 * 2 ** attempt) + Math.random() * 400;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (res.status === 429) throw new Error("Rate limit reached after retries. Please wait a moment and try again.");
      throw new Error(`AI gateway error (${res.status}): ${txt.slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
      // Network-level error — retry with backoff
      if (attempt < maxRetries && !(e instanceof Error && /credits exhausted/i.test(e.message))) {
        await new Promise((r) => setTimeout(r, Math.min(8000, 600 * 2 ** attempt)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI request failed");
}

const PageSchema = z.object({
  index: z.number(),
  dataUrl: z.string(),
});

const formatRules = `Format strictly as Markdown using:
- **Bold section headers** on their own line (e.g. **Key Concepts**)
- Clean bullet points starting with "- "
- Use sub-bullets with two-space indentation when needed
- No paragraphs, no preamble, no closing remarks. Headers + bullets only.`;

/** OCR a SINGLE page — enables granular client-side progress + cancel. */
export const ocrPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { index: number; dataUrl: string }) => PageSchema.parse(d))
  .handler(async ({ data }) => {
    const json = await callAI({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a careful OCR engine for student notes. Extract ALL readable text from the image exactly as written, preserve line breaks, and estimate OCR confidence. Flag only snippets that may be wrong or unreadable." },
        { role: "user", content: [
          { type: "text", text: `Extract all text from this page image (page ${data.index + 1}). Return structured OCR data.` },
          { type: "image_url", image_url: { url: data.dataUrl } },
        ] },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_ocr",
          description: "Return OCR text with confidence diagnostics",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 100 },
              lowConfidence: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    snippet: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["snippet", "reason"],
                  additionalProperties: false,
                },
              },
            },
            required: ["text", "confidence", "lowConfidence"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_ocr" } },
    });
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    const args = call ? JSON.parse(call.function.arguments) : { text: String(json.choices?.[0]?.message?.content ?? ""), confidence: 70, lowConfidence: [] };
    const text = String(args.text || "");
    let rawConf = Number(args.confidence ?? 70);
    if (!Number.isFinite(rawConf)) rawConf = 70;
    // Normalize: many models return 0-1 instead of 0-100
    if (rawConf > 0 && rawConf <= 1) rawConf = rawConf * 100;
    const lowConfidence = Array.isArray(args.lowConfidence) ? args.lowConfidence as { snippet: string; reason: string }[] : [];
    // Reality-check: derive a heuristic confidence from text density & flagged snippets
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const flagged = lowConfidence.length;
    let heuristic = 90;
    if (words < 5) heuristic = 25;
    else if (words < 20) heuristic = 55;
    else if (words < 60) heuristic = 75;
    heuristic -= Math.min(35, flagged * 6);
    // Combine model + heuristic, prefer the lower (more cautious) but ignore obviously broken values
    const modelConf = rawConf < 5 ? heuristic : rawConf;
    const confidence = Math.max(0, Math.min(100, Math.round((modelConf + heuristic) / 2)));
    return { index: data.index, text, confidence, lowConfidence };
  });

/** Generate summary from already-extracted page texts. */
export const summarizeTexts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pageTexts: { index: number; text: string }[]; mode: "per-page" | "big-picture"; instructions?: string }) =>
    z.object({
      pageTexts: z.array(z.object({ index: z.number(), text: z.string() })).min(1),
      mode: z.enum(["per-page", "big-picture"]),
      instructions: z.string().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const pageTexts = [...data.pageTexts].sort((a, b) => a.index - b.index);
    const customLine = data.instructions?.trim()
      ? `\n\nADDITIONAL USER INSTRUCTIONS (follow strictly):\n${data.instructions.trim()}`
      : "";

    if (data.mode === "per-page") {
      const summaries = await Promise.all(pageTexts.map(async (p) => {
        if (!p.text.trim()) return { index: p.index, summary: "**Page " + (p.index + 1) + "**\n- (no text detected)" };
        const json = await callAI({
          model: MODEL,
          messages: [
            { role: "system", content: `You are an expert study-note generator. Summarize the provided page text for a student.${customLine}\n\n${formatRules}` },
            { role: "user", content: `Page ${p.index + 1} text:\n"""\n${p.text}\n"""\n\nProduce a focused summary of this page. Start with a header "**Page ${p.index + 1}**".` },
          ],
        });
        return { index: p.index, summary: String(json.choices?.[0]?.message?.content ?? "") };
      }));
      summaries.sort((a, b) => a.index - b.index);
      return { summary: summaries.map((s) => s.summary).join("\n\n---\n\n") };
    } else {
      const all = pageTexts.map((p) => `--- Page ${p.index + 1} ---\n${p.text}`).join("\n\n");
      const json = await callAI({
        model: MODEL,
        messages: [
          { role: "system", content: `You are an expert study-note generator. Build a single cohesive "big picture" summary across all pages provided.${customLine}\n\n${formatRules}` },
          { role: "user", content: `Pages:\n"""\n${all}\n"""\n\nGenerate one master summary that ties everything together. Use multiple **bold section headers** for major themes.` },
        ],
      });
      return { summary: String(json.choices?.[0]?.message?.content ?? "") };
    }
  });

export const generateQA = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pageTexts: { index: number; text: string }[]; range: string }) =>
    z.object({
      pageTexts: z.array(z.object({ index: z.number(), text: z.string() })).min(1),
      range: z.string().min(1).max(100),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    // Parse range "1,3" or "2-4" or "2"
    const wanted = new Set<number>();
    for (const part of data.range.split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) wanted.add(i);
      } else if (/^\d+$/.test(part)) {
        wanted.add(parseInt(part, 10));
      }
    }
    if (!wanted.size) throw new Error("Invalid page range. Use e.g. '2', '2-4', or '1, 3'.");

    const selected = data.pageTexts
      .filter((p) => wanted.has(p.index + 1))
      .map((p) => `--- Page ${p.index + 1} ---\n${p.text}`)
      .join("\n\n");
    if (!selected.trim()) throw new Error("No matching pages found for that range.");

    const json = await callAI({
      model: MODEL,
      messages: [
        { role: "system", content: "You generate study questions and answers. Use ONLY the provided text. Do not invent content not present." },
        { role: "user", content: `Source pages:\n"""\n${selected}\n"""\n\nGenerate exactly 5 study questions with answers.` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_qa",
          description: "Return 5 study questions with answers",
          parameters: {
            type: "object",
            properties: {
              qa: {
                type: "array",
                items: {
                  type: "object",
                  properties: { question: { type: "string" }, answer: { type: "string" } },
                  required: ["question", "answer"],
                  additionalProperties: false,
                },
              },
            },
            required: ["qa"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_qa" } },
    });
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    const args = call ? JSON.parse(call.function.arguments) : { qa: [] };
    return { qa: args.qa as { question: string; answer: string }[] };
  });

/** Generate verified MCQs grouped by topic from the summary (uses summary only, no invention). */
export const generateTopicQA = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { summaryMd: string; questionsPerTopic?: number }) =>
    z.object({
      summaryMd: z.string().min(20).max(60000),
      questionsPerTopic: z.number().int().min(2).max(8).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const n = data.questionsPerTopic ?? 5;
    const json = await callAI({
      model: MODEL,
      messages: [
        { role: "system", content: "You generate verified multiple-choice study questions. Use ONLY the provided summary content, as if answers must be found in the student's book/notes. Identify every distinct topic (each **bold header** is a topic; if none, infer 3-6 topics). Do not invent facts." },
        { role: "user", content: `Summary:\n"""\n${data.summaryMd}\n"""\n\nFor EACH topic, generate exactly ${n} MCQs. Each MCQ needs 4 options, one exact correct answer, and a short evidence line copied or paraphrased only from the summary.` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_topics",
          description: "Return topics with their questions and answers",
          parameters: {
            type: "object",
            properties: {
              topics: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    topic: { type: "string" },
                    qa: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          question: { type: "string" },
                          options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                          answer: { type: "string" },
                          evidence: { type: "string" },
                        },
                        required: ["question", "options", "answer", "evidence"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["topic", "qa"],
                  additionalProperties: false,
                },
              },
            },
            required: ["topics"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_topics" } },
    });
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    const args = call ? JSON.parse(call.function.arguments) : { topics: [] };
    return { topics: args.topics as { topic: string; qa: { question: string; options: string[]; answer: string; evidence: string }[] }[] };
  });

/** Auto-detect the subject/title from the summary text. */
export const detectSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { summaryMd: string }) =>
    z.object({ summaryMd: z.string().min(10).max(60000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const json = await callAI({
      model: MODEL,
      messages: [
        { role: "system", content: "You identify the academic subject and a concise chapter title from study notes. Respond with JSON only." },
        { role: "user", content: `Notes summary:\n"""\n${data.summaryMd.slice(0, 4000)}\n"""` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_subject",
          description: "Return detected subject and a short title",
          parameters: {
            type: "object",
            properties: {
              subject: { type: "string", description: "Broad subject e.g. Biology, Physics, History" },
              title: { type: "string", description: "Concise descriptive title <= 60 chars" },
            },
            required: ["subject", "title"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_subject" } },
    });
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    const args = call ? JSON.parse(call.function.arguments) : { subject: "", title: "" };
    return { subject: String(args.subject || ""), title: String(args.title || "") };
  });

/** Vision: detect diagram regions on a single page, mapped to topics from the summary. */
export const detectDiagramRegions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { index: number; dataUrl: string; topics: string[] }) =>
    z.object({
      index: z.number().int().min(0),
      dataUrl: z.string().min(1),
      topics: z.array(z.string()).max(40),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const topicList = data.topics.length
      ? data.topics.join(" | ")
      : "(no topics — invent a short 1-3 word label)";
    const json = await callAI({
      model: MODEL,
      messages: [
        { role: "system", content: [
          "You are a strict vision detector for STUDENT NOTES.",
          "Your ONLY job: find every non-text visual on the page and return a tight bounding box.",
          "A visual is anything that is NOT plain paragraph text: hand-drawn or printed diagrams, sketches, figures,",
          "charts, graphs, tables with lines/grids, chemical structures, biological drawings, geometric figures,",
          "flowcharts, arrows-with-labels, circuit diagrams, maps, formulas rendered as images, labeled photos.",
          "Even rough pencil sketches count. Even small ones count. If ANY drawing exists, RETURN IT.",
          "Return bbox as [x, y, w, h] normalized 0..1 with origin top-left. WIDTH & HEIGHT, not x2/y2.",
          "Pad the box slightly so labels around the drawing are included.",
          "Assign each to the single best topic from the list; if none fits, invent a 1-3 word topic label.",
          "Caption: one short sentence naming what the drawing shows.",
          "If — and only if — the page is 100% plain text with zero drawings, return an empty array.",
        ].join(" ") },
        { role: "user", content: [
          { type: "text", text: `Topics available: ${topicList}\n\nPage number: ${data.index + 1}\n\nDetect ALL diagrams / drawings / figures / tables / charts on this page. Be thorough — err on the side of INCLUDING borderline cases.` },
          { type: "image_url", image_url: { url: data.dataUrl } },
        ] },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_diagrams",
          description: "Return diagram regions",
          parameters: {
            type: "object",
            properties: {
              diagrams: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    topic: { type: "string" },
                    caption: { type: "string" },
                    bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
                    confidence: { type: "number", minimum: 0, maximum: 100 },
                  },
                  required: ["topic", "caption", "bbox"],
                  additionalProperties: false,
                },
              },
            },
            required: ["diagrams"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_diagrams" } },
    });
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    const args = call ? JSON.parse(call.function.arguments) : { diagrams: [] };
    const diagrams = (Array.isArray(args.diagrams) ? args.diagrams : []) as { topic: string; caption: string; bbox: number[]; confidence?: number }[];
    return diagrams
      .filter((d) => Array.isArray(d.bbox) && d.bbox.length === 4 && d.bbox.every((n) => Number.isFinite(n)))
      .map((d) => {
        let c = Number(d.confidence ?? 80);
        if (!Number.isFinite(c)) c = 80;
        if (c > 0 && c <= 1) c = c * 100;
        return {
          pageIndex: data.index,
          topic: String(d.topic || "Figure").trim() || "Figure",
          caption: String(d.caption || "").trim(),
          bbox: [d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]] as [number, number, number, number],
          confidence: Math.max(0, Math.min(100, Math.round(c))),
        };
      });
  });
