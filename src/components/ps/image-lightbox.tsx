import { useEffect } from "react";
import { X } from "lucide-react";

export function ImageLightbox({
  src,
  alt,
  caption,
  onClose,
}: {
  src: string | null;
  alt?: string;
  caption?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src) return null;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <figure
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[92vh] flex flex-col items-center gap-2"
      >
        <img
          src={src}
          alt={alt || ""}
          className="max-w-[95vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />
        {caption && (
          <figcaption className="text-white/80 text-sm text-center max-w-2xl px-4">
            {caption}
          </figcaption>
        )}
      </figure>
    </div>
  );
}
