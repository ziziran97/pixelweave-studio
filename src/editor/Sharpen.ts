import { classRegistry, filters } from "fabric";

/** Retain Fabric's GPU convolution; make CPU image edges match GPU CLAMP_TO_EDGE. */
export class Sharpen extends filters.Convolute {
  static type = "PixelweaveSharpen";
  getCacheKey() { return "Convolute_3_0" as const; }
  applyTo2d(options: Parameters<filters.Convolute["applyTo2d"]>[0]) {
    const source = options.imageData;
    super.applyTo2d(options);
    const { width, height, data } = source, output = options.imageData.data;
    const edge = (x: number, y: number) => {
      for (let channel = 0; channel < 4; channel++) {
        let value = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.max(0, Math.min(width - 1, x + dx)), sy = Math.max(0, Math.min(height - 1, y + dy));
          value += data[(sy * width + sx) * 4 + channel] * this.matrix[(dy + 1) * 3 + dx + 1];
        }
        output[(y * width + x) * 4 + channel] = value;
      }
    };
    for (let x = 0; x < width; x++) { edge(x, 0); if (height > 1) edge(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { edge(0, y); if (width > 1) edge(width - 1, y); }
  }
}
classRegistry.setClass(Sharpen);
