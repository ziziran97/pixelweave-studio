import { cache } from "fabric";
import type { ObjectData } from "../types";

export const FONT_FAMILY = "Alibaba Sans";
export const JP_FONT_FAMILY = "Alibaba Sans JP";
export const FONT_WEIGHTS = [
  { value: "300", label: "Light", file: "Light" },
  { value: "400", label: "Regular", file: "Regular" },
  { value: "500", label: "Medium", file: "Medium" },
  { value: "700", label: "Bold", file: "Bold" },
  { value: "800", label: "Heavy", file: "Heavy" },
  { value: "900", label: "Black", file: "Black" },
] as const;
export const JP_FONT_WEIGHTS = [
  { value: "400", label: "Regular", file: "Regular" },
  { value: "500", label: "Medium", file: "Medium" },
  { value: "700", label: "Bold", file: "Bold" },
] as const;
export const FONT_FAMILIES = [
  { family: FONT_FAMILY, label: FONT_FAMILY, directory: "alibaba-sans", prefix: "AlibabaSans", weights: FONT_WEIGHTS },
  { family: JP_FONT_FAMILY, label: "阿里巴巴普惠体日文", directory: "alibaba-sans-jp", prefix: "AlibabaSansJP", weights: JP_FONT_WEIGHTS },
] as const;
export const fontDefinition = (family: string) => FONT_FAMILIES.find(item => item.family === family);
export const supportsItalic = (family: string, weight: string | number) => family === FONT_FAMILY && fontWeight(weight, family) !== "900";

export function fontWeight(value: string | number, family: string = FONT_FAMILY) {
  const weight = value === "normal" ? "400" : value === "bold" ? "700" : String(value);
  return (fontDefinition(family)?.weights ?? FONT_WEIGHTS).some(item => item.value === weight) ? weight : "400";
}

// Editing, history and rendering share successful loads. Failures are evicted
// so a retry never reuses a rejected promise or a browser fallback font.
const fonts = new Map<string, Promise<void>>();
export async function ensureFont(family: string, weight: string | number = "400", style = "normal") {
  const definition = fontDefinition(family);
  if (!definition) {
    // Preserve existing session objects instead of renaming their font on undo.
    await document.fonts.load(`${style} ${weight} 32px "${family.replaceAll('"', '')}"`, "Your text Aa123");
    return;
  }
  const normalizedWeight = fontWeight(weight, family);
  if (style === "italic" && !supportsItalic(family, normalizedWeight)) throw new Error(family === JP_FONT_FAMILY ? "阿里巴巴普惠体日文暂无斜体" : "Alibaba Sans Black 暂无斜体，请选择其他字重");
  const key = `${family}:${normalizedWeight}:${style}`;
  let loading = fonts.get(key);
  if (!loading) {
    const variant = definition.weights.find(item => item.value === normalizedWeight)!;
    const file = style === "italic" ? variant.file === "Regular" ? "Italic" : `${variant.file}Italic` : variant.file;
    const face = new FontFace(family, `url("${import.meta.env.BASE_URL}fonts/${definition.directory}/${definition.prefix}-${file}.woff2")`,
      { weight: normalizedWeight, style });
    loading = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([face.load(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("字体加载超时")), 12000);
        })]);
        document.fonts.add(face);
        cache.clearFontCache(family);
      } catch {
        fonts.delete(key);
        throw new Error(`${definition.label} ${variant.label}${style === "italic" ? " Italic" : ""} 加载失败，请重试`);
      } finally { clearTimeout(timer); }
    })();
    fonts.set(key, loading);
  }
  await loading;
}

export async function ensureObjectFonts(objects: ObjectData[]) {
  const keys = new Map<string, [string, string, string]>();
  const walk = (items: ObjectData[]) => items.forEach(item => {
    if (typeof item.fontFamily === "string") {
      const font: [string, string, string] = [item.fontFamily, String(item.fontWeight ?? "normal"), String(item.fontStyle ?? "normal")];
      keys.set(font.join(":"), font);
    }
    if (item.objects) walk(item.objects);
  });
  walk(objects);
  await Promise.all([...keys.values()].map(([family, weight, style]) => ensureFont(family, weight, style)));
}
