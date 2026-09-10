import type { MaskStroke } from "../types";
import sample from "../../docs/demo/eraser/sample.json";
import { previewReplacement } from "./previewReplacement";

/** A fixed, explicitly labelled demo; never a fallback for a configured service. */
export const previewErase = import.meta.env.DEV || import.meta.env.MODE === "demo" ? (() => {
  const { x, y, width, height } = sample.region;
  const selection = (): MaskStroke => ({ kind: "rect", operation: "add", width: 1,
    points: [{ x, y }, { x: x + width, y: y + height }] });
  const matches = (masks: MaskStroke[]) => masks.length === 1 && masks[0].kind === "rect" && masks[0].operation === "add" &&
    masks[0].points.length === 2 && masks[0].points[0].x === x && masks[0].points[0].y === y &&
    masks[0].points[1].x === x + width && masks[0].points[1].y === y + height;
  async function result(signal: AbortSignal) {
    await previewReplacement!.wait(1600, signal);
    const { default: example } = await import("../demo/eraseExample");
    signal.throwIfAborted();
    const response = await fetch(example.result.afterUrl, { signal });
    if (!response.ok) throw new Error("示例结果加载失败，请重试");
    return response.blob();
  }
  return { selection, matches, result };
})() : undefined;
