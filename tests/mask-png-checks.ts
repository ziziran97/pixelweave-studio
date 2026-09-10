import { exportMask, paintStroke } from "../src/editor/mask";
import { binaryPixels } from "../src/editor/geometry";
import { toBlob } from "../src/editor/assets";
import type { DocumentSize, ImageRegion, MaskStroke } from "../src/types";

// Exact pre-change path, retained only as an independent browser-decoded baseline.
export async function legacyMask(strokes: MaskStroke[], size: DocumentSize) {
  const canvas = document.createElement("canvas"); Object.assign(canvas, size);
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    strokes.forEach(stroke => paintStroke(ctx, stroke));
    const pixels = ctx.getImageData(0, 0, size.width, size.height);
    if (!binaryPixels(pixels.data)) throw new Error("当前选区为空，请先添加需要修改的区域");
    ctx.putImageData(pixels, 0, 0);
    return await toBlob(canvas, "image/png");
  } finally { canvas.width = canvas.height = 0; }
}

export async function pngHeader(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  const chunks: string[] = [];
  for (let offset = 8; offset < bytes.length; offset += view.getUint32(offset) + 12) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
  }
  return { signature: [...bytes.subarray(0, 8)].join(), width: view.getUint32(16), height: view.getUint32(20),
    bitDepth: bytes[24], colorType: bytes[25], chunks };
}

async function decode(blob: Blob) {
  // Browser PNG decoder is independent of our encoder and accepts both old/new formats.
  const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  try {
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally { bitmap.close(); canvas.width = canvas.height = 0; }
}

export function representativeMask(size: DocumentSize): MaskStroke[] {
  const point = (x: number, y: number) => ({ x: x * size.width, y: y * size.height });
  return [
    { kind: "rect", operation: "add", width: 0, points: [point(.07, .06), point(.44, .53)] },
    { kind: "brush", operation: "add", width: size.width * .045, points: Array.from({ length: 100 }, (_, i) => point(i / 99, .64 + .13 * Math.sin(i * .19))) },
    { kind: "polygon", operation: "add", width: 0, points: [point(.51, .04), point(.96, .19), point(.79, .56), point(.59, .37)] },
    { kind: "brush", operation: "subtract", width: size.width * .09, points: [point(.22, .12), point(.35, .42)] },
    { kind: "rect", operation: "subtract", width: 0, points: [point(.65, .16), point(.73, .36)] },
    { kind: "polygon", operation: "add", width: 0, points: [point(-.1, .93), point(.35, .86), point(.25, 1.1)] },
  ];
}

export async function compareMasks(oldBlob: Blob, newBlob: Blob, size: DocumentSize, check: (value: boolean, label: string) => void, label: string) {
  const header = await pngHeader(newBlob);
  check(newBlob.type === "image/png" && header.signature === "137,80,78,71,13,10,26,10" && header.bitDepth === 8 && header.colorType === 0 &&
    header.chunks.join() === "IHDR,IDAT,IEND", `${label}：实际文件为 8-bit 灰度 PNG，无 alpha/tRNS`);
  const [oldPixels, newPixels] = await Promise.all([decode(oldBlob), decode(newBlob)]);
  check(header.width === size.width && header.height === size.height && newPixels.width === size.width && newPixels.height === size.height &&
    oldPixels.width === size.width && oldPixels.height === size.height, `${label}：独立解码尺寸完全一致`);
  let mismatch = 0, invalid = 0;
  for (let i = 0; i < newPixels.data.length; i++) {
    if (newPixels.data[i] !== oldPixels.data[i]) mismatch++;
    if (i % 4 === 3 ? newPixels.data[i] !== 255 : newPixels.data[i] !== 0 && newPixels.data[i] !== 255) invalid++;
  }
  check(mismatch === 0 && invalid === 0, `${label}：逐像素一致，仅 0/255，解码后完全不透明`);
}

export async function checkGrayMasks(check: (value: boolean, label: string) => void) {
  const size = { width: 137, height: 93 };
  const rect: MaskStroke = { kind: "rect", operation: "add", width: 0, points: [{ x: 0, y: 0 }, { x: 137, y: 93 }] };
  const brush: MaskStroke = { kind: "brush", operation: "add", width: 13.7,
    points: [{ x: 0, y: 0 }, { x: 30.1, y: 22.6 }, { x: 70, y: 32 }, { x: 137, y: 93 }], breaks: [2] };
  const polygon: MaskStroke = { kind: "polygon", operation: "add", width: 0,
    points: [{ x: -10, y: 20.3 }, { x: 93.2, y: -20 }, { x: 136.7, y: 92.8 }, { x: 20, y: 70.2 }] };
  for (const [label, strokes] of [
    ["矩形覆盖四边", [rect]], ["画笔分段与小数边缘", [brush]], ["多边形与越界裁切", [polygon]],
    ["混合加选", [brush, polygon]], ["矩形减选", [polygon, { ...rect, operation: "subtract", points: [{ x: 25, y: 20 }, { x: 50, y: 50 }] }]],
    ["画笔和多边形减选", [rect, { ...brush, operation: "subtract" }, { ...polygon, operation: "subtract" }]],
    ["减空再加选", [rect, { ...rect, operation: "subtract" }, brush]],
    ["减选移除左半边", [rect, { ...rect, operation: "subtract", points: [{ x: 0, y: 0 }, { x: 100, y: 93 }] }]],
  ] as [string, MaskStroke[]][]) {
    let bounds: ImageRegion | undefined;
    const blob = await exportMask(strokes, size, undefined, value => { bounds = value; });
    await compareMasks(await legacyMask(strokes, size), blob, size, check, label);
    const pixels = await decode(blob), xs: number[] = [], ys: number[] = [];
    for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) if (pixels.data[(y * size.width + x) * 4] === 255) { xs.push(x); ys.push(y); }
    check(JSON.stringify(bounds) === JSON.stringify({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 }),
      `${label}：定位范围与独立解码后的最终白色像素一致`);
  }
  for (const strokes of [[], [{ ...brush, operation: "subtract" }], [rect, { ...rect, operation: "subtract" }]] as MaskStroke[][]) {
    let message = "";
    try { await exportMask(strokes, size); } catch (error) { message = (error as Error).message; }
    check(message === "当前选区为空，请先添加需要修改的区域", "空选区沿用原有提示");
  }
}
