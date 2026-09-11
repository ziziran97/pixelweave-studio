import { Canvas2dFilterBackend, getFilterBackend, WebGLFilterBackend } from "fabric";
import type { FabricImage } from "fabric";

const protectedBackends = new WeakSet<WebGLFilterBackend>();
const pointFilters = new Set(["Brightness", "Contrast", "Saturation", "ColorMatrix", "BlendColor", "Sepia"]);

/** Local filters need a halo; unknown/resizing filters use Fabric's full-size CPU path. */
function filterPadding(filters: FabricImage["filters"]) {
  let padding = 0;
  for (const filter of filters) {
    if (filter.type === "PixelweaveSharpen") padding++;
    else if (!pointFilters.has(filter.type)) return undefined;
  }
  return padding;
}

/** Keep the backend instance and its texture disposal contract, including after history hydration. */
export function ensureImageFiltering() {
  const backend = getFilterBackend();
  if (!(backend instanceof WebGLFilterBackend) || protectedBackends.has(backend)) return;
  protectedBackends.add(backend);
  const apply = backend.applyFilters.bind(backend), cpu = new Canvas2dFilterBackend();
  backend.applyFilters = (filters, source, width, height, target, cacheKey) => {
    const limit = Math.min(backend.tileSize, backend.gl?.drawingBufferWidth ?? 0, backend.gl?.drawingBufferHeight ?? 0);
    if (backend.gl && !backend.gl.isContextLost() && width <= limit && height <= limit) {
      return apply(filters, source, width, height, target, cacheKey);
    }
    const padding = filterPadding(filters), step = limit - 2 * (padding ?? 0);
    if (!backend.gl || backend.gl.isContextLost() || padding === undefined || step < 1) {
      cpu.applyFilters(filters, source as CanvasImageSource, width, height, target);
      return;
    }
    // Source and destination tiles stay within the actual GL drawing buffer. A halo
    // preserves sharpen pixels across joins; only the tile's interior is copied out.
    const input = document.createElement("canvas"), output = document.createElement("canvas");
    const inputContext = input.getContext("2d")!, targetContext = target.getContext("2d")!;
    targetContext.setTransform(1, 0, 0, 1, 0, 0);
    targetContext.clearRect(0, 0, width, height);
    try {
      for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
        const tileWidth = Math.min(step, width - x), tileHeight = Math.min(step, height - y);
        const left = Math.max(0, x - padding), top = Math.max(0, y - padding);
        const right = Math.min(width, x + tileWidth + padding), bottom = Math.min(height, y + tileHeight + padding);
        input.width = output.width = right - left; input.height = output.height = bottom - top;
        inputContext.drawImage(source as CanvasImageSource, left, top, input.width, input.height, 0, 0, input.width, input.height);
        const state = apply(filters, input, input.width, input.height, output);
        if (!state || backend.gl.isContextLost()) throw new Error("图片调色失败，请重试");
        // Fabric leaves the uncached original texture to its caller.
        backend.gl.deleteTexture(state.originalTexture);
        targetContext.drawImage(output, x - left, y - top, tileWidth, tileHeight, x, y, tileWidth, tileHeight);
      }
    } finally { input.width = input.height = output.width = output.height = 0; }
    return undefined;
  };
}
