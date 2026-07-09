import { useCallback, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Upload,
  X,
  GripVertical,
  Camera,
  FolderOpen,
  Loader2,
  Smartphone,
  Monitor,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { pdfToImageDataUrls } from "@/lib/pdf-to-images";
import { ImageLightbox } from "./image-lightbox";


export type UploadedPage = { id: string; dataUrl: string; name: string };

function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function Thumb({
  p,
  idx,
  onRemove,
  onView,
  showControls,
}: {
  p: UploadedPage;
  idx: number;
  onRemove: () => void;
  onView: () => void;
  showControls: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
  });
  const controlClass = showControls ? "opacity-100" : "opacity-0 group-hover:opacity-100";
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative group rounded-lg border bg-card overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        isDragging && "opacity-60 ring-2 ring-primary",
      )}
    >
      <button
        type="button"
        onClick={onView}
        className="block w-full aspect-[3/4] bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
        aria-label={`View page ${idx + 1} fullscreen`}
      >
        <img src={p.dataUrl} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />
      </button>
      <div className="pointer-events-none absolute top-1 left-1 bg-background/90 backdrop-blur text-foreground text-[11px] font-medium px-1.5 py-0.5 rounded">
        Page {idx + 1}
      </div>
      <button
        onClick={onRemove}
        className={cn(
          "absolute top-1 right-1 bg-background/90 hover:bg-destructive hover:text-destructive-foreground rounded p-0.5 transition-opacity",
          controlClass,
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <button
        {...attributes}
        {...listeners}
        className={cn(
          "absolute bottom-1 right-1 bg-background/90 hover:bg-accent rounded p-0.5 cursor-grab active:cursor-grabbing transition-opacity",
          controlClass,
        )}
        title="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}


export function PsUploader({
  pages,
  setPages,
}: {
  pages: UploadedPage[];
  setPages: (p: UploadedPage[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<UploadedPage | null>(null);
  const isMobile = useIsMobile();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const openNativePicker = (input: HTMLInputElement | null) => {
    if (!input || busy) return;
    const picker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
    try {
      if (typeof picker === "function") picker.call(input);
      else input.click();
    } catch {
      input.click();
    }
  };

  const ingest = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter(
        (f) => /^image\//i.test(f.type) || /\.(png|jpe?g|webp|heic)$/i.test(f.name),
      );
      if (!arr.length) {
        toast.error("Please select image files (PNG/JPG)");
        return;
      }
      setBusy(true);
      try {
        const next: UploadedPage[] = [];
        for (const f of arr) {
          const dataUrl = await readFile(f);
          next.push({
            id: crypto.randomUUID(),
            dataUrl,
            name: f.name || `photo-${Date.now()}.jpg`,
          });
        }
        setPages([...pages, ...next]);
        toast.success(`${next.length} ${next.length === 1 ? "page" : "pages"} added`);
      } catch {
        toast.error("Could not read file");
      } finally {
        setBusy(false);
      }
    },
    [pages, setPages],
  );

  const ingestPdf = useCallback(
    async (file: File) => {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        toast.error("Please select a PDF file");
        return;
      }
      setBusy(true);
      const loadingId = toast.loading("Splitting PDF into pages…");
      try {
        const imgs = await pdfToImageDataUrls(file, (done, total) => {
          toast.loading(`Rendering page ${done} / ${total}…`, { id: loadingId });
        });
        const next: UploadedPage[] = imgs.map((p) => ({
          id: crypto.randomUUID(),
          dataUrl: p.dataUrl,
          name: p.name,
        }));
        setPages([...pages, ...next]);
        toast.success(`${next.length} page${next.length === 1 ? "" : "s"} imported from PDF`, {
          id: loadingId,
        });
      } catch (e) {
        toast.error((e as Error).message || "Could not read PDF", { id: loadingId });
      } finally {
        setBusy(false);
      }
    },
    [pages, setPages],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) ingest(e.dataTransfer.files);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIdx = pages.findIndex((p) => p.id === active.id);
      const newIdx = pages.findIndex((p) => p.id === over.id);
      setPages(arrayMove(pages, oldIdx, newIdx));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span>Detected device</span>
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          {isMobile ? (
            <Smartphone className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Monitor className="h-3.5 w-3.5 text-primary" />
          )}
          {isMobile ? "Mobile" : "Laptop / PC"}
        </span>
      </div>

      {isMobile ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => openNativePicker(fileInputRef.current)}
            className={cn(
              "relative flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-accent/20 px-3 py-5 text-center active:bg-accent/40 transition-all overflow-hidden",
              busy ? "pointer-events-none opacity-60" : "cursor-pointer",
            )}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            ) : (
              <FolderOpen className="h-5 w-5 text-primary" />
            )}
            <span className="text-sm font-medium">Pick files</span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              Gallery or documents
            </span>
          </button>
          <button
            type="button"
            onClick={() => openNativePicker(cameraInputRef.current)}
            className={cn(
              "relative flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-primary/10 px-3 py-5 text-center active:bg-primary/20 transition-all overflow-hidden",
              busy ? "pointer-events-none opacity-60" : "cursor-pointer",
            )}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            ) : (
              <Camera className="h-5 w-5 text-primary" />
            )}
            <span className="text-sm font-medium">Take photo</span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              Auto-uploads after capture
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) ingest(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) ingest(e.target.files);
              e.target.value = "";
            }}
          />
          {/* PDF import — full width (2x button), half height of upload/camera */}
          <button
            type="button"
            onClick={() => openNativePicker(pdfInputRef.current)}
            className={cn(
              "col-span-2 relative flex min-h-14 flex-row items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 px-3 text-center active:bg-secondary/60 transition-all overflow-hidden",
              busy ? "pointer-events-none opacity-60" : "cursor-pointer",
            )}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            ) : (
              <FileText className="h-4 w-4 text-primary" />
            )}
            <span className="text-sm font-medium">Import PDF</span>
            <span className="text-[10px] text-muted-foreground">splits into pages</span>
          </button>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void ingestPdf(f);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all cursor-pointer overflow-hidden",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-accent-foreground/30 hover:bg-accent/30",
            )}
          >
            {busy ? (
              <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
            ) : (
              <Upload className="h-6 w-6 text-muted-foreground" />
            )}
            <div className="text-sm font-medium">Drop pages here, or click to upload</div>
            <div className="text-xs text-muted-foreground">
              PNG, JPG, JPEG, WEBP · multiple files supported
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onChange={(e) => {
                if (e.target.files?.length) ingest(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => openNativePicker(pdfInputRef.current)}
            className={cn(
              // Desktop dropzone above is ~112px tall (py-10) and full-width;
              // PDF button mirrors mobile: half-height (min-h-14 ≈ 56px) and full width
              "w-full min-h-14 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 px-4 text-sm font-medium hover:bg-secondary/60 transition-all",
              busy ? "pointer-events-none opacity-60" : "cursor-pointer",
            )}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            ) : (
              <FileText className="h-4 w-4 text-primary" />
            )}
            Import PDF
            <span className="text-[11px] font-normal text-muted-foreground">
              · splits into pages automatically
            </span>
          </button>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void ingestPdf(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {pages.length > 0 && (
        <div className="pt-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              {pages.length} page{pages.length === 1 ? "" : "s"} · drag to reorder
            </p>
            <button
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setPages([])}
            >
              Clear all
            </button>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {pages.map((p, i) => (
                  <Thumb
                    key={p.id}
                    p={p}
                    idx={i}
                    showControls={isMobile}
                    onView={() => setViewing(p)}
                    onRemove={() => setPages(pages.filter((x) => x.id !== p.id))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
      <ImageLightbox
        src={viewing?.dataUrl ?? null}
        alt={viewing?.name}
        caption={viewing?.name}
        onClose={() => setViewing(null)}
      />
    </div>

  );
}
