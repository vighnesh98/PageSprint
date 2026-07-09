// Browser-side helper that takes vision bbox detections and crops each region
// from the original page image into a higher-quality JPEG data URL.
// Guarded so it's a no-op during SSR / Node where canvas/Image don't exist.
export type DiagramRegion = {
  pageIndex: number;
  topic: string;
  caption: string;
  bbox: [number, number, number, number]; // x,y,w,h normalized 0..1
  confidence?: number;
};

export type CroppedDiagram = {
  topic: string;
  dataUrl: string;
  caption: string;
  pageIndex?: number;
  bbox?: [number, number, number, number];
  confidence?: number;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function cropDiagrams(
  pages: { index: number; dataUrl: string }[],
  regions: DiagramRegion[],
): Promise<CroppedDiagram[]> {
  if (!isBrowser()) return [];
  const byPage = new Map<number, DiagramRegion[]>();
  for (const r of regions) {
    const arr = byPage.get(r.pageIndex) ?? [];
    arr.push(r);
    byPage.set(r.pageIndex, arr);
  }
  const out: CroppedDiagram[] = [];
  // Pad bbox outward so we don't shave off labels/edges; minimum dimension.
  const PAD = 0.035; // 3.5% of page on each side
  for (const page of pages) {
    const rs = byPage.get(page.index);
    if (!rs?.length) continue;
    let img: HTMLImageElement;
    try {
      img = await loadImage(page.dataUrl);
    } catch {
      continue;
    }
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) continue;
    for (const r of rs) {
      let [nx, ny, nw, nh] = r.bbox;
      // Some models return [x1,y1,x2,y2] — heuristically detect & normalize.
      if (nw <= nx || nh <= ny) {
        // probably already w/h
      } else if (nw + nx > 1.05 || nh + ny > 1.05) {
        // Looks like x2,y2 form
        nw = Math.max(0, nw - nx);
        nh = Math.max(0, nh - ny);
      }
      // Clamp and pad
      nx = Math.max(0, nx - PAD);
      ny = Math.max(0, ny - PAD);
      nw = Math.min(1 - nx, nw + PAD * 2);
      nh = Math.min(1 - ny, nh + PAD * 2);

      const x = Math.max(0, Math.floor(nx * W));
      const y = Math.max(0, Math.floor(ny * H));
      const w = Math.min(W - x, Math.floor(nw * W));
      const h = Math.min(H - y, Math.floor(nh * H));
      if (w < 24 || h < 24) continue;

      // Upscale small crops modestly for crisper display, cap at 1600px wide.
      const targetW = Math.min(1600, Math.max(w, 800));
      const scale = targetW / w;
      const outW = Math.round(w * scale);
      const outH = Math.round(h * scale);

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Soft white backdrop in case of transparent inputs
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(img, x, y, w, h, 0, 0, outW, outH);
      const url = canvas.toDataURL("image/jpeg", 0.92);
      out.push({
        topic: r.topic,
        caption: r.caption,
        dataUrl: url,
        pageIndex: r.pageIndex,
        bbox: r.bbox,
        confidence: r.confidence,
      });
    }
  }
  return out;
}
