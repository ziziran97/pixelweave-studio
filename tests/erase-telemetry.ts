import { StaticCanvas } from "fabric";
import { editorConfig } from "../src/config";
import type { EditorIntegration, EraseTelemetryEvent } from "../src/integration";
import { createEditor, picture } from "./editing-tools";

export async function checkEraseTelemetry(check: (value: boolean, label: string) => void) {
  const source = await picture("#123456", 128, 96), result = await picture("#448866", 128, 96);
  const events: EraseTelemetryEvent[] = [], requested: string[] = [];
  const integration: EditorIntegration = { initialImage: source, context: { taskId: "task-test", imageId: "image-test" },
    telemetry: { environment: "test", onEvent: event => { events.push(event); } },
    validateTexts: async () => ({ passed: true }), replace: async () => ({ status: "failed", message: "not used" }),
    confirmResult: async () => ({ status: "pending" }), onClose: () => {} };
  const originalFetch = window.fetch, originalUrl = editorConfig.eraseApiUrl, originalExport = StaticCanvas.prototype.toBlob;
  const fixtures: ReturnType<typeof createEditor>[] = [];
  const disposed = new Set<ReturnType<typeof createEditor>>();
  const dispose = (fixture: ReturnType<typeof createEditor>) => { if (!disposed.has(fixture)) { disposed.add(fixture); fixture.dispose(); } };
  let respond = async () => new Response(result, { headers: { "x-algorithm-version": "fixture-v1", "x-inference-ms": "12.5" } });
  editorConfig.eraseApiUrl = "/__telemetry_fixture__";
  window.fetch = async (url, options) => {
    if (url !== editorConfig.eraseApiUrl) return originalFetch(url, options);
    requested.push(JSON.parse((options!.body as FormData).get("metadata") as string).requestId);
    return respond();
  };
  const count = (name: EraseTelemetryEvent["name"], requestId?: string) => events.filter(event => event.name === name && (!requestId || event.requestId === requestId));
  const setup = async () => {
    const fixture = createEditor(integration); fixtures.push(fixture); await fixture.editor.initialize();
    fixture.editor.setEraseMode("rect"); fixture.drag(10, 10, 60, 45); return fixture;
  };
  const report = (fixture: ReturnType<typeof createEditor>, outcome: "shown" | "failed", attempt = 0) => {
    const pending = fixture.state().pending!;
    fixture.editor.reportErasePreview(pending.assetId, pending.beforeUrl, pending.afterUrl, outcome, attempt);
  };
  try {
    const first = await setup(); await first.editor.executeErase(); const id = requested.at(-1)!;
    check(count("erase_started", id).length === 1 && count("erase_request_finished", id).length === 1 && !count("erase_preview_shown", id).length,
      "消除埋点关联实际请求，生成预览不冒充已加载展示");
    report(first, "failed"); report(first, "failed"); report(first, "shown", 1); report(first, "shown", 1);
    await Promise.resolve();
    check(count("erase_preview_failed", id).length === 1 && count("erase_preview_shown", id).length === 1, "预览加载失败和成功分别记录，重复通知不重复计数");
    const loader = first.editor as unknown as { loadSnapshot: (...args: unknown[]) => Promise<void> }, originalLoad = loader.loadSnapshot;
    loader.loadSnapshot = async () => { throw new Error("fixture apply failure"); };
    try { await first.editor.acceptResult(); } finally { loader.loadSnapshot = originalLoad; }
    check(count("erase_apply_failed", id).length === 1 && !count("erase_decision", id).length && !!first.state().pending, "采用失败保留待选结果，不记已采用或主动放弃");
    await first.editor.acceptResult(); await first.editor.undo(); await first.editor.undo(true); dispose(first); await Promise.resolve();
    const decision = count("erase_decision", id)[0];
    check(count("erase_decision", id).length === 1 && decision.name === "erase_decision" && decision.outcome === "accepted" && decision.previewShown,
      "采用成功、内部清理、撤销重做及卸载只产生一次采用记录");
    check(decision.algorithmVersion === "fixture-v1" && decision.inferenceMs === 12.5 && decision.taskId === "task-test" && decision.imageId === "image-test" && decision.environment === "test",
      "埋点保留服务真实版本、耗时和宿主图片关联，并区分测试环境");

    const retry = await setup(); let exports = 0;
    StaticCanvas.prototype.toBlob = async function (...args) { if (++exports === 2) throw new Error("fixture preview failure"); return originalExport.apply(this, args); };
    await retry.editor.executeErase(); StaticCanvas.prototype.toBlob = originalExport; const retryId = requested.at(-1)!;
    check(!!retry.state().pending?.previewError && count("erase_preview_failed", retryId).length === 1, "预览生成失败单独记录，不归为算法请求失败");
    await retry.editor.retryResultPreview(); report(retry, "shown"); retry.editor.discardResult(); await Promise.resolve();
    const discarded = count("erase_decision", retryId)[0];
    check(count("erase_request_started", retryId).length === 1 && discarded.name === "erase_decision" && discarded.outcome === "discarded",
      "重新生成预览沿用原请求，只有明确放弃产生放弃记录");

    const changed = await setup(); await changed.editor.executeErase(); const changedId = requested.at(-1)!;
    await changed.editor.openImage(source, "换图", false);
    const abandoned = count("erase_decision", changedId)[0];
    check(abandoned.name === "erase_decision" && abandoned.outcome === "no_decision" && abandoned.reason === "image_change", "换图清理结果记为未选择，不计主动放弃");

    const race = await setup(); let release!: (response: Response) => void, notify!: () => void;
    const began = new Promise<void>(resolve => { notify = resolve; });
    respond = () => new Promise<Response>(resolve => { release = resolve; notify(); });
    const old = race.editor.executeErase(); await began; const oldId = requested.at(-1)!; race.editor.cancelTask();
    respond = async () => new Response(result); await race.editor.executeErase(); const nextId = requested.at(-1)!;
    release(new Response(result)); await old; await Promise.resolve();
    const cancelled = count("erase_request_finished", oldId)[0];
    check(cancelled.name === "erase_request_finished" && cancelled.outcome === "cancelled" && count("erase_request_finished", oldId).length === 1 &&
      !count("erase_decision", oldId).length && oldId !== nextId && !!race.state().pending, "取消后重试独立计数，晚到旧响应不产生成功或放弃记录");
    check(count("erase_started", oldId)[0].imageSessionId === count("erase_started", nextId)[0].imageSessionId,
      "同一图片多次消除共用图片会话标识，避免重复统计图片数");
    report(race, "shown"); window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); await Promise.resolve();
    check(!count("erase_decision", nextId).length, "页面进入往返缓存不误记离开，返回可继续选择");
    window.dispatchEvent(new PageTransitionEvent("pagehide")); dispose(race); await Promise.resolve();
    const left = count("erase_decision", nextId)[0];
    check(count("erase_decision", nextId).length === 1 && left.name === "erase_decision" && left.outcome === "no_decision" && left.reason === "page_exit",
      "实际离开及随后卸载只记录一次未选择");

    const upload = await setup(); await upload.editor.executeErase(); const uploadOldId = requested.at(-1)!;
    await upload.confirm(() => upload.editor.uploadReplacement(new File([source], "fixture.jpg", { type: "image/jpeg" })));
    upload.editor.setEraseMode("rect"); upload.drag(10, 10, 60, 45); await upload.editor.executeErase(); const uploadNewId = requested.at(-1)!;
    const uploaded = count("erase_started", uploadNewId)[0], replaced = count("erase_decision", uploadOldId)[0];
    check(uploaded.source === "upload" && uploaded.imageSessionId !== count("erase_started", uploadOldId)[0].imageSessionId &&
      replaced.name === "erase_decision" && replaced.outcome === "no_decision" && replaced.reason === "upload", "成功上传更新图片计数标识，旧结果记未选择而非放弃");

    respond = async () => Response.json({ detail: { code: "LAMA_INPAINT_QUEUE_TIMEOUT", message: "private detail" } }, { status: 429 });
    const failure = await setup(); await failure.editor.executeErase(); const failureId = requested.at(-1)!;
    const failed = count("erase_request_finished", failureId)[0];
    check(failed.name === "erase_request_finished" && failed.outcome === "failure" && failed.errorCode === "QUEUE_TIMEOUT" && failed.httpStatus === 429 &&
      !count("erase_decision", failureId).length && failure.state().hasMask, "请求错误记录稳定分类并保留草稿，不生成质量决策");
    const serialized = JSON.stringify(events);
    check(!serialized.includes("private detail") && !serialized.includes("blob:") && !serialized.includes("base64") && !serialized.includes("mask.png"),
      "埋点不含原始错误、图片地址、图片数据或 Mask 内容");
  } finally {
    StaticCanvas.prototype.toBlob = originalExport; window.fetch = originalFetch; editorConfig.eraseApiUrl = originalUrl;
    fixtures.forEach(dispose);
  }
}
