// Browser-only PDF → image dataURLs splitter.
// Each PDF page becomes one image (JPEG) at ~1.6x scale for OCR-grade quality.
import * as pdfjs from "pdfjs-dist";
// Vite-friendly worker URL
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export async function pdfToImageDataUrls(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<{ dataUrl: string; name: string }[]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: { dataUrl: string; name: string }[] = [];
  const baseName = file.name.replace(/\.pdf$/i, "") || "document";
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    // pdfjs v6 accepts canvas in params
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    out.push({ dataUrl, name: `${baseName}-page-${i}.jpg` });
    onProgress?.(i, doc.numPages);
  }
  return out;
}
