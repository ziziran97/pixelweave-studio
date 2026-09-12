import { Canvas2dFilterBackend, FabricImage, getFilterBackend, setFilterBackend, WebGLFilterBackend } from "fabric";
import { adjustmentFilters, filterThumbnails, IMAGE_FILTERS } from "../src/editor/adjustments";
import { DEFAULT_ADJUSTMENTS } from "../src/types";
import type { DocumentSnapshot, ImageAdjustments } from "../src/types";
import type { Assets } from "../src/editor/assets";
import { renderDocument } from "../src/editor/render";
import { editorConfig } from "../src/config";
import { createEditor, frame, picture, settle } from "./editing-tools";

const sample = async (blob: Blob, x = 32, y = 32) => {
  const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
  return [...ctx.getImageData(x, y, 1, 1).data];
};
const close = (a: number[], b: number[], tolerance = 2) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

async function checkSnapshotResources(check: (condition: boolean, message: string) => void) {
  const backend = getFilterBackend();
  check(backend instanceof WebGLFilterBackend, "历史资源回归实际启用图形加速");
  const gpu = backend as WebGLFilterBackend, count = () => Object.keys(gpu.textureCache).length;
  const initialCount = count(), source = await picture("#6080a0", 256, 192);
  const current = createEditor(), other = createEditor();
  const { editor, state, overlay, confirm } = current;
  const probe = editor as unknown as { snapshot(): DocumentSnapshot; assets: Assets };
  const exported = () => renderDocument(probe.snapshot(), probe.assets, "final", "png");
  const comparePixel = async () => {
    editor.setCompare(true); await frame();
    const v = editor.canvas.viewportTransform;
    const pixel = [...overlay.getContext("2d")!.getImageData(Math.round(100 * v[0] + v[4]), Math.round(100 * v[3] + v[5]), 1, 1).data];
    editor.setCompare(false); return pixel;
  };
  try {
    await other.editor.openImage(source, "另一编辑器", false);
    other.editor.setAdjustments({ ...DEFAULT_ADJUSTMENTS, brightness: 10 }, true);
    const otherImage = other.editor.canvas.getObjects()[0] as FabricImage;
    const otherTexture = gpu.textureCache[otherImage.cacheKey];
    await editor.openImage(source, "历史资源测试", false);
    editor.setAdjustments({ ...DEFAULT_ADJUSTMENTS, brightness: 20 }, true);
    const adjustedPixel = await sample(await exported());
    check(count() === initialCount + 2, "两个编辑器各持有一份底图纹理，导出临时纹理已释放");
    const counts: number[] = [];
    for (let i = 0; i < 6; i++) {
      await editor.undo(); counts.push(count());
      await editor.undo(true); counts.push(count());
    }
    check(counts.every((value, i) => value === initialCount + (i % 2 ? 2 : 1)),
      `连续六次撤销重做仅保留当前底图纹理（相对初始缓存：${counts.map(value => value - initialCount).join(",")}）`);
    check(close(await sample(await exported()), adjustedPixel) && close(await comparePixel(), [96, 128, 160, 255]),
      "释放旧底图后重做成图正确，原图对比仍显示初始图片");
    check(gpu.textureCache[otherImage.cacheKey] === otherTexture && gpu.gl.isTexture(otherTexture), "历史恢复不清空另一编辑器仍在使用的纹理");
    const beforeFailure = editor.canvas.getObjects()[0];
    await confirm(() => editor.uploadReplacement(new File(["invalid"], "invalid.jpg", { type: "image/jpeg" })));
    check(editor.canvas.getObjects()[0] === beforeFailure && count() === initialCount + 2 && close(await sample(await exported()), adjustedPixel),
      "上传校验失败保留当前底图、纹理及可导出的草稿");
    await confirm(() => editor.resetOriginal());
    check(count() === initialCount + 1 && close(await sample(await exported()), [96, 128, 160, 255]), "还原初始释放已调色底图纹理，原始成图正确");
    await editor.undo();
    check(count() === initialCount + 2 && state().adjustments.brightness === 20, "撤销还原重新生成当前纹理并恢复调色");
    const upload = new File([await picture("#ffffff", 128, 96)], "replacement.jpg", { type: "image/jpeg" });
    await confirm(() => editor.uploadReplacement(upload));
    check(count() === initialCount + 1 && state().size.width === 128 && close(await sample(await exported()), [255, 255, 255, 255]) && close(await comparePixel(), [96, 128, 160, 255]),
      "上传成功释放旧纹理，保留新图原尺寸成图及初始原图对比");
    editor.setAdjustments({ ...DEFAULT_ADJUSTMENTS, brightness: -20 }, true);
  } finally { current.dispose(); other.dispose(); await frame(); await frame(); }
  check(count() === initialCount, "关闭两个编辑器后纹理缓存恢复初始数量");
}

