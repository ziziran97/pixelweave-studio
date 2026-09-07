import { checkColorEditing } from "./color-editing";
import { Assets, toBlob } from "../src/editor/assets";
import { exportMask, hasMaskCoverage, polygonHasArea } from "../src/editor/mask";
import { checkSelectionInteractions } from "./selection-interactions";
import { checkRequestLifecycle } from "./request-lifecycle";
import { checkEditingTools, checkTextWorkspace, checkWorkspacePersistence } from "./editing-tools";
import { checkReplacementFlow } from "./replacement-flow";
import { checkDrawingRefinements } from "./drawing-refinements";
import { checkDrawingTransforms } from "./drawing-transforms";
import { checkShapeStyles } from "./shape-styles";
import { checkDrawingTargeting } from "./drawing-targeting";
import { renderDocument } from "../src/editor/render";
import type { DocumentSnapshot, MaskStroke } from "../src/types";

const reports: string[] = [];
function check(condition: boolean, message: string) { if (!condition) throw new Error(message); reports.push(`PASS ${message}`); }
async function pixels(blob: Blob) {
  const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, data, at: (x: number, y: number) => [...data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)] };
}
const assets = new Assets();
try {
  const source = document.createElement("canvas"); source.width = 512; source.height = 256;
  const ctx = source.getContext("2d")!; ctx.fillStyle = "#123456"; ctx.fillRect(0, 0, 512, 256);
  const asset = await assets.add(await toBlob(source));
  const scene: DocumentSnapshot = { size: { width: 512, height: 256 }, masks: [],
    adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0, grayscale: false, sepia: false },
    objects: [
      { type: "Image", editorId: "base", editorAssetId: asset.id, editorPurpose: "base", left: 0, top: 0, width: 512, height: 256, originX: "left", originY: "top" },
      { type: "Rect", editorId: "content", editorPurpose: "content", left: 30, top: 30, width: 60, height: 60, fill: "#00ff00", strokeWidth: 0, originX: "left", originY: "top" },
      { type: "Rect", editorId: "second-content", editorPurpose: "content", left: 150, top: 30, width: 60, height: 60, fill: "#ff0000", strokeWidth: 0, originX: "left", originY: "top" },
      { type: "Rect", editorId: "hidden", editorPurpose: "content", visible: false, left: 250, top: 30, width: 60, height: 60, fill: "#0000ff", strokeWidth: 0, originX: "left", originY: "top" },
    ] };
  const final = await pixels(await renderDocument(scene, assets, "final", "png"));
  check(final.at(50, 50).join() === "0,255,0,255", "正式内容进入最终输出");
  check(final.at(170, 50).join() === "255,0,0,255", "新增图形默认进入最终输出");
  check(final.at(270, 50).join() === "18,52,86,255", "隐藏内容不进入最终输出");
  const base = await pixels(await renderDocument(scene, assets, "base", "png"));
  check(base.at(50, 50).join() === "18,52,86,255", "仅底图输入不包含正式图层");
  const jpeg = await pixels(await renderDocument(scene, assets, "final"));
  check(jpeg.width === 512 && jpeg.height === 256 && jpeg.at(170, 50)[0] > 240 && jpeg.at(170, 50)[1] < 15,
    "JPG 保持原图尺寸并包含新增内容");
  const maskBlob = await exportMask([
    { kind: "rect", operation: "add", points: [{ x: 10, y: 10 }, { x: 100, y: 100 }], width: 0 },
    { kind: "brush", operation: "subtract", points: [{ x: 50, y: 50 }], width: 20 },
    { kind: "polygon", operation: "add", points: [{ x: 120, y: 40 }, { x: 130, y: 15 }, { x: 160, y: 10 }, { x: 180, y: 30 }, { x: 175, y: 65 }, { x: 150, y: 80 }, { x: 125, y: 65 }], width: 0 },
    { kind: "polygon", operation: "add", points: [{ x: 200, y: 10 }, { x: 260, y: 10 }, { x: 250, y: 80 }, { x: 210, y: 70 }], width: 0 },
  ], { width: 4096, height: 2160 });
  const mask = await pixels(maskBlob);
  check(maskBlob.type === "image/png" && mask.width === 4096 && mask.height === 2160, "4K Mask 无损输出且物理尺寸 1:1");
  check(mask.at(20, 20).join() === "255,255,255,255" && mask.at(50, 50).join() === "0,0,0,255", "增加与减去选区正确合成");
  check(mask.at(9, 20)[0] === 0 && mask.at(10, 20)[0] === 255 && mask.at(99, 20)[0] === 255 && mask.at(100, 20)[0] === 0 &&
    mask.at(20, 9)[0] === 0 && mask.at(20, 10)[0] === 255 && mask.at(20, 99)[0] === 255 && mask.at(20, 100)[0] === 0,
    "框选导出严格使用所选矩形范围");
  const brushMask = await pixels(await exportMask([
    { kind: "brush", operation: "add", points: [{ x: 40, y: 40 }], width: 20 },
  ], { width: 100, height: 100 }));
  check(brushMask.at(30, 40)[0] === 255 && brushMask.at(49, 40)[0] === 255 && brushMask.at(29, 40)[0] === 0 &&
    brushMask.at(50, 40)[0] === 0 && brushMask.at(40, 29)[0] === 0 && brushMask.at(40, 50)[0] === 0,
    "涂抹导出按笔刷实际直径覆盖");
  const polygonMask = await pixels(await exportMask([
    { kind: "polygon", operation: "add", points: [{ x: 30, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 60 }, { x: 30, y: 60 }], width: 0 },
  ], { width: 100, height: 100 }));
  check(polygonMask.at(30, 45)[0] === 255 && polygonMask.at(59, 45)[0] === 255 && polygonMask.at(29, 45)[0] === 0 &&
    polygonMask.at(60, 45)[0] === 0 && polygonMask.at(45, 29)[0] === 0 && polygonMask.at(45, 60)[0] === 0,
    "圈选和套索的多边形仅填充所选范围");
  check(mask.at(150, 45).join() === "255,255,255,255" && mask.at(230, 40).join() === "255,255,255,255", "自由圈选与逐点套索均进入 Mask");
  let binary = true;
  for (let i = 0; i < mask.data.length; i += 4) if ((mask.data[i] !== 0 && mask.data[i] !== 255) || mask.data[i] !== mask.data[i+1] || mask.data[i] !== mask.data[i+2] || mask.data[i+3] !== 255) { binary = false; break; }
  check(binary, "全部 Mask 像素严格为不透明纯黑或纯白");
  let emptyRejected = false;
  try { await exportMask([{ kind: "brush", operation: "subtract", points: [{ x: 10, y: 10 }], width: 20 }], { width: 100, height: 100 }); } catch { emptyRejected = true; }
  check(emptyRejected, "空选区拒绝提交");
  const square: MaskStroke = { kind: "rect", operation: "add", points: [{ x: 10, y: 10 }, { x: 40, y: 40 }], width: 0 };
  const removal: MaskStroke = { ...square, operation: "subtract" };
  const size = { width: 100, height: 100 };
  check(!hasMaskCoverage([square, removal], size), "全部减去后最终选区确实为空");
  check(hasMaskCoverage([square, removal, square], size), "减空后重新添加可恢复有效选区");
  const bow: MaskStroke = { kind: "polygon", operation: "add", width: 0, points: [{ x: 10, y: 10 }, { x: 80, y: 80 }, { x: 10, y: 80 }, { x: 80, y: 10 }] };
  check(polygonHasArea(bow, 1) && polygonHasArea(bow, .25), "交叉圈选不会因有向面积抵消而被误判");
  check(!polygonHasArea({ ...bow, points: [{ x: 10, y: 10 }, { x: 40, y: 40 }, { x: 80, y: 80 }] }, 1), "无面积的直线仍被过滤");
  const outside: MaskStroke = { kind: "polygon", operation: "add", width: 0,
    points: [{ x: 0, y: 20 }, { x: -100000, y: 20 }, { x: -100000, y: 80 }, { x: 0, y: 80 }] };
  check(!polygonHasArea(outside, 1, size), "选区有效面积只计算图内像素");
  check(polygonHasArea({ ...outside, points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 100000 }] }, 1, size),
    "远离图片的松手位置按图片范围限制作面积检查");
  await checkSelectionInteractions(check);
  await checkRequestLifecycle(check);
  await checkEditingTools(check);
  await checkDrawingRefinements(check);
  await checkDrawingTransforms(check);
  await checkShapeStyles(check);
  await checkDrawingTargeting(check);
  await checkColorEditing(check);
  await checkTextWorkspace(check);
  await checkWorkspacePersistence(check);
  await checkReplacementFlow(check);
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally { assets.dispose(); document.getElementById("results")!.textContent = reports.join("\n"); }
