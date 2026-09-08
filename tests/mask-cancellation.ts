import { StaticCanvas } from "fabric";
import { EditorController } from "../src/editor/EditorController";
import { exportMask } from "../src/editor/mask";
import { toBlob } from "../src/editor/assets";
import { editorConfig } from "../src/config";
import type { EditorView } from "../src/types";

// Hold encoding before completion so cancellation never depends on image size/timing.
class HeldWorker {
  static instances: HeldWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  pixels?: ArrayBuffer;
  constructor() { HeldWorker.instances.push(this); }
  postMessage(data: { pixels: ArrayBuffer }, transfer: Transferable[]) {
    this.pixels = structuredClone(data, { transfer }).pixels;
  }
  terminate() { this.terminated = true; this.pixels = undefined; }
}

async function settles(promise: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("取消编码后任务仍未退出")), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function checkMaskCancellation(check: (value: boolean, label: string) => void) {
  const originalWorker = window.Worker, originalFetch = window.fetch, originalUrl = editorConfig.eraseApiUrl;
  const originalToBlob = StaticCanvas.prototype.toBlob;
  let jpegRenders = 0, requests = 0;
  const fixture = document.createElement("canvas"); fixture.width = 128; fixture.height = 96;
  const ctx = fixture.getContext("2d")!; ctx.fillStyle = "#123456"; ctx.fillRect(0, 0, 128, 96);
  const source = await toBlob(fixture); fixture.width = fixture.height = 0;
  try {
    window.Worker = HeldWorker as unknown as typeof Worker;
    editorConfig.eraseApiUrl = "/__mask_cancellation__";
    window.fetch = async (input, init) => {
      if (input !== editorConfig.eraseApiUrl) return originalFetch(input, init);
      requests++; return new Response(null, { status: 503 });
    };
    StaticCanvas.prototype.toBlob = function(options) {
      if (options?.format === "jpeg") jpegRenders++;
      return originalToBlob.call(this, options);
    };
    const cancelled = new AbortController(); cancelled.abort();
    const workerCount = HeldWorker.instances.length;
    let name = "";
    try { await exportMask([], { width: 128, height: 96 }, cancelled.signal); } catch (error) { name = (error as Error).name; }
    check(name === "AbortError" && HeldWorker.instances.length === workerCount, "已取消的导出不分配 Canvas 或创建 Worker");

    for (const scenario of ["取消", "连续取消重试", "换图", "关闭", "卸载", "编码返回同时取消"] as const) {
      const host = document.createElement("div"), canvas = document.createElement("canvas"), overlay = document.createElement("canvas");
      host.style.cssText = "position:relative;width:800px;height:600px"; host.append(canvas, overlay); document.body.append(host);
      let view!: EditorView, disposed = false;
      const editor = new EditorController(canvas, overlay, host, value => { view = value; });
      const internals = editor as unknown as { processingAssets: Map<string, Set<string>> };
      const executions: Promise<void>[] = [];
      try {
        await editor.openImage(source, "编码取消检查", false); editor.setEraseMode("brush");
        const upper = editor.canvas.upperCanvasEl, bounds = upper.getBoundingClientRect(), transform = editor.canvas.viewportTransform;
        for (const type of ["mousedown", "mouseup"]) (type === "mousedown" ? upper : document).dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: type === "mousedown" ? 1 : 0,
          clientX: bounds.left + 40 * transform[0] + transform[4], clientY: bounds.top + 40 * transform[3] + transform[5],
        }));
        const before = JSON.stringify(editor.canvas.toObject(["editorAssetId", "editorId"])), masks = JSON.stringify(view.masks);
        const jpegBefore = jpegRenders, requestsBefore = requests;
        const done = editor.executeErase(); executions.push(done);
        const worker = HeldWorker.instances.at(-1)!;
        check(view.task && !worker.terminated && !!worker.pixels && internals.processingAssets.size === 1, `${scenario}：请求停在蒙版编码阶段`);
        const lateMessage = worker.onmessage!;
        if (scenario === "编码返回同时取消") lateMessage(new MessageEvent("message", { data: { blob: source } }));
        if (scenario === "换图") await editor.openImage(source, "替换图片", false);
        else if (scenario === "关闭") {
          const closing = editor.requestClose();
          check(!worker.terminated && view.confirmation?.kind === "close", "关闭确认前保持当前编码任务");
          editor.answerConfirmation(view.confirmation!.id, true); await closing;
        } else if (scenario === "卸载") { editor.dispose(); disposed = true; }
        else editor.cancelTask();
        check(worker.terminated && !worker.pixels, `${scenario}：立即终止 Worker 并解除像素缓冲引用`);
        if (scenario === "连续取消重试") {
          const retry = editor.executeErase(); executions.push(retry);
          const next = HeldWorker.instances.at(-1)!;
          await settles(done);
          lateMessage(new MessageEvent("message", { data: { blob: source } }));
          check(next !== worker && !next.terminated && view.task && internals.processingAssets.size === 1,
            "旧编码结束或晚到消息不会终止新 Worker，旧任务资源已释放");
          editor.cancelTask(); await settles(retry);
        } else await settles(done);
        if (!disposed) {
          const notice = view.notice;
          lateMessage(new MessageEvent("message", { data: { blob: source } }));
          await Promise.resolve();
          check(!view.task && !view.pending && view.notice === notice, `${scenario}：晚到编码结果不覆盖当前状态`);
          if (scenario === "取消" || scenario === "连续取消重试" || scenario === "编码返回同时取消") {
            check(JSON.stringify(editor.canvas.toObject(["editorAssetId", "editorId"])) === before && JSON.stringify(view.masks) === masks,
              `${scenario}：保留图片和选区`);
          }
        }
        check(internals.processingAssets.size === 0 && jpegRenders === jpegBefore && requests === requestsBefore,
          `${scenario}：释放任务资源，不再渲染 JPEG 或发请求`);
        check(worker.onmessage === null && worker.onerror === null && worker.onmessageerror === null, `${scenario}：清理 Worker 事件回调`);
      } finally {
        if (!disposed) editor.dispose();
        for (const worker of HeldWorker.instances) worker.onerror?.(new ErrorEvent("error", { cancelable: true }));
        await Promise.allSettled(executions); host.remove();
      }
    }
  } finally {
    for (const worker of HeldWorker.instances) worker.terminate();
    HeldWorker.instances = [];
    window.Worker = originalWorker; window.fetch = originalFetch; editorConfig.eraseApiUrl = originalUrl;
    StaticCanvas.prototype.toBlob = originalToBlob;
  }
}
