import { jsPDF } from "jspdf";

type QA = { question: string; answer: string };
type MCQ = { question: string; options: string[]; answer: string; evidence?: string };

function stripMd(s: string) {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

export function exportSummaryPdf(opts: {
  title: string;
  folderName?: string | null;
  subject?: string | null;
  summaryMd: string;
  qa: QA[];
  diagrams?: { topic: string; dataUrl: string; caption: string }[];
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = M;

  const ensure = (need: number) => {
    if (y + need > H - M) { doc.addPage(); y = M; }
  };
  const writeWrapped = (text: string, size: number, style: "normal" | "bold" | "italic" = "normal", indent = 0, color = 35) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(text, W - M * 2 - indent) as string[];
    for (const ln of lines) {
      ensure(size + 4);
      doc.text(ln, M + indent, y);
      y += size + 4;
    }
  };

  doc.setFillColor(20, 35, 34); doc.rect(0, 0, W, 112, "F");
  doc.setTextColor(235, 255, 247); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
  doc.text(opts.title, M, y); y += 28;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(178, 218, 202);
  const meta = `${opts.subject ? `Subject: ${opts.subject}  ·  ` : ""}${opts.folderName ? `Folder: ${opts.folderName}  ·  ` : ""}Generated ${new Date().toLocaleString()}`;
  doc.text(doc.splitTextToSize(meta, W - M * 2) as string[], M, y); y = 132;
  doc.setTextColor(35);

  // Diagram helpers
  const normTopic = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byTopic = new Map<string, { topic: string; dataUrl: string; caption: string }[]>();
  for (const d of opts.diagrams ?? []) {
    const k = normTopic(d.topic);
    const arr = byTopic.get(k) ?? [];
    arr.push(d); byTopic.set(k, arr);
  }
  const drawDiagram = (d: { dataUrl: string; caption: string; topic: string }) => {
    // Read intrinsic size from data URL via a temp image (sync via Image not available in jsPDF);
    // fall back to a fixed aspect if unknown.
    const maxW = W - M * 2;
    const targetW = Math.min(maxW, 360);
    const targetH = targetW * 0.62; // approximate; jsPDF stretches to given box
    ensure(targetH + 28);
    try {
      doc.addImage(d.dataUrl, "JPEG", M, y, targetW, targetH, undefined, "FAST");
    } catch {
      try { doc.addImage(d.dataUrl, "PNG", M, y, targetW, targetH, undefined, "FAST"); } catch {}
    }
    y += targetH + 4;
    if (d.caption) writeWrapped(d.caption, 9, "italic", 4, 100);
    y += 4;
  };
  const flushDiagramsFor = (header: string | null) => {
    if (!header) return;
    const items = byTopic.get(normTopic(header));
    if (!items?.length) return;
    items.forEach(drawDiagram);
    byTopic.delete(normTopic(header));
  };

  // Summary
  writeWrapped("Structured Summary", 14, "bold"); y += 8;
  const lines = opts.summaryMd.replace(/\r/g, "").split("\n");
  let currentHeader: string | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { y += 6; continue; }
    if (/^---+$/.test(line.trim())) {
      flushDiagramsFor(currentHeader); currentHeader = null;
      ensure(12); doc.setDrawColor(226); doc.line(M, y, W - M, y); y += 10; continue;
    }
    const header = line.trim().match(/^\*\*(.+?)\*\*\s*:?\s*$/);
    if (header) {
      flushDiagramsFor(currentHeader);
      currentHeader = header[1];
      y += 8; doc.setFillColor(232, 248, 240); doc.roundedRect(M, y - 12, W - M * 2, 24, 6, 6, "F");
      writeWrapped(header[1], 12, "bold", 10, 22); y += 4; continue;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      const depth = Math.floor(bullet[1].length / 2);
      const indent = 12 + depth * 14;
      ensure(14);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 130, 85);
      doc.text("•", M + indent - 10, y);
      writeWrapped(stripMd(bullet[2]), 11, "normal", indent);
      continue;
    }
    writeWrapped(stripMd(line), 11, "normal");
  }
  flushDiagramsFor(currentHeader);

  // Any diagrams that didn't match a header — dump under "Diagrams"
  const leftover: { topic: string; dataUrl: string; caption: string }[] = [];
  byTopic.forEach((arr) => leftover.push(...arr));
  if (leftover.length) {
    y += 10; ensure(30);
    doc.setFillColor(232, 248, 240); doc.roundedRect(M, y - 12, W - M * 2, 24, 6, 6, "F");
    writeWrapped("Diagrams", 12, "bold", 10, 22); y += 6;
    leftover.forEach(drawDiagram);
  }

  // Q&A
  if (opts.qa.length) {
    y += 14; ensure(40);
    doc.setDrawColor(220); doc.line(M, y, W - M, y); y += 18;
    writeWrapped("Practice Questions & Answers", 14, "bold"); y += 4;
    opts.qa.forEach((qa, i) => {
      y += 6; ensure(40);
      writeWrapped(`Q${i + 1}. ${qa.question}`, 11, "bold");
      writeWrapped(qa.answer, 11, "normal", 12);
    });
  }


  const safe = opts.title.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60) || "pagesprint";
  doc.save(`${safe}.pdf`);
}

export function exportTopicQuestionsPdf(opts: {
  title: string;
  subject?: string | null;
  topics: { topic: string; qa: MCQ[] }[];
  includeAnswers: boolean;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = M;
  const ensure = (need: number) => { if (y + need > H - M) { doc.addPage(); y = M; } };
  const write = (text: string, size: number, style: "normal" | "bold" | "italic" = "normal", indent = 0, color = 35) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(text, W - M * 2 - indent) as string[];
    for (const ln of lines) { ensure(size + 4); doc.text(ln, M + indent, y); y += size + 4; }
  };

  doc.setFillColor(20, 35, 34); doc.rect(0, 0, W, 112, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(235, 255, 247);
  doc.text(opts.title, M, y); y += 26;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(178, 218, 202);
  doc.text(`${opts.subject ? `Subject: ${opts.subject}  ·  ` : ""}${opts.includeAnswers ? "MCQs with answers" : "MCQs only"}  ·  Generated ${new Date().toLocaleString()}`, M, y);
  y = 132;

  opts.topics.forEach((t, ti) => {
    y += 6; ensure(52);
    doc.setFillColor(232, 248, 240); doc.roundedRect(M, y - 14, W - M * 2, 28, 6, 6, "F");
    write(`${ti + 1}. ${t.topic}`, 13, "bold", 10, 22);
    t.qa.forEach((qa, qi) => {
      y += 6; ensure(74);
      write(`Q${qi + 1}. ${stripMd(qa.question)}`, 11, "bold", 12);
      qa.options.slice(0, 4).forEach((opt, oi) => write(`${String.fromCharCode(65 + oi)}. ${stripMd(opt)}`, 10, "normal", 24, 70));
      if (opts.includeAnswers) {
        write(`Answer: ${stripMd(qa.answer)}`, 10, "bold", 24, 30);
        if (qa.evidence) write(`Book proof: ${stripMd(qa.evidence)}`, 10, "italic", 24, 80);
      }
    });
    y += 6;
  });

  const safe = opts.title.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60) || "pagesprint-questions";
  doc.save(`${safe}.pdf`);
}
