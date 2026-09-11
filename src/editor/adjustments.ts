import { FabricImage, filters } from "fabric";
import { Sharpen } from "./Sharpen";
import { ensureImageFiltering } from "./imageFiltering";
import { DEFAULT_ADJUSTMENTS } from "../types";
import type { ImageAdjustments, ImageFilter } from "../types";

type Matrix = typeof filters.ColorMatrix.defaults.matrix;
const IDENTITY: Matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
function tone(contrast: number, brightness: number, saturation = 1, warmth = 0): Matrix {
  const matrix = [...IDENTITY] as Matrix;
  const luminance = [.2126, .7152, .0722];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) matrix[row * 5 + col] = contrast * ((row === col ? saturation : 0) + (1 - saturation) * luminance[col]);
    matrix[row * 5 + 4] = (1 - contrast) / 2 + brightness + (row === 0 ? warmth : row === 2 ? -warmth : 0);
  }
  return matrix;
}
export const IMAGE_FILTERS: ReadonlyArray<{ id: ImageFilter; label: string; matrix: Matrix }> = [
  { id: "none", label: "无滤镜", matrix: IDENTITY },
  { id: "clear", label: "清透", matrix: tone(1.08, .018, 1.04) },
  { id: "bright", label: "明亮", matrix: tone(.96, .065, 1.02) },
  { id: "soft", label: "柔和", matrix: tone(.86, .025, .88) },
  { id: "vivid", label: "鲜明", matrix: tone(1.10, 0, 1.22) },
  { id: "warm", label: "暖阳", matrix: tone(1.02, .025, 1.04, .035) },
  { id: "cool", label: "清冷", matrix: tone(1.04, .01, .94, -.035) },
  { id: "mono", label: "黑白", matrix: tone(1, 0, 0) },
  { id: "sepia", label: "复古", matrix: [...filters.Sepia.defaults.matrix] as Matrix },
];
const limit = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0)));
export function normalizeAdjustments(values: ImageAdjustments): ImageAdjustments {
  return {
    brightness: limit(values.brightness, -100, 100), contrast: limit(values.contrast, -100, 100), saturation: limit(values.saturation, -100, 100),
    temperature: limit(values.temperature, -100, 100), sharpen: limit(values.sharpen, 0, 100),
    overlayColor: /^#[\da-f]{6}$/i.test(values.overlayColor) ? values.overlayColor.toLowerCase() : DEFAULT_ADJUSTMENTS.overlayColor,
    overlayStrength: limit(values.overlayStrength, 0, 100),
    filter: IMAGE_FILTERS.some(item => item.id === values.filter) ? values.filter : "none", filterStrength: limit(values.filterStrength, 0, 100),
  };
}
/** Always rebuild from the source image. Native filters serialize for undo, erasure and final export. */
export function adjustmentFilters(input: ImageAdjustments): FabricImage["filters"] {
  const values = normalizeAdjustments(input), items: FabricImage["filters"] = [];
  if (values.brightness) items.push(new filters.Brightness({ brightness: values.brightness / 100 }));
  if (values.contrast) items.push(new filters.Contrast({ contrast: values.contrast / 100 }));
  if (values.saturation) items.push(new filters.Saturation({ saturation: values.saturation / 100 }));
  if (values.temperature) items.push(new filters.ColorMatrix({ matrix: tone(1, 0, 1, values.temperature * .0008) }));
  if (values.sharpen) {
    const amount = values.sharpen / 400;
    items.push(new Sharpen({ matrix: [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0] }));
  }
  if (values.overlayStrength) items.push(new filters.BlendColor({ color: values.overlayColor, mode: "tint", alpha: values.overlayStrength / 100 }));
  if (values.filter !== "none" && values.filterStrength) {
    const preset = IMAGE_FILTERS.find(item => item.id === values.filter)!, amount = values.filterStrength / 100;
    items.push(new filters.ColorMatrix({ matrix: preset.matrix.map((value, i) => IDENTITY[i] + (value - IDENTITY[i]) * amount) as Matrix }));
  }
  if (items.length) ensureImageFiltering();
  return items;
}

/** Small previews only; caller cancels stale work when the working image or panel changes. */
export async function filterThumbnails(url: string, values: ImageAdjustments, signal: AbortSignal) {
  const source = new Image(); source.src = url; await source.decode();
  if (signal.aborted) return undefined;
  const canvas = document.createElement("canvas"), scale = Math.min(1, 144 / Math.max(source.naturalWidth, source.naturalHeight));
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = new FabricImage(canvas), previews: Partial<Record<ImageFilter, string>> = {};
  try {
    for (const preset of IMAGE_FILTERS) {
      if (signal.aborted) return undefined;
      image.filters = adjustmentFilters({ ...values, filter: preset.id, filterStrength: 100 });
      image.applyFilters(); previews[preset.id] = image.toDataURL({ format: "png", enableRetinaScaling: false });
    }
    return previews;
  } finally { image.dispose(); }
}