export async function checkAdjustments(check: (condition: boolean, message: string) => void) {
  await checkSnapshotResources(check);
  const backend = getFilterBackend(), source = document.createElement("canvas"); source.width = 24; source.height = 24;
  const ctx = source.getContext("2d")!;
  ctx.fillStyle = "#6080a0"; ctx.fillRect(0, 0, 24, 24); ctx.fillStyle = "#8090a0"; ctx.fillRect(12, 0, 12, 24);
  const render = async (values: ImageAdjustments) => {
    const image = new FabricImage(source); image.filters = adjustmentFilters(values); image.applyFilters();
    const rendered = image.toCanvasElement({ enableRetinaScaling: false }).getContext("2d")!.getImageData(0, 0, 24, 24).data;
    // Fabric disposal can clean up the source canvas, so each test uses its own copy below.
    return { image, data: [...rendered], at: (x: number, y: number) => [...rendered.slice((y * 24 + x) * 4, (y * 24 + x) * 4 + 4)] };
  };
  const images: FabricImage[] = [];
  const capture = async (values: ImageAdjustments) => { const result = await render(values); images.push(result.image); return result; };
  try {
    const outputs: number[][] = [];
    for (const selected of [backend, new Canvas2dFilterBackend()]) {
      setFilterBackend(selected);
      const original = await capture(DEFAULT_ADJUSTMENTS);
      const off = await capture({ ...DEFAULT_ADJUSTMENTS, filter: "sepia", filterStrength: 0, overlayStrength: 0, overlayColor: "#000000" });
      check(off.data.join() === original.data.join(), "滤镜与叠加强度为 0 时逐像素还原，不因颜色选择改变底图");
      const overlay = await capture({ ...DEFAULT_ADJUSTMENTS, overlayStrength: 50, overlayColor: "#000000" });
      check(close(overlay.at(4, 4), [48, 64, 80, 255]), "颜色叠加使用实际混合强度，黑色 50% 正确减半 RGB");
      const warm = await capture({ ...DEFAULT_ADJUSTMENTS, temperature: 50 });
      const cool = await capture({ ...DEFAULT_ADJUSTMENTS, temperature: -50 });
      check(warm.at(4, 4)[0] > original.at(4, 4)[0] && warm.at(4, 4)[2] < original.at(4, 4)[2] && cool.at(4, 4)[0] < original.at(4, 4)[0], "色温正值偏暖、负值偏冷，默认不改色");
      const sharp = await capture({ ...DEFAULT_ADJUSTMENTS, sharpen: 100 });
      check(close(sharp.at(0, 0), original.at(0, 0)) && close(sharp.at(23, 23), original.at(23, 23)), "锐化保持平坦区域及四周边缘，不添加额外亮边");
      check(sharp.at(11, 12)[0] < original.at(11, 12)[0] && sharp.at(12, 12)[0] > original.at(12, 12)[0], "锐化温和增强实际边缘细节");
      for (const preset of IMAGE_FILTERS.slice(1)) {
        const full = await capture({ ...DEFAULT_ADJUSTMENTS, filter: preset.id });
        const half = await capture({ ...DEFAULT_ADJUSTMENTS, filter: preset.id, filterStrength: 50 });
        check(full.data.join() !== original.data.join() && close(half.at(4, 4), full.at(4, 4).map((value, i) => (value + original.at(4, 4)[i]) / 2)), `${preset.label}有可见效果，强度 50% 正确插值`);
      }
      const combined = await capture({ ...DEFAULT_ADJUSTMENTS, brightness: 8, contrast: 12, saturation: -10, temperature: 22, sharpen: 65, overlayColor: "#92764a", overlayStrength: 18, filter: "soft", filterStrength: 65 });
      outputs.push(combined.data);
    }
    check(outputs[0].every((value, i) => Math.abs(value - outputs[1][i]) <= 3), "默认渲染与 CPU 回退的组合调色像素一致（允许舍入差异）");
  } finally { setFilterBackend(backend); images.forEach(image => image.dispose()); }

  const { editor, state, drag, click, confirm, dispose } = createEditor();
  const privateEditor = editor as unknown as { snapshot(): DocumentSnapshot; assets: Assets; revision: number };
  const exported = () => renderDocument(privateEditor.snapshot(), privateEditor.assets, "base", "png");
  const previousFetch = window.fetch, previousUrl = editorConfig.eraseApiUrl;
  try {
    await editor.openImage(await picture("#6080a0", 256, 192, "image/png"), "调色像素测试", false);
    editor.setTool("rect"); editor.setColor("#00ff00"); drag(20, 20, 70, 70);
    const shapeId = state().layers.find(layer => layer.purpose === "content")!.id;
    editor.setTool("adjust");
    const start = privateEditor.revision;
    for (const temperature of [10, 20, 40]) editor.setAdjustments({ ...state().adjustments, temperature });
    editor.finishPropertyEdit();
    check(privateEditor.revision === start + 1 && state().adjustments.temperature === 40, "连续调色实时预览且只写一步历史");
    await editor.undo(); check(state().adjustments.temperature === 0, "撤销整次调节恢复起始值");
    await editor.undo(true); check(state().adjustments.temperature === 40, "重做恢复调色参数与已序列化效果");
    editor.setAdjustments({ ...state().adjustments, overlayStrength: 30, sharpen: 60, filter: "vivid", filterStrength: 60 }, true);
    const full = state().adjustments, before = await sample(await exported());
    const edit = editor.beginColorEdit("overlay")!; edit.preview("#223344");
    check(!close(await sample(await exported()), before), "叠加颜色草稿实时影响底图"); edit.finish(false);
    check(close(await sample(await exported()), before) && JSON.stringify(state().adjustments) === JSON.stringify(full), "取消颜色草稿完整恢复，不改其他调节");
    const colorStart = privateEditor.revision;
    editor.setFieldColor("overlay", "#887744");
    check(privateEditor.revision === colorStart + 1, "未选对象时确认底图叠加颜色也记一步历史");
    await editor.undo(); check(state().adjustments.overlayColor === full.overlayColor, "颜色确认可单独撤销");
    editor.setAdjustments({ ...state().adjustments, filter: "mono" }, true);
    check(state().adjustments.temperature === 40 && state().adjustments.overlayStrength === 30, "切换滤镜保留手动参数及颜色叠加");
    const mono = await sample(await exported()); check(Math.abs(mono[0] - mono[1]) > 0, "黑白部分强度保留部分原色");
    const basePixel = await sample(await exported());
    const finalPixel = await sample(await renderDocument(privateEditor.snapshot(), privateEditor.assets, "final", "png"));
    check(close(finalPixel, [0, 255, 0, 255]) && !close(basePixel, finalPixel), "调色只作用底图，新增图形保持原色并独立进入最终成图");
    const stable = await sample(await exported()), stored = { ...state().adjustments };
    editor.selectLayer(shapeId); editor.setTool("adjust");
    const comparisonView = [...editor.canvas.viewportTransform], comparisonSelection = editor.canvas.getActiveObject();
    const comparisonRevision = privateEditor.revision, comparisonSnapshot = JSON.stringify(privateEditor.snapshot());
    const screenPixel = (x: number, y: number) => {
      editor.canvas.renderAll(); const v = editor.canvas.viewportTransform;
      return [...editor.canvas.lowerCanvasEl.getContext("2d")!.getImageData(Math.round(x * v[0] + v[4]), Math.round(y * v[3] + v[5]), 1, 1).data];
    };
    editor.setCompareAdjustments(true);
    check(state().compareAdjustments === true && close(screenPixel(100, 100), [96, 128, 160, 255]) && close(screenPixel(32, 32), [0, 255, 0, 255]), "按住调色前展示未调色底图并保留新增图形的实际颜色");
    check(close(await sample(await exported()), stable) && JSON.stringify(privateEditor.snapshot()) === comparisonSnapshot, "临时调色对比不改变序列化参数或最终导出像素");
    editor.setCompareAdjustments(false);
    check(privateEditor.revision === comparisonRevision && editor.canvas.getActiveObject() === comparisonSelection && editor.canvas.viewportTransform.every((value, i) => value === comparisonView[i]), "松开调色对比保持选择、视野和历史");
    editor.setAdjustments(stored, true); editor.setAdjustments(stored, true);
    check(close(await sample(await exported()), stable), "重复应用同参数不累计效果");
    editor.setAdjustments(DEFAULT_ADJUSTMENTS, true); await editor.undo();
    check(JSON.stringify(state().adjustments) === JSON.stringify(stored) && close(await sample(await exported()), stable), "重置调色可整体撤销，恢复组合参数及像素");
    const sourceUrl = state().layers.find(layer => layer.purpose === "base")!.thumbnailUrl!;
    const abort = new AbortController(); abort.abort();
    check(!await filterThumbnails(sourceUrl, stored, abort.signal), "已取消的缩略图请求不返回旧图片");
    const previews = await filterThumbnails(sourceUrl, stored, new AbortController().signal);
    check(Object.keys(previews!).length === 9 && new Set(Object.values(previews!)).size > 6, "按当前底图生成无滤镜及八种不同效果缩略图");
    editor.setTool("erase"); editor.setBrushSize(20); click(100, 100);
    let inputPixel: number[] = [];
    const resultImage = await picture("#a0b0c0", 256, 192, "image/png");
    editorConfig.eraseApiUrl = "/__adjustment_erase_test__";
    window.fetch = async (input, init) => {
      if (input !== editorConfig.eraseApiUrl) return previousFetch(input, init);
      inputPixel = await sample((init!.body as FormData).get("image") as Blob);
      return new Response(resultImage, { headers: { "content-type": "image/png" } });
    };
    await editor.executeErase();
    check(!!state().pending && close(inputPixel, stable, 5), "消除请求包含当前组合调色效果，不合并新增图形");
    await editor.acceptResult();
    check(JSON.stringify(state().adjustments) === JSON.stringify(DEFAULT_ADJUSTMENTS) && state().layers.some(layer => layer.id === shapeId), "采用消除结果清空已烘焙参数，保留新增图层");
    editor.setTool("adjust"); editor.setAdjustments({ ...state().adjustments, brightness: 15 }, true);
    editor.setCompareAdjustments(true);
    check(close(screenPixel(100, 100), [160, 176, 192, 255]), "调色前对比保留已采用消除结果，不显示进入编辑时原图");
    editor.setCompareAdjustments(false); await editor.undo();
    editor.setAdjustments({ ...state().adjustments, brightness: 15 }, true); editor.setAdjustments(DEFAULT_ADJUSTMENTS, true);
    check(close(await sample(await exported()), [160, 176, 192, 255]), "重置调色保留已采用消除结果，不返回初始原图");
    await editor.undo(); await editor.undo(); await editor.undo();
    check(JSON.stringify(state().adjustments) === JSON.stringify(stored) && state().hasMask && close(await sample(await exported()), stable), "撤销采用同时恢复选区、组合调色及像素");
    const upload = new File([await picture("#ffffff", 128, 96)], "replacement.jpg", { type: "image/jpeg" });
    await confirm(() => editor.uploadReplacement(upload)); await settle(() => !state().busy);
    check(JSON.stringify(state().adjustments) === JSON.stringify(DEFAULT_ADJUSTMENTS) && state().size.width === 128 && state().layers.length === 1, "上传新底图清空调色与旧图层");
  } finally { window.fetch = previousFetch; editorConfig.eraseApiUrl = previousUrl; dispose(); }
}
