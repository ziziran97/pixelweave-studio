import { uid } from "./model";
import { editorConfig } from "../config";

export type ImageAsset = { id: string; blob: Blob; url: string; width: number; height: number; cost: number };
export class Assets {
  private items = new Map<string, ImageAsset>();
  private disposed = false;
  async add(blob: Blob): Promise<ImageAsset> {
    if (this.disposed) throw new DOMException("编辑会话已关闭", "AbortError");
    if (!blob.type.startsWith("image/")) throw new Error("返回内容不是图片");
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();
    if (this.disposed) throw new DOMException("编辑会话已关闭", "AbortError");
    if (!width || !height) throw new Error("图片尺寸无效，请重新选择");
    const asset = { id: uid("asset"), blob, url: URL.createObjectURL(blob), width, height, cost: blob.size + width * height * 4 };
    this.items.set(asset.id, asset);
    return asset;
  }
  get(id: string) { const asset = this.items.get(id); if (!asset) throw new Error("图片资源已失效，请重新打开图片"); return asset; }
  cost(id: string) { return this.items.get(id)?.cost ?? 0; }
  collect(keep: Set<string>) { for (const [id, asset] of this.items) if (!keep.has(id)) { URL.revokeObjectURL(asset.url); this.items.delete(id); } }
  dispose() { this.disposed = true; this.collect(new Set()); }
}
export function toBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片导出失败")), type, quality));
}
export async function defaultImage(preview = false) {
  if ((import.meta.env.DEV || import.meta.env.MODE === "demo") && preview) {
    // Reuse only the BEFORE image; the comparison module remains on demand.
    const { default: url } = await import("../../docs/demo/eraser/before-2910x1800.png");
    const response = await fetch(url);
    if (!response.ok) throw new Error("默认图片无法加载");
    return response.blob();
  }
  const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 800;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 1280, 800);
  gradient.addColorStop(0, "#edf6ff"); gradient.addColorStop(1, "#dcecff");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1280, 800);
  ctx.fillStyle = "#2e76b8"; ctx.font = "700 52px Arial"; ctx.textAlign = "center";
  ctx.fillText("PixelWeave Studio", 640, 365);
  ctx.font = "24px Microsoft YaHei, sans-serif"; ctx.fillStyle = "#71879b";
  ctx.fillText("本地预览 · 上传 JPG / PNG 或使用示例图片编辑", 640, 425);
  return toBlob(canvas);
}

export async function validateJpeg(blob: Blob, name?: string) {
  const formatMessage = "仅支持 JPG/JPEG 图片，请另存为 JPG 后上传";
  if (name !== undefined && !/\.jpe?g$/i.test(name)) throw new Error(formatMessage);
  const header = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) throw new Error(formatMessage);
  // Ignore an unreliable MIME label only after checking the JPEG signature.
  const jpeg = new Blob([blob], { type: "image/jpeg" });
  try {
    const bitmap = await createImageBitmap(jpeg);
    const size = { width: bitmap.width, height: bitmap.height }; bitmap.close();
    if (!size.width || !size.height) throw new Error();
    return { jpeg, ...size };
  } catch { throw new Error("图片无法正常读取，请检查文件是否损坏"); }
}

/** Identify the encoded data, not the file extension or browser MIME label. */
export async function prepareUploadedImage(file: Blob) {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { ...await validateJpeg(file), converted: false };
  }
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)) {
    throw new Error("暂不支持此图片格式，请选择 JPG 或 PNG 图片");
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([file], { type: "image/png" })); }
  catch { throw new Error("图片无法正常读取，请检查文件是否损坏"); }
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) throw new Error();
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const checked = await validateJpeg(await toBlob(canvas, "image/jpeg", editorConfig.jpegQuality));
    if (checked.width !== bitmap.width || checked.height !== bitmap.height) throw new Error();
    return { ...checked, converted: true };
  } catch { throw new Error("图片转换失败，请重新选择图片后重试"); }
  finally { bitmap.close(); canvas.width = canvas.height = 0; }
}
