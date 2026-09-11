import { FabricImage, getFilterBackend, WebGLFilterBackend, filters, Canvas2dFilterBackend, setFilterBackend, StaticCanvas } from "fabric";
import { Assets, prepareUploadedImage, toBlob, validateJpeg } from "../src/editor/assets";
import { adjustmentFilters } from "../src/editor/adjustments";
import { ensureImageFiltering } from "../src/editor/imageFiltering";
import { hasMaskCoverage, paintStroke } from "../src/editor/mask";
import { renderDocument } from "../src/editor/render";
import { DEFAULT_ADJUSTMENTS } from "../src/types";
import type { DocumentSnapshot, MaskStroke } from "../src/types";
import { createEditor, picture, frame } from "./editing-tools";
import { editorConfig } from "../src/config";

const close = (a: number[], b: number[], tolerance = 5) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
const pattern = (width: number, height: number) => {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#406080"; ctx.fillRect(0, 0, width, height);
  for (let x = 0; x < width; x += 37) { ctx.fillStyle = x % 2 ? "#305080" : "#a04050"; ctx.fillRect(x, 0, 17, height); }
  for (let y = 0; y < height; y += 43) { ctx.fillStyle = y % 2 ? "#308040" : "#804030"; ctx.fillRect(0, y, width, 13); }
  return canvas;
};
const pixels = (canvas: HTMLCanvasElement, points: number[][]) => points.map(([x, y]) => [...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data]);
async function imagePixels(blob: Blob, points: number[][]) {
  const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d")!, result = points.map(([x, y]) => { ctx.clearRect(0, 0, 1, 1); ctx.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; });
  bitmap.close(); return result;
}

export async function checkLargeImages(check: (ok: boolean, message: string) => void) {
  ensureImageFiltering();
  const backend = getFilterBackend();
  check(backend instanceof WebGLFilterBackend, "浏览器大图回归实际启用图形加速，覆盖原裁切故障路径");
  const gpu = backend as WebGLFilterBackend, originalLimit = gpu.tileSize;
  const source = pattern(512, 256), image = new FabricImage(source);
  const settings = { ...DEFAULT_ADJUSTMENTS, brightness: 12, contrast: 15, saturation: 20, temperature: 10, sharpen: 40, overlayColor: "#80a060", overlayStrength: 12, filter: "vivid" as const, filterStrength: 60 };
  try {
    image.filters = adjustmentFilters(settings); image.applyFilters();
    const full = (image.getElement() as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 512, 256).data;
    gpu.tileSize = 128; image.applyFilters();
    const tiled = (image.getElement() as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 512, 256).data;
    check(full.every((value, index) => Math.abs(value - tiled[index]) <= 1), "分块调色全像素匹配整图加速，包含锐化接缝、边角及组合滤镜");
    image.filters = [new filters.Grayscale()]; image.applyFilters();
    const fallback = (image.getElement() as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 512, 256).data;
    setFilterBackend(new Canvas2dFilterBackend()); image.applyFilters();
    const expected = (image.getElement() as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 512, 256).data;
    check(fallback.every((value, index) => value === expected[index]), "未知大图滤镜沿用完整 CPU 处理，不误用局部分块");
  } finally { setFilterBackend(backend); gpu.tileSize = originalLimit; image.dispose(); source.width = source.height = 0; }

  for (const [width, height] of [[2048, 2048], [4096, 512], [4097, 512], [4392, 1800], [1800, 4392], [5000, 5000]]) {
    const raw = pattern(width, height), blob = await toBlob(raw, "image/jpeg", .94); raw.width = raw.height = 0;
    const fixture = createEditor(), { editor, state } = fixture;
    const probe = editor as unknown as { snapshot: () => DocumentSnapshot; assets: Assets };
    try {
      await editor.openImage(blob, "大图回归", false);
      check(state().ready && state().size.width === width && state().size.height === height, `${width} × ${height} 按原始尺寸进入编辑`);
      editor.setTool("adjust"); editor.setAdjustments(settings, true);
      const points = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [width - 1, Math.floor(height / 2)], [Math.min(width - 1, 4094), Math.floor(height / 2)]];
      const filtered = pixels((editor.canvas.getObjects()[0] as FabricImage).getElement() as HTMLCanvasElement, points);
      check(filtered.every(pixel => pixel[3] === 255), `${width} × ${height} 调色后边角、右侧及接缝均无透明缺失`);
      const exported = await renderDocument(probe.snapshot(), probe.assets, "final");
      const exportedSize = await validateJpeg(exported), encoded = await imagePixels(exported, points);
      check(exportedSize.width === width && exportedSize.height === height && encoded.every((pixel, i) => close(pixel, filtered[i], 22)), `${width} × ${height} 最终 JPG 保持完整尺寸和边缘颜色`);
      if (width === 4392) {
        await editor.undo(); await editor.undo(true);
        const restored = pixels((editor.canvas.getObjects()[0] as FabricImage).getElement() as HTMLCanvasElement, points);
        check(restored.every((pixel, i) => close(pixel, filtered[i], 1)), "A+ 三倍图撤销及重做恢复完整调色像素");
        await fixture.confirm(() => editor.uploadReplacement(new File([blob], "aplus.jpg", { type: "image/jpeg" })));
        check(state().size.width === 4392 && state().adjustments.brightness === 0, "A+ 大图上传保持尺寸并沿用清空调色规则");
        const uploadSnapshot = JSON.stringify(probe.snapshot());
        const oversized = new File([await picture("#123456", 5001, 32)], "too-wide.jpg", { type: "image/jpeg" });
        await fixture.confirm(() => editor.uploadReplacement(oversized));
        check(JSON.stringify(probe.snapshot()) === uploadSnapshot && state().notice.includes("5000 px"), "超宽上传失败保留当前底图与编辑草稿");
      }
    } finally { fixture.dispose(); await frame(); }
  }

  for (const [width, height, format] of [[5001, 32, "image/jpeg"], [32, 5001, "image/png"]] as const) {
    const blob = await picture("#123456", width, height, format), assets = new Assets();
    for (const load of [() => assets.add(blob), () => prepareUploadedImage(new File([blob], "oversized", { type: format }))]) {
      let message = ""; try { await load(); } catch (error) { message = (error as Error).message; }
      check(message.includes("5000 px"), `${width} × ${height} ${format} 在初始资源和上传入口均拦截超限`);
    }
    assets.dispose();
  }
  const assets = new Assets(), originalBitmap = window.createImageBitmap;
  const small = await picture(); let decodes = 0;
  try {
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => { decodes++; return originalBitmap(...args); }) as typeof createImageBitmap;
    const checked = await validateJpeg(small); await assets.add(checked.jpeg);
    check(decodes === 1, "JPG 校验和资源入库共享已验证尺寸，避免重复位图解码");
  } finally { window.createImageBitmap = originalBitmap; assets.dispose(); }

  const size = { width: 256, height: 128 }, canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const add: MaskStroke = { kind: "brush", operation: "add", width: 3, points: [{ x: 129.2, y: 119.6 }] };
  const rectangle: MaskStroke = { kind: "rect", operation: "add", width: 1, points: [{ x: -40.4, y: 30.6 }, { x: 43.8, y: 59.7 }] };
  const cases: MaskStroke[][] = [[], [add], [rectangle], [add, { ...add, operation: "subtract", width: 6 }],
    [rectangle, { ...rectangle, operation: "subtract" }, add], [{ ...add, points: [{ x: 2000, y: 3000 }] }],
    [{ kind: "polygon", operation: "add", width: 1, points: [{ x: 121.3, y: 80.6 }, { x: 142.8, y: 21.1 }, { x: 163.4, y: 89.3 }] }]];
  for (const [index, strokes] of cases.entries()) {
    ctx.clearRect(0, 0, size.width, size.height); strokes.forEach(stroke => paintStroke(ctx, stroke));
    const rgba = ctx.getImageData(0, 0, size.width, size.height).data;
    let coverage = false; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= 128) { coverage = true; break; }
    check(hasMaskCoverage(strokes, size) === coverage, `局部选区覆盖检查与整图像素规则一致（案例 ${index + 1}）`);
  }
  canvas.width = canvas.height = 0;
  await checkPreviewReuse(check);
}

