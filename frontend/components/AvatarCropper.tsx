"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type AvatarCropperProps = {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void> | void;
};

const PREVIEW_SIZE = 320;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function AvatarCropper({ file, onCancel, onConfirm }: AvatarCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let source: ImageBitmap | null = null;
    createImageBitmap(file)
      .then((image) => {
        if (disposed) {
          image.close();
          return;
        }
        source = image;
        bitmapRef.current = image;
        setBitmap(image);
      })
      .catch(() => setError("That image could not be opened."));
    return () => {
      disposed = true;
      source?.close();
      bitmapRef.current = null;
    };
  }, [file]);

  const metrics = useCallback(() => {
    if (!bitmap) return null;
    const scale = Math.max(PREVIEW_SIZE / bitmap.width, PREVIEW_SIZE / bitmap.height) * zoom;
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    return {
      scale,
      width,
      height,
      maxX: Math.max(0, (width - PREVIEW_SIZE) / 2),
      maxY: Math.max(0, (height - PREVIEW_SIZE) / 2),
      dx: (PREVIEW_SIZE - width) / 2 + offset.x,
      dy: (PREVIEW_SIZE - height) / 2 + offset.y,
    };
  }, [bitmap, zoom, offset]);

  useEffect(() => {
    const current = metrics();
    if (!current) return;
    setOffset((value) => {
      const x = clamp(value.x, -current.maxX, current.maxX);
      const y = clamp(value.y, -current.maxY, current.maxY);
      return x === value.x && y === value.y ? value : { x, y };
    });
  }, [metrics]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const current = metrics();
    const context = canvas?.getContext("2d");
    if (!canvas || !bitmap || !current || !context) return;
    context.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    context.fillStyle = "#040507";
    context.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    context.drawImage(bitmap, current.dx, current.dy, current.width, current.height);
    context.strokeStyle = "rgba(244, 197, 66, 0.85)";
    context.lineWidth = 2;
    context.strokeRect(1, 1, PREVIEW_SIZE - 2, PREVIEW_SIZE - 2);
  }, [bitmap, metrics]);

  const startDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!bitmap) return;
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !bitmap) return;
    setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y });
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const applyCrop = async () => {
    const current = metrics();
    if (!bitmap || !current) return;
    setBusy(true);
    setError(null);
    try {
      const sourceSide = PREVIEW_SIZE / current.scale;
      const sourceX = clamp(-current.dx / current.scale, 0, bitmap.width - sourceSide);
      const sourceY = clamp(-current.dy / current.scale, 0, bitmap.height - sourceSide);
      const size = Math.max(1, Math.round(sourceSide));
      const output = document.createElement("canvas");
      output.width = size;
      output.height = size;
      const context = output.getContext("2d");
      if (!context) throw new Error("This browser cannot export the crop.");
      context.drawImage(bitmap, sourceX, sourceY, sourceSide, sourceSide, 0, 0, size, size);
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("This browser could not export the crop.");
      await onConfirm(new File([blob], "avatar.png", { type: "image/png" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply the crop.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/85 p-4" role="dialog" aria-modal="true" aria-label="Crop profile image">
      <div className="broadcast-panel panel-cut w-full max-w-lg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mono text-[9px] uppercase tracking-[0.24em] text-gold">Profile image</p>
            <h2 className="mt-2 font-display text-2xl uppercase tracking-[0.08em] text-bone">
              Frame your PFP
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-dim">
              Drag to reposition and zoom to frame the square crop.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="border border-bone/20 px-3 py-1 text-lg leading-none text-dim transition hover:border-gold/60 hover:text-gold"
            aria-label="Close crop editor"
          >
            ×
          </button>
        </div>

        {error && (
          <p className="mt-4 border border-red/35 bg-red/[0.06] p-3 text-xs text-red">{error}</p>
        )}

        <div className="mt-5 flex justify-center">
          <canvas
            ref={canvasRef}
            width={PREVIEW_SIZE}
            height={PREVIEW_SIZE}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="block max-w-full cursor-grab touch-none border border-gold/40 bg-void active:cursor-grabbing"
            style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
          />
        </div>

        <label className="mt-5 block">
          <span className="mono text-[9px] uppercase tracking-[0.2em] text-ash">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            disabled={!bitmap || busy}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="mt-2 w-full accent-gold"
          />
        </label>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border border-bone/20 px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-dim transition hover:border-bone/40 hover:text-bone"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!bitmap || busy}
            onClick={() => void applyCrop()}
            className="border border-gold bg-gold px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-void transition hover:border-bone hover:bg-bone disabled:opacity-40"
          >
            {busy ? "Applying…" : "Use this crop"}
          </button>
        </div>
      </div>
    </div>
  );
}
