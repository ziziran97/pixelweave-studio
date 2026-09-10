import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { EditorController } from "../src/editor/EditorController";
import { editorConfig } from "../src/config";
import { readEraseTelemetry } from "../src/telemetry";
import { renderDocument } from "../src/editor/render";
import { validateJpeg } from "../src/editor/assets";
import type { Assets } from "../src/editor/assets";
import type { DocumentSnapshot, PendingResult } from "../src/types";
import type { EditorIntegration } from "../src/integration";
import { frame, picture, pixelAt } from "./editing-tools";

export async function checkEraseDemoFlow(check: (value: boolean, message: string) => void) {
  const host = document.createElement("div"); host.style.cssText = "height:740px;width:1280px"; document.body.append(host);
  const root = createRoot(host), originalFetch = window.fetch, originalInitialize = EditorController.prototype.initialize;
  const originalApi = editorConfig.eraseApiUrl, originalImage = editorConfig.defaultImageUrl;
  let engine!: EditorController, apiRequests = 0, sampleRequests = 0, sampleMode: "normal" | "fail" | "hold" = "normal";
  const held: Array<() => void> = [];
  const executions: Promise<void>[] = [];
  type Probe = { snapshot: () => DocumentSnapshot; assets: Assets; revision: number; pending?: PendingResult;
    job?: { stage: string }; confirmation?: { id: string }; loadSnapshot: (snapshot: DocumentSnapshot) => Promise<void> };
  const probe = () => engine as unknown as Probe;
  const paint = async () => { await frame(); await frame(); };
  const waitFor = async (ready: () => boolean) => {
    const end = Date.now() + 10000;
    while (!ready()) { if (Date.now() > end) throw new Error("等待消除流程演示超时"); await new Promise(resolve => setTimeout(resolve, 20)); }
    await paint();
  };
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item =>
    (item.getAttribute("aria-label") ?? item.textContent?.trim()) === label);
  const dialog = () => host.querySelector<HTMLDialogElement>(".result-dialog");
  const loaded = () => !!probe().pending && !!dialog()?.open && !button("使用消除结果")?.disabled && !!button("使用消除结果");
  const snapshot = () => probe().snapshot();
  const baseId = () => snapshot().objects.find(object => object.editorPurpose === "base")!.editorAssetId!;
  const content = () => JSON.stringify(snapshot().objects.filter(object => object.editorPurpose !== "base"));
  const draft = () => JSON.stringify(snapshot());
  const run = () => { const done = engine.executeErase(); executions.push(done); return done; };
  const drag = (x1: number, y1: number, x2: number, y2: number) => {
    const canvas = engine.canvas.upperCanvasEl, bounds = canvas.getBoundingClientRect(), v = engine.canvas.viewportTransform;
    for (const [type, x, y] of [["mousedown", x1, y1], ["mousemove", x2, y2], ["mouseup", x2, y2]] as const) {
      (type === "mousedown" ? canvas : document).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true,
        button: 0, buttons: type === "mouseup" ? 0 : 1, clientX: bounds.left + x * v[0] + v[4], clientY: bounds.top + y * v[3] + v[5] }));
    }
  };
  const mount = async (integration?: EditorIntegration) => {
    root.render(null); await paint(); root.render(createElement(App, { preview: true, integration }));
    await waitFor(() => !!button("消除笔") && !button("消除笔")!.disabled);
  };
  EditorController.prototype.initialize = function () { engine = this; return originalInitialize.call(this); };
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method.toUpperCase() === "POST") {
      if (url !== "/__erase_demo_real_service__") throw new Error("演示不得请求算法或保存接口");
      apiRequests++;
      return new Response(JSON.stringify({ message: "Service unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("after-2910x1800")) {
      sampleRequests++;
      if (sampleMode === "fail") return new Response(null, { status: 503 });
      if (sampleMode === "hold") {
        const response = await originalFetch(input); // Intentionally ignore abort to exercise late delivery.
        await new Promise<void>(resolve => held.push(resolve)); return response;
      }
    }
    return originalFetch(input, init);
  };
  try {
    editorConfig.eraseApiUrl = ""; editorConfig.defaultImageUrl = "";
    await mount();
    check(!!button("选择示例标签区域") && !snapshot().masks.length && button("开始消除")!.disabled, "无接口默认样图提供流程入口，初始不选区、不自动消除");
    const initialId = baseId(), initialBlob = probe().assets.get(initialId).blob;
    const telemetry = JSON.stringify(readEraseTelemetry());
    engine.setTool("rect"); engine.updateShape({ color: "#ff0000", filled: true }); drag(200, 200, 500, 400);
    engine.setTool("text"); await engine.addText(); engine.setTool("erase"); await paint();
    const added = content();
    check(snapshot().objects.filter(object => object.editorPurpose !== "base").length === 2, "演示前保留独立文字和矩形内容");
    button("选择示例标签区域")!.click(); await paint();
    const selected = snapshot().masks[0], selectedDraft = draft(), selectionRevision = probe().revision;
    check(snapshot().masks.length === 1 && selected.kind === "rect" && selected.points[0].x === 1899 && selected.points[0].y === 1374 &&
      selected.points[1].x === 2790 && selected.points[1].y === 1725 && !probe().job && !probe().pending, "选择入口仅设置固定标签区域，不自动执行");
    button("选择示例标签区域")!.click(); await paint();
    check(probe().revision === selectionRevision && draft() === selectedDraft, "重复选择同一演示区域不增加历史或改变草稿");
    drag(100, 100, 160, 160); await paint(); const changedSelection = draft();
    await run(); await paint();
    check(!probe().job && !probe().pending && draft() === changedSelection && host.textContent!.includes("仅支持预设标签区域"), "自行改动选区时保留草稿并提示使用固定区域，不伪造对应消除结果");
    button("选择示例标签区域")!.click(); await paint();
    const readyDraft = draft(), readyRevision = probe().revision;
    sampleMode = "hold";
    const cancelled = run(); await waitFor(() => held.length === 1);
    check(probe().job?.stage === "waiting" && host.textContent!.includes("固定样图演示") && !!button("取消等待"), "演示使用原等待提示和取消入口，并持续标明固定样图");
    button("取消等待")!.click(); await paint();
    check(!probe().job && !probe().pending && draft() === readyDraft, "取消演示保留底图、独立内容和选区");
    sampleMode = "normal";
    const retry = run(); await waitFor(() => probe().job?.stage === "waiting");
    held.shift()!(); await cancelled;
    check(!!probe().job && !probe().pending, "旧演示迟到结果不覆盖新一轮等待");
    await retry; await waitFor(loaded);
    check(dialog()!.textContent!.includes("固定样图流程演示") && !!button("使用消除结果") && !!button("放弃结果") && !button("关闭示例"),
      "流程演示复用真实结果操作，明确标注模拟且支持使用或放弃");
    check(probe().pending?.region?.x === 1899 && probe().pending?.region?.width === 891, "流程预览定位实际预设选区，尺寸不变");
    dialog()!.dispatchEvent(new Event("cancel", { cancelable: true })); await paint();
    check(!!dialog()?.open && !!probe().pending, "流程预览 Esc 不直接放弃结果");
    const sampleCount = sampleRequests;
    host.querySelectorAll(".result-images img")[1].dispatchEvent(new Event("error")); await paint();
    button("重新加载预览")!.click(); await waitFor(loaded);
    check(sampleRequests === sampleCount && !!probe().pending?.illustrative, "预览图片重试复用本次结果，不重新读取样图或请求算法");
    button("放弃结果")!.click(); await paint();
    check(!probe().pending && !dialog() && draft() === readyDraft && probe().revision === readyRevision, "放弃示例结果保留原底图、内容、选区和历史");

    sampleMode = "fail"; await run(); await paint();
    check(!probe().pending && !probe().job && draft() === readyDraft && host.textContent!.includes("演示失败"), "样图加载失败保留草稿与重试条件，不自动重试");
    sampleMode = "normal"; await run(); await waitFor(loaded);
    const pending = probe().pending!, resultId = pending.assetId;
    const loadSnapshot = probe().loadSnapshot;
    try {
      probe().loadSnapshot = async () => { throw new Error("模拟采用失败"); };
      await engine.acceptResult(); await paint();
      check(!!probe().pending?.acceptError && !!probe().pending?.illustrative && draft() === readyDraft, "采用失败保留示例结果和原草稿，可单独重试采用");
    } finally { probe().loadSnapshot = loadSnapshot; }
    await engine.acceptResult(); await paint();
    check(baseId() === resultId && content() === added && !snapshot().masks.length && !probe().pending && !button("选择示例标签区域"),
      "采用更新底图并清空选区，独立文字和矩形保持可编辑，不重复提供已处理样图的消除流程");
    check(host.textContent!.includes("已使用示例结果") && host.textContent!.includes("未保存到任务"), "采用后明确只更新当前演示草稿");
    const composite = await renderDocument(snapshot(), probe().assets, "final"), jpeg = await validateJpeg(composite);
    const pixel = await pixelAt(composite, 350, 300);
    check(jpeg.width === 2910 && jpeg.height === 1800 && pixel[0] > 240 && pixel[1] < 15 && pixel[2] < 15,
      "采用后最终 JPG 保持 2910 × 1800，真实合成可见新增矩形");
    await engine.undo(); await paint();
    check(draft() === readyDraft && baseId() === initialId && !!button("选择示例标签区域"), "采用一步撤销恢复原底图、全部内容和预设选区，可重新演示");
    await engine.undo(true); await paint();
    check(baseId() === resultId && !snapshot().masks.length && content() === added, "重做恢复示例结果且不重复读取样图");
    await engine.undo(); await paint();
    engine.setAdjustments({ ...snapshot().adjustments, brightness: 20 }, true); await paint(); const adjusted = draft();
    engine.selectEraseExampleRegion(); await run(); await paint();
    check(!button("选择示例标签区域") && !probe().pending && draft() === adjusted, "已调色底图不套用固定结果，不能通过直接调用绕过保护");
    await engine.undo(); await paint();
    check(!!button("选择示例标签区域"), "撤销调色恢复固定样图流程入口");
    check(apiRequests === 0 && JSON.stringify(readEraseTelemetry()) === telemetry, "模拟等待、取消、失败、预览、采用及历史恢复均不请求业务接口或写真实消除统计");

    const upload = engine.uploadReplacement(new File([await picture("#123456", 2910, 1800)], "same-size.jpg", { type: "image/jpeg" }));
    await waitFor(() => !!probe().confirmation); engine.answerConfirmation(probe().confirmation!.id, true); await upload; await paint();
    engine.selectEraseExampleRegion();
    check(!button("选择示例标签区域") && !snapshot().masks.length && snapshot().source === "upload", "上传同尺寸图片也不冒用内置样图演示，不覆盖上传内容");

    const integration: EditorIntegration = { initialImage: initialBlob, context: { taskId: "erase-demo", imageId: "host-image" },
      validateTexts: async () => ({ passed: true }), replace: async () => ({ status: "pending" }),
      confirmResult: async () => ({ status: "pending" }), onClose: () => {} };
    await mount(integration); engine.selectEraseExampleRegion();
    check(!button("选择示例标签区域") && !snapshot().masks.length, "真实宿主即使提供相同样图也不能进入模拟消除");
    const explicitUrl = URL.createObjectURL(initialBlob);
    try {
      editorConfig.defaultImageUrl = explicitUrl; await mount();
      check(!button("选择示例标签区域"), "明确配置的初始图片优先，不自动视为内置样图");
    } finally { editorConfig.defaultImageUrl = ""; URL.revokeObjectURL(explicitUrl); }

    editorConfig.eraseApiUrl = "/__erase_demo_real_service__"; await mount();
    check(!button("选择示例标签区域") && !!button("查看消除结果示例"), "已配置真实算法时不显示模拟消除入口，仍可独立查看固定结果");
    engine.setEraseMode("rect"); drag(1899, 1374, 2790, 1725); await paint();
    const realDraft = draft(), priorSamples = sampleRequests; await run(); await paint();
    check(apiRequests === 1 && sampleRequests === priorSamples && !probe().pending && draft() === realDraft,
      "真实接口失败保留选区，不回退成固定样图结果");
  } finally {
    held.splice(0).forEach(release => release()); engine?.cancelTask();
    await Promise.allSettled(executions); root.unmount(); host.remove();
    EditorController.prototype.initialize = originalInitialize; window.fetch = originalFetch;
    editorConfig.eraseApiUrl = originalApi; editorConfig.defaultImageUrl = originalImage;
  }
}
