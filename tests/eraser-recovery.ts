import { StaticCanvas } from "fabric";
import { editorConfig } from "../src/config";
import type { Assets } from "../src/editor/assets";
import type { ImageRegion } from "../src/types";
import { createEditor, picture } from "./editing-tools";

// Fail or delay actual preview exports after a valid service response. The live
// canvas, asset retention and subsequent recovery all use the real controller.
export async function checkEraserRecovery(check: (value: boolean, label: string) => void) {
  const source = await picture("#123456", 128, 96), output = await picture("#008844", 128, 96);
  const originalFetch = window.fetch, originalUrl = editorConfig.eraseApiUrl, originalExport = StaticCanvas.prototype.toBlob;
  let calls = 0;
  let submittedRegion: ImageRegion | undefined;
  editorConfig.eraseApiUrl = "/__eraser_recovery__";
  window.fetch = async (url, options) => {
    if (url !== editorConfig.eraseApiUrl) return originalFetch(url, options);
    calls++;
    const mask = (options!.body as FormData).get("mask") as Blob;
    const bitmap = await createImageBitmap(mask), canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4] === 255) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    submittedRegion = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    canvas.width = canvas.height = 0;
    return new Response(output);
  };
  const setup = async () => {
    const fixture = createEditor();
    await fixture.editor.openImage(source, "预览恢复", false);
    fixture.editor.setTool("rect"); fixture.drag(70, 50, 100, 75);
    fixture.editor.setEraseMode("rect"); fixture.drag(10, 15, 45, 35);
    return fixture;
  };
  try {
    for (const failureAt of [2, 3]) {
      const fixture = await setup(), { editor, state, dispose } = fixture;
      const assets = (editor as unknown as { assets: Assets }).assets;
      const content = () => JSON.stringify({ objects: editor.canvas.toObject(), masks: state().masks, viewport: editor.canvas.viewportTransform });
      const unchanged = content(), started = calls;
      let exports = 0;
      const stages: string[] = [];
      StaticCanvas.prototype.toBlob = async function (...args) {
        stages.push(state().eraseStage!);
        if (++exports === failureAt) throw new Error("固定测试：预览导出失败");
        return originalExport.apply(this, args);
      };
      try {
        const request = editor.executeErase();
        check(state().task && state().eraseStage === "preparing", "消除从真实准备阶段开始");
        await request;
        const pending = state().pending!;
        check(!!pending?.previewError && assets.cost(pending.assetId) > 0 && !state().task && state().hasMask && content() === unchanged,
          `第 ${failureAt - 1} 张预览导出失败仍保留有效消除结果、图层、选区和视野`);
        check(stages[0] === "preparing" && stages.slice(1).every(stage => stage === "preview") && !state().eraseStage,
          "图片导出与预览生成显示对应阶段，任务结束清理阶段状态");
        check(!!pending.region && JSON.stringify(pending.region) === JSON.stringify(submittedRegion), "待采用结果范围与本轮实际提交的 Mask 白色像素一致");
        await editor.acceptResult();
        check(state().pending?.assetId === pending.assetId && content() === unchanged, "预览未生成时控制器也阻止直接采用");
        StaticCanvas.prototype.toBlob = async () => { throw new Error("固定测试：再次导出失败"); };
        await editor.retryResultPreview();
        check(state().pending?.assetId === pending.assetId && !!state().pending?.previewError && !state().pending?.previewPreparing && calls === started + 1,
          "预览再次生成失败仍保留同一结果，不重新调用消除服务");
        StaticCanvas.prototype.toBlob = originalExport;
        await editor.retryResultPreview();
        const ready = state().pending!;
        check(ready.assetId === pending.assetId && !!ready.beforeUrl && !!ready.afterUrl && !ready.previewError && !state().task && calls === started + 1,
          "重新生成成功使用原消除结果，未重复请求且恢复待采用状态");
        const bitmap = await createImageBitmap(await (await originalFetch(ready.afterUrl)).blob());
        check(bitmap.width === 128 && bitmap.height === 96 && content() === unchanged, "恢复的预览可解码且不提前改变编辑草稿"); bitmap.close();
        await editor.acceptResult();
        check(!state().pending && !state().hasMask && state().layers.length === 2, "恢复后采用保留独立新增图层并清除本轮选区");
        await editor.undo();
        check(state().hasMask && content() === unchanged, "恢复后采用仍可一步撤销，恢复图片、对象、选区和视野");
      } finally { StaticCanvas.prototype.toBlob = originalExport; dispose(); }
    }

    for (const action of ["cancel", "discard", "switch", "close", "dispose"] as const) {
      const fixture = await setup(), { editor, state, dispose } = fixture;
      const assets = (editor as unknown as { assets: Assets }).assets;
      let exports = 0, release!: () => void, began!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }), rendering = new Promise<void>(resolve => { began = resolve; });
      let retry: Promise<void> | undefined;
      try {
        StaticCanvas.prototype.toBlob = async function (...args) {
          if (++exports === 2) throw new Error("固定测试：首次预览导出失败");
          return originalExport.apply(this, args);
        };
        await editor.executeErase();
        const pending = state().pending!, requested = calls;
        StaticCanvas.prototype.toBlob = async function (...args) { began(); await gate; return originalExport.apply(this, args); };
        retry = editor.retryResultPreview(); await rendering;
        await editor.retryResultPreview();
        check(state().task && !!state().pending?.previewPreparing && calls === requested, `${action}：预览重试在本地生成中，重复点击不重复发起`);
        StaticCanvas.prototype.toBlob = originalExport;
        let newPreview: string | undefined;
        if (action === "cancel") {
          editor.cancelTask();
          check(state().pending?.assetId === pending.assetId && !state().pending?.previewPreparing && assets.cost(pending.assetId) > 0,
            "取消预览等待后保留原结果及重试条件");
          await editor.retryResultPreview(); newPreview = state().pending?.afterUrl;
        } else if (action === "discard") editor.discardResult();
        else if (action === "switch") await editor.openImage(source, "新文档", false);
        else if (action === "close") await fixture.confirm(() => editor.requestClose());
        else dispose();
        release(); await retry;
        if (action === "cancel") check(!!newPreview && state().pending?.afterUrl === newPreview && !state().task && !state().pending?.previewError,
          "旧预览晚到不会覆盖新预览或重置其状态");
        else check(assets.cost(pending.assetId) === 0 && (action === "dispose" || !state().pending && !state().task),
          `${action}：晚到预览不恢复旧结果，处理完成释放旧资源`);
        check(calls === requested, `${action}：整个预览恢复过程不重新消除`);
      } finally {
        release(); await retry; StaticCanvas.prototype.toBlob = originalExport;
        if (action !== "dispose") dispose();
      }
    }
  } finally { window.fetch = originalFetch; editorConfig.eraseApiUrl = originalUrl; StaticCanvas.prototype.toBlob = originalExport; }
}
