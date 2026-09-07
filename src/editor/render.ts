import "./ContentTextbox";
import "./Sharpen";
import { StaticCanvas } from "fabric";
import type { DocumentSnapshot, ObjectData } from "../types";
import type { Assets } from "./assets";
import { deepCopy } from "./model";
import { ensureObjectFonts } from "./fonts";
import { editorConfig } from "../config";

export function hydrate(objects: ObjectData[], assets: Assets) {
  return objects.map(item => {
    const object = deepCopy(item);
    if (object.editorAssetId) object.src = assets.get(object.editorAssetId).url;
    return object;
  });
}

export async function makeSurface(snapshot: DocumentSnapshot, assets: Assets, objects = snapshot.objects) {
  await ensureObjectFonts(objects);
  const surface = new StaticCanvas(undefined, { width: snapshot.size.width, height: snapshot.size.height, enableRetinaScaling: false, backgroundColor: "#ffffff" });
  try { await surface.loadFromJSON({ objects: hydrate(objects, assets) }); return surface; }
  catch (error) { await surface.dispose(); throw error; }
}

export async function renderDocument(snapshot: DocumentSnapshot, assets: Assets, mode: "base" | "final", format: "jpeg" | "png" = "jpeg") {
  const objects = snapshot.objects.filter(object => object.visible !== false && (mode === "final" || object.editorPurpose === "base"));
  const surface = await makeSurface(snapshot, assets, objects);
  try {
    surface.renderAll();
    const blob = await surface.toBlob({ format, quality: editorConfig.jpegQuality, multiplier: 1, enableRetinaScaling: false });
    if (!blob) throw new Error("图片导出失败");
    return blob;
  } finally { await surface.dispose(); }
}
