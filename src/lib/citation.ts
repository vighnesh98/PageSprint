// Find the best-matching OCR line(s) and page for a summary bullet.
// Pure browser util — no server roundtrip.

const STOP = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","by",
  "is","are","was","were","be","been","being","as","that","this","these","those",
  "it","its","from","into","than","then","so","such","not","no","do","does","did",
  "has","have","had","can","could","should","would","will","may","might","must",
  "i","you","he","she","they","we","them","his","her","their","our","your","my",
  "if","when","while","also","more","most","very","much","some","any","all","each",
  "which","who","whom","whose","what","where","why","how",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\*\*|`|[*_~]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function scoreLine(bulletTokens: Set<string>, lineTokens: string[]): number {
  if (!lineTokens.length || !bulletTokens.size) return 0;
  let hits = 0;
  for (const t of lineTokens) if (bulletTokens.has(t)) hits += 1;
  // weighted: overlap-per-bullet (prioritises lines that cover the bullet)
  const coverage = hits / bulletTokens.size;
  const density = hits / Math.max(6, lineTokens.length);
  return coverage * 0.75 + density * 0.25;
}

export type CitationMatch = {
  pageIndex: number; // 0-based
  lineIndices: number[]; // best matching lines on that page (0-based)
  score: number;
};

export function findCitation(
  bulletText: string,
  pageTexts: { index: number; text: string }[],
): CitationMatch | null {
  const tokens = new Set(tokenize(bulletText));
  if (!tokens.size || !pageTexts.length) return null;

  type LineScore = { lineIdx: number; score: number };
  let best: { pageIndex: number; lines: LineScore[]; total: number } | null = null;

  for (const page of pageTexts) {
    const rawLines = page.text.split(/\n+/);
    const lineScores: LineScore[] = rawLines.map((ln, i) => ({
      lineIdx: i,
      score: scoreLine(tokens, tokenize(ln)),
    }));
    const ranked = [...lineScores].sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, 3).filter((l) => l.score > 0.08);
    if (!top.length) continue;
    const total = top.reduce((s, l) => s + l.score, 0);
    if (!best || total > best.total) {
      best = { pageIndex: page.index, lines: top, total };
    }
  }
  if (!best) return null;
  return {
    pageIndex: best.pageIndex,
    lineIndices: best.lines.map((l) => l.lineIdx).sort((a, b) => a - b),
    score: best.total,
  };
}
