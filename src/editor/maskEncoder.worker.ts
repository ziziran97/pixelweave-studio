import { binaryPixels } from "./geometry";
import { encodeGrayPng } from "./grayPng";

// One export per worker. The caller transfers (not copies) the canvas readback.
self.onmessage = async ({ data }: MessageEvent<{ pixels: ArrayBuffer; width: number; height: number }>) => {
  try {
    const rgba = new Uint8ClampedArray(data.pixels);
    if (rgba.length !== data.width * data.height * 4) throw new Error("蒙版尺寸与像素数据不一致");
    if (!binaryPixels(rgba)) throw new Error("当前选区为空，请先添加需要修改的区域");
    // Compact the already-binarized red samples into the transferred buffer itself.
    // Destination i never overwrites a future source 4*i. No full-size gray copy.
    const gray = new Uint8Array(data.pixels, 0, data.width * data.height);
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
    self.postMessage({ blob: await encodeGrayPng(gray, data.width, data.height) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "蒙版编码失败，请重试" });
  }
};
