import type { DocumentSize, ImageRegion, MaskStroke } from "../types";

export function paintStroke(ctx: CanvasRenderingContext2D, stroke: MaskStroke) {
  const points = stroke.points;
  if (!points.length) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.operation === "subtract" ? "destination-out" : "source-over";
  ctx.fillStyle = "white"; ctx.strokeStyle = "white"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width; ctx.beginPath();
  if (stroke.kind === "rect") {
    const end = points[points.length - 1];
    ctx.rect(Math.min(points[0].x, end.x), Math.min(points[0].y, end.y),
      Math.abs(end.x - points[0].x), Math.abs(end.y - points[0].y)); ctx.fill();
  } else if (stroke.kind === "brush") {
    // Leaving the image pauses a stroke. Its subpaths remain one undoable action.
    const starts = [0, ...(stroke.breaks ?? []), points.length];
    for (let i = 0; i < starts.length - 1; i++) {
      const start = starts[i], end = starts[i + 1];
      if (end <= start) continue;
      ctx.beginPath();
      if (end === start + 1) { ctx.arc(points[start].x, points[start].y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.moveTo(points[start].x, points[start].y); for (let j = start + 1; j < end; j++) ctx.lineTo(points[j].x, points[j].y); ctx.stroke(); }
    }
  } else {
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Use the same coverage threshold as export. Read in tiles and stop once enough
// selected pixels are found, so a large image does not require a second full RGBA buffer.
function hasCoverage(ctx: CanvasRenderingContext2D, width: number, height: number, minimum = 1) {
  let count = 0;
  for (let y = 0; y < height; y += 256) for (let x = 0; x < width; x += 256) {
    const data = ctx.getImageData(x, y, Math.min(256, width - x), Math.min(256, height - y)).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 128 && ++count >= minimum) return true;
  }
  return false;
}

export function hasMaskCoverage(strokes: MaskStroke[], size: DocumentSize) {
  if (!strokes.some(stroke => stroke.operation === "add")) return false;
  // Subtraction cannot add coverage outside the additions. Keep original-pixel
  // rasterization while avoiding a full-image canvas for a small selected region.
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const stroke of strokes) if (stroke.operation === "add") {
    const padding = stroke.kind === "brush" ? stroke.width / 2 + 1 : 1;
    for (const point of stroke.points) {
      left = Math.min(left, point.x - padding); top = Math.min(top, point.y - padding);
      right = Math.max(right, point.x + padding); bottom = Math.max(bottom, point.y + padding);
    }
  }
  left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top));
  right = Math.min(size.width, Math.ceil(right)); bottom = Math.min(size.height, Math.ceil(bottom));
  if (right <= left || bottom <= top) return false;
  const canvas = document.createElement("canvas"); canvas.width = right - left; canvas.height = bottom - top;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  try {
    ctx.translate(-left, -top);
    strokes.forEach(stroke => paintStroke(ctx, stroke));
    return hasCoverage(ctx, canvas.width, canvas.height);
  } finally { canvas.width = canvas.height = 0; }
}

// Check only the subtraction's bounding region. Compare alpha, not just binary
// pixels: a small edge change can affect a later stroke and must remain undoable.
export function subtractionChangesMask(strokes: MaskStroke[], stroke: MaskStroke, size: DocumentSize) {
  if (!stroke.points.length) return false;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of stroke.points) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  const padding = stroke.kind === "brush" ? stroke.width / 2 + 1 : 1;
  left = Math.max(0, Math.floor(left - padding)); top = Math.max(0, Math.floor(top - padding));
  const width = Math.min(size.width, Math.ceil(right + padding)) - left, height = Math.min(size.height, Math.ceil(bottom + padding)) - top;
  if (width <= 0 || height <= 0) return false;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  try {
    ctx.translate(-left, -top); strokes.forEach(item => paintStroke(ctx, item));
    const before = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 128) {
      const data = ctx.getImageData(0, y, width, Math.min(128, height - y)).data;
      for (let i = 3, j = y * width; i < data.length; i += 4, j++) before[j] = data[i];
    }
    paintStroke(ctx, stroke);
    for (let y = 0; y < height; y += 128) {
      const data = ctx.getImageData(0, y, width, Math.min(128, height - y)).data;
      for (let i = 3, j = y * width; i < data.length; i += 4, j++) if (before[j] !== data[i]) return true;
    }
    return false;
  } finally { canvas.width = canvas.height = 0; }
}

// Signed polygon area cancels out in figure-eight paths. Measure their actual
// filled coverage instead, using the same nonzero fill rule as the final Mask.
export function polygonHasArea(stroke: MaskStroke, zoom: number, size?: DocumentSize) {
  if (stroke.points.length < 3) return false;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of stroke.points) {
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
  }
  // Outside vertices must not count as selected image pixels or enlarge the
  // temporary bitmap when the pointer travels far beyond the image.
  if (size) {
    left = Math.max(0, left); top = Math.max(0, top);
    right = Math.min(size.width, right); bottom = Math.min(size.height, bottom);
  }
  if (right <= left || bottom <= top) return false;
  const scale = Math.min(1, zoom), minimum = Math.max(1, Math.ceil(25 * scale * scale / (zoom * zoom)));
  const width = Math.ceil((right - left) * scale), height = Math.ceil((bottom - top) * scale);
  if (!width || !height || width * height < minimum) return false;
  const canvas = document.createElement("canvas"); canvas.width = width + 2; canvas.height = height + 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  try {
    ctx.setTransform(scale, 0, 0, scale, 1 - left * scale, 1 - top * scale);
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    paintStroke(ctx, { ...stroke, operation: "add" });
    return hasCoverage(ctx, canvas.width, canvas.height, minimum);
  } finally { canvas.width = canvas.height = 0; }
}
export async function exportMask(strokes: MaskStroke[], size: DocumentSize, signal?: AbortSignal, onBounds?: (bounds: ImageRegion) => void) {
  signal?.throwIfAborted();
  const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  try {
    strokes.forEach(stroke => paintStroke(ctx, stroke));
    const pixels = ctx.getImageData(0, 0, size.width, size.height);
    // Release the canvas before encoding; all pixel loops and compression run off the UI thread.
    canvas.width = canvas.height = 0;
    const worker = new Worker(new URL("./maskEncoder.worker.ts", import.meta.url), { type: "module" });
    let abort: (() => void) | undefined;
    try {
      const result = await new Promise<{ blob: Blob; bounds?: ImageRegion }>((resolve, reject) => {
        abort = () => {
          worker.terminate();
          reject(signal?.reason ?? new DOMException("蒙版编码已取消", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob; bounds?: ImageRegion; error?: string }>) => {
          if (data.blob instanceof Blob) resolve({ blob: data.blob, bounds: data.bounds });
          else reject(new Error(data.error || "蒙版编码失败，请重试"));
        };
        worker.onerror = event => { event.preventDefault(); reject(new Error("蒙版编码失败，请重试")); };
        worker.onmessageerror = () => reject(new Error("蒙版编码结果读取失败，请重试"));
        worker.postMessage({ pixels: pixels.data.buffer, ...size }, [pixels.data.buffer]);
      });
      signal?.throwIfAborted();
      if (result.bounds) onBounds?.(result.bounds);
      return result.blob;
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
  } finally { canvas.width = canvas.height = 0; }
}