async function checkPreviewReuse(check: (ok: boolean, message: string) => void) {
  const inputImage = await picture("#204060", 128, 96), resultImage = await picture("#608040", 128, 96);
  const fixture = createEditor(), { editor, state } = fixture;
  const originalFetch = window.fetch, originalUrl = editorConfig.eraseApiUrl, originalExport = StaticCanvas.prototype.toBlob;
  let exports = 0, submittedImage!: Blob, result = resultImage;
  const equal = async (a: Blob, b: Blob) => {
    const [first, second] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    const other = new Uint8Array(second);
    return first.byteLength === second.byteLength && new Uint8Array(first).every((value, i) => value === other[i]);
  };
  try {
    editorConfig.eraseApiUrl = "/__preview_reuse__";
    window.fetch = async (input, init) => {
      if (String(input) !== editorConfig.eraseApiUrl) return originalFetch(input, init);
      submittedImage = (init!.body as FormData).get("image") as Blob; return new Response(result);
    };
    await editor.openImage(inputImage, "预览复用检查", false);
    editor.setTool("rect"); fixture.drag(40, 40, 75, 65);
    const addedId = editor.canvas.getObjects().at(-1)!.editorId!;
    editor.updateLayer(addedId, { visible: false });
    editor.setEraseMode("rect"); fixture.drag(5, 5, 20, 20);
    StaticCanvas.prototype.toBlob = function (...args) { exports++; return originalExport.apply(this, args); };
    await editor.executeErase();
    const before = await originalFetch(state().pending!.beforeUrl).then(response => response.blob());
    check(exports === 2 && await equal(before, submittedImage), "无可见新增内容时复用实际消除源图，只合成源图和消除后预览");
    editor.discardResult(); editor.updateLayer(addedId, { visible: true }); exports = 0;
    await editor.executeErase();
    const composed = await originalFetch(state().pending!.beforeUrl).then(response => response.blob());
    check(exports === 3 && !await equal(composed, submittedImage), "有可见新增内容时仍生成完整消除前预览，图层不漏入或丢失");
    editor.discardResult(); result = await picture("#204060", 5001, 32);
    await editor.executeErase();
    check(!state().pending && state().hasMask && state().size.width === 128 && state().notice.includes("5000 px"), "超限消除结果明确提示尺寸限制，保留原图片和选区");
  } finally { window.fetch = originalFetch; editorConfig.eraseApiUrl = originalUrl; StaticCanvas.prototype.toBlob = originalExport; fixture.dispose(); }
}
