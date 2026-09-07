import type { ObjectData } from "../types";

export const FONT_OPTIONS = ["Arial", "Microsoft YaHei", "SimSun", "Georgia", "Verdana"];
export async function ensureFont(family: string, weight: string | number = "normal") {
  await document.fonts.load(`${weight} 32px "${family.replaceAll('"', '')}"`, "商品营销文字 Aa123");
}
export async function ensureObjectFonts(objects: ObjectData[]) {
  const keys = new Map<string, [string, string]>();
  const walk = (items: ObjectData[]) => items.forEach(item => {
    if (typeof item.fontFamily === "string") keys.set(`${item.fontFamily}:${item.fontWeight}`, [item.fontFamily, String(item.fontWeight ?? "normal")]);
    if (item.objects) walk(item.objects);
  });
  walk(objects);
  await Promise.all([...keys.values()].map(([family, weight]) => ensureFont(family, weight)));
}
export async function importFont(file: File) {
  if (!/\.(woff2?|ttf|otf)$/i.test(file.name) || file.size > 10 * 1024 * 1024) throw new Error("请选择 10 MB 以内的 WOFF、WOFF2、TTF 或 OTF 字体");
  const family = `自定义-${file.name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]/gu, "")}-${Date.now().toString(36)}`;
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load(); document.fonts.add(face);
  return { family, face };
}
