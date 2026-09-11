import type { MaskStroke } from "../types";
import sample from "../../docs/demo/eraser/sample.json";
import { previewReplacement } from "./previewReplacement";
import { fetchImageBlob } from "../lib/imageLoading";

/** A fixed, explicitly labelled demo; never a fallback for a configured service. */
export const previewErase = import.meta.env.DEV || import.meta.env.MODE === "demo" ? (() => {
  const { x, y, width, height } = sample.region;
  const selection = (): MaskStroke => ({ kind: "rect", operation: "add", width: 1,
    points: [{ x, y }, { x: x + width, y: y + height }] });
  const matches = (masks: MaskStroke[]) => masks.length === 1 && masks[0].kind === "rect" && masks[0].operation === "add" &&
    masks[0].points.length === 2 && masks[0].points[0].x === x && masks[0].points[0].y === y &&
    masks[0].points[1].x === x + width && masks[0].points[1].y === y + height;
  async function result(signal: AbortSignal, loaded?: () => void) {
    // Download while the short demonstration delay runs, rather than adding both waits.
    const download = import("../demo/eraseExample").then(async ({ default: example }) => {
      signal.throwIfAborted();
      const blob = await fetchImageBlob(example.result.afterUrl, { signal, cache: import.meta.env.DEV ? "default" : "force-cache",
        failureMessage: "示例结果加载失败，请重试", timeoutMessage: "示例结果加载超时，请检查网络后重试" });
      signal.throwIfAborted(); loaded?.(); return blob;
    });
    const [blob] = await Promise.all([download, previewReplacement!.wait(1600, signal)]);
    return blob;
  }
  return { selection, matches, result, loadingNotice: "正在加载示例结果…" };
})() : undefined;
