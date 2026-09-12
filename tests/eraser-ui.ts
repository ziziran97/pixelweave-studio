import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { EraserPanel } from "../src/components/EraserPanel";
import { ResultPreview } from "../src/components/ResultPreview";
import { EraserNotice } from "../src/components/EraserNotice";
import type { PendingResult } from "../src/types";
import { createEditor, frame, picture, settle } from "./editing-tools";
import { toBlob } from "../src/editor/assets";
import { editorConfig } from "../src/config";
import "../src/styles.css";

const reports: string[] = [];
function check(value: boolean, message: string) { if (!value) throw new Error(message); reports.push(`PASS ${message}`); }
const host = document.getElementById("test-root")!;
const root = createRoot(host);
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const paint = async () => { await frame(); await frame(); };
const editorTest = createEditor();
const configUrl = editorConfig.eraseApiUrl;
const size = { width: 1600, height: 1000 };
const urls: string[] = [];
try {
  host.style.width = "268px";
  await editorTest.editor.openImage(await picture(), "界面检查", false);
  const panel = async () => {
    root.render(createElement(EraserPanel, { view: editorTest.state(), engine: editorTest.editor, locked: false, execute: () => {} }));
    await paint();
  };
  editorTest.editor.setEraseMode("rect"); await panel();
  check(host.textContent!.includes("松手前按住空格可移动选框"), "框选提示直接说明空格移动选框");
  check(button("按住隐藏选区").disabled && host.textContent!.includes("先选择需要消除的区域"), "无选区时查看按钮禁用，并说明如何启用消除");
  check(!host.querySelector(".erase-base-hint"), "没有新增内容时不显示底图隔离提示");
  editorTest.editor.setTool("select"); await panel();
  check(host.textContent!.includes("正在选择对象") && host.textContent!.includes("暂无选区") && !host.querySelector(".erase-submit") && !host.querySelector(".erase-mode-grid"), "无选区切到选择展示模式、返回入口和设置摘要，不堆放禁用操作");
  button("返回消除笔").click(); await panel();
  check(editorTest.state().tool === "erase" && editorTest.state().eraseMode === "rect" && !editorTest.state().hasMask && !editorTest.state().task, "无选区返回恢复原方式，不新增选区或自动消除");
  editorTest.drag(20, 20, 100, 100); await panel();
  check(!button("按住隐藏选区").disabled, "完成选区后可按住隐藏选区");
  const modeKey = (value: string) => editorTest.editor.canvas.upperCanvasEl.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
  modeKey("x"); await panel();
  check(host.querySelector(".mask-subtract")!.getAttribute("aria-pressed") === "true" && host.querySelector<HTMLButtonElement>(".mask-subtract")!.title.includes("X") &&
    host.querySelector(".mask-add")!.getAttribute("aria-keyshortcuts") === "X", "X 切到减去时按钮同步高亮并显示快捷键提示");
  modeKey("x"); await panel();
  check(host.querySelector(".mask-add")!.getAttribute("aria-pressed") === "true", "再次 X 返回添加，面板即时同步");
  const mainView = JSON.stringify(editorTest.editor.canvas.viewportTransform), mainMasks = editorTest.state().masks;
  check(modeKey("r") && JSON.stringify(editorTest.editor.canvas.viewportTransform) === mainView && editorTest.state().masks === mainMasks,
    "主画布 R 不拦截按键、不定位或修改消除选区");
  const submit = host.querySelector<HTMLButtonElement>(".erase-submit")!;
  check(submit.title.includes("Ctrl+Enter") && submit.title.includes("⌘+Enter") && submit.getAttribute("aria-keyshortcuts") === "Control+Enter Meta+Enter", "开始消除入口提示 Windows／Mac 快捷键");
  const peek = button("按住隐藏选区");
  peek.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
  check(editorTest.state().maskHidden, "面板查看按钮支持按住空格隐藏遮罩");
  peek.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true, cancelable: true }));
  check(!editorTest.state().maskHidden && editorTest.state().hasMask, "松开空格恢复遮罩，选区不丢失");
  peek.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  window.dispatchEvent(new Event("blur"));
  check(!editorTest.state().maskHidden && editorTest.state().hasMask, "查看时窗口失焦恢复遮罩");
  editorTest.editor.setMaskOperation("subtract"); await panel();
  check(!!host.querySelector(".erase-subtract-hint"), "减去模式按需解释操作对象");
  editorTest.editor.setEraseMode("brush"); editorTest.editor.setBrushSize(87);
  const savedMasks = JSON.stringify(editorTest.state().masks), savedViewport = JSON.stringify(editorTest.editor.canvas.viewportTransform);
  for (const mode of ["select", "pan"] as const) {
    editorTest.editor.setTool(mode); await panel();
    check(host.textContent!.includes(mode === "pan" ? "正在平移画布" : "正在选择对象") && host.textContent!.includes("87 px") && host.textContent!.includes("减去") && host.textContent!.includes("已保留") && !host.querySelector(".erase-mode-hint"), `${mode} 模式摘要保留笔刷、选区操作和选区状态，不显示过时绘制提示`);
    button("返回消除笔").click(); await panel();
    check(editorTest.state().tool === "erase" && editorTest.state().eraseMode === "brush" && editorTest.state().brushSize === 87 && editorTest.state().maskOperation === "subtract" && JSON.stringify(editorTest.state().masks) === savedMasks && JSON.stringify(editorTest.editor.canvas.viewportTransform) === savedViewport && !editorTest.state().task, `${mode} 返回完整保留消除设置、选区和视野，不自动发起消除`);
  }
  editorTest.editor.setEraseMode("rect");
  editorTest.editor.setMaskOperation("add"); await panel();
  check(!host.querySelector(".erase-subtract-hint"), "返回添加模式收起减去说明");
  editorTest.editor.setTool("rect"); editorTest.drag(120, 80, 180, 130);
  editorTest.editor.setEraseMode("lasso"); editorTest.click(40, 40); await panel();
  check(host.textContent!.includes("至少添加三个点") && host.textContent!.includes("撤销上一点"), "套索不足三点时提供下一步及撤销入口");
  editorTest.click(100, 40); editorTest.click(100, 100); await panel();
  check(host.textContent!.includes("点击起点或按 Enter 闭合"), "套索可闭合时提示 Enter 快捷操作");
  check(!host.querySelector("#erase-submit-hint") && !host.querySelector(".erase-submit")!.hasAttribute("aria-describedby"), "套索提示不重复且不引用隐藏说明");
  check(!!host.querySelector(".erase-base-hint"), "存在新增内容时提示其已保留");
  editorTest.editor.setEraseMode("rect");
  editorTest.editor.setCompare(true); await panel();
  check(editorTest.state().compareOriginal && !host.querySelector(".erase-base-hint"), "查看初始图片时收起底图隔离提示");
  editorTest.editor.setCompare(false);
  editorConfig.eraseApiUrl = ""; await editorTest.editor.executeErase();
  check(editorTest.state().noticePresentation === "persistent" && editorTest.state().notice.includes("图片和选区已保留"), "服务未接入时保留选区并持续显示原因");
  const clock = Date.now, startedAt = clock();
  try {
    Date.now = () => startedAt + 17500;
    const notice = async (stage: "preparing" | "waiting" | "preview", since = startedAt) => {
      root.render(createElement(EraserNotice, { view: { ...editorTest.state(), task: true, eraseStage: stage, eraseStageStartedAt: since, notice: "处理中" }, cancelTask: () => {} }));
      await paint();
    };
    await notice("waiting");
    check(host.textContent!.includes("已等待 17 秒"), "服务等待超过十秒显示实际已等待时间");
    await notice("preview");
    check(!host.querySelector(".erase-elapsed"), "结果返回后不继续累计服务等待时间");
    await notice("waiting", Date.now());
    check(!host.querySelector(".erase-elapsed"), "新请求重新计时，不继承上次等待秒数");
    await notice("preparing");
    check(!host.querySelector(".erase-elapsed"), "准备阶段不显示服务等待秒数");
  } finally { Date.now = clock; }
  editorTest.dispose(); root.render(null); await paint(); host.style.width = "auto";

  // Exercise the real request -> dialog -> editor transition while Space is held.
  // A keyup owned by the dialog must not leave the canvas in temporary pan mode.
  const originalFetch = window.fetch;
  try {
    editorConfig.eraseApiUrl = "/__eraser_keyboard__";
    const output = await picture("#008844", 128, 96);
    window.fetch = async (url, options) => url === editorConfig.eraseApiUrl ? new Response(output) : originalFetch(url, options);
    for (const useResult of [false, true]) {
      const fixture = createEditor(), { editor, state, drag, dispose } = fixture;
      const label = useResult ? "使用结果" : "放弃结果";
      const space = (target: EventTarget, type: "keydown" | "keyup", repeat = false) => target.dispatchEvent(new KeyboardEvent(type, {
        key: " ", code: "Space", bubbles: true, cancelable: true, repeat,
      }));
      const viewport = () => JSON.stringify(editor.canvas.viewportTransform);
      try {
        await editor.openImage(await picture("#123456", 128, 96), "空格状态恢复", false);
        editor.setEraseMode("rect"); drag(10, 10, 40, 30);
        const beforePan = viewport(), beforeMasks = state().masks;
        space(editor.canvas.upperCanvasEl, "keydown"); drag(50, 40, 55, 43);
        check(viewport() !== beforePan && state().masks === beforeMasks, `${label}：请求前按住空格可正常临时平移，保留选区`);
        const eraseTask = editor.executeErase();
        const eraseKey = () => {
          const event = new KeyboardEvent("keydown", { key: "e", bubbles: true, cancelable: true });
          editor.canvas.upperCanvasEl.dispatchEvent(event); return event.defaultPrevented;
        };
        check(!eraseKey(), `${label}：请求准备期间 E 不切换工具`);
        await eraseTask;
        const pending = state().pending!;
        check(!eraseKey() && state().pending === pending, `${label}：等待采用的结果不被 E 绕过`);
        let finished: Promise<void> | undefined;
        const finish = (use: boolean) => {
          finished = (async () => {
            if (use) await editor.acceptResult(); else editor.discardResult();
            root.render(null);
          })();
        };
        root.render(createElement(ResultPreview, { result: pending, size: state().size, busy: false,
          accept: () => finish(true), discard: () => finish(false), retryPreview: () => {} }));
        await settle(() => !!host.querySelector<HTMLButtonElement>(".result-footer .primary-button") && !host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled);
        const previewDialog = host.querySelector<HTMLDialogElement>("dialog")!;
        const backgroundView = viewport(), backgroundMasks = state().masks;
        for (const key of ["1", "f", "r", "c", "x"]) {
          previewDialog.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); await paint();
        }
        check(viewport() === backgroundView && state().masks === backgroundMasks && !state().compareOriginal && state().pending === pending,
          `${label}：结果弹窗 F／1／R 不改变背景画布和选区，C／X 不穿透或处理待采用结果`);
        previewDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        const cancel = new Event("cancel", { cancelable: true }); previewDialog.dispatchEvent(cancel);
        check(cancel.defaultPrevented && previewDialog.open && state().pending === pending && !state().confirmation,
          `${label}：结果弹窗仍隔离 Esc，不放弃结果或触发关闭编辑`);
        const action = host.querySelector<HTMLButtonElement>(`.result-footer .${useResult ? "primary" : "secondary"}-button`)!;
        space(action, "keyup"); action.click(); await finished; await paint();
        const afterResult = viewport(), savedMasks = state().masks;
        // Auto-repeat from the old press must not reactivate temporary pan either.
        space(editor.canvas.upperCanvasEl, "keydown", true); drag(60, 50, 85, 75);
        check(!state().pending && state().tool === "erase" && state().masks === savedMasks + 1 && viewport() === afterResult,
          `${label}：在弹窗内松开空格后可直接继续选区，残留重复按键不触发平移`);
        const completedMasks = state().masks;
        space(editor.canvas.upperCanvasEl, "keydown"); drag(50, 40, 55, 43); space(editor.canvas.upperCanvasEl, "keyup");
        check(viewport() !== afterResult && state().masks === completedMasks, `${label}：再次按住空格仍可正常临时平移，松手保留选区`);
        editor.canvas.upperCanvasEl.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true, cancelable: true }));
        drag(50, 40, 58, 46); editor.zoomTo(state().zoom * 1.2);
        const inspectedView = viewport(), history = (editor as unknown as { history: { index: number } }).history.index;
        check(eraseKey() && state().tool === "erase" && state().eraseMode === "rect" && state().masks === completedMasks && viewport() === inspectedView &&
          (editor as unknown as { history: { index: number } }).history.index === history && !state().pending && !state().task,
          `${label}：H 平移放大查看后 E 返回原消除方式，保留选区、视野和历史`);
        drag(90, 60, 110, 80);
        check(state().masks === completedMasks + 1 && viewport() === inspectedView, `${label}：E 返回后可直接继续创建消除选区`);
      } finally { root.render(null); await paint(); dispose(); }
    }
  } finally { window.fetch = originalFetch; editorConfig.eraseApiUrl = configUrl; }

  // Fixed detail-rich images exercise zoom/pan; these are not simulated AI results.
  for (const label of ["消除前 · 固定样图", "消除后 · 固定样图"]) {
    const canvas = document.createElement("canvas"); Object.assign(canvas, size);
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#eef4fa"; ctx.fillRect(0, 0, size.width, size.height);
    ctx.strokeStyle = "#aabbd0";
    for (let x = 0; x < size.width; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.height); ctx.stroke(); }
    for (let y = 0; y < size.height; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.width, y); ctx.stroke(); }
    ctx.fillStyle = "#2574d8"; ctx.fillRect(600, 300, 400, 400);
    ctx.fillStyle = "#ffffff"; ctx.font = "24px sans-serif"; ctx.fillText("商品细节 ABC 123", 660, 480);
    ctx.fillStyle = "#233348"; ctx.font = "36px sans-serif"; ctx.fillText(label, 70, 80);
    urls.push(URL.createObjectURL(await toBlob(canvas, "image/jpeg", .94)));
  }
  const result = { assetId: "fixture", beforeUrl: urls[0], afterUrl: urls[1], documentId: "fixture", revision: 0, region: { x: 80, y: 70, width: 120, height: 40 } };
  let accepted = 0, discarded = 0, regenerated = 0;
  const previewSignals: Array<{ outcome: string; attempt: number }> = [];
  const show = (busy = false, key = "check", acceptError?: string, changes: Partial<PendingResult> = {}) => root.render(createElement(ResultPreview, { key, result: { ...result, acceptError, ...changes }, size, busy,
    accept: () => { accepted++; root.render(null); }, discard: () => { discarded++; root.render(null); }, retryPreview: () => { regenerated++; },
    onPreviewState: (outcome, attempt) => { previewSignals.push({ outcome, attempt }); } }));
  show();
  await settle(() => !!host.querySelector<HTMLButtonElement>(".result-footer .primary-button") && !host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled);
  const images = () => [...host.querySelectorAll<HTMLImageElement>(".result-images img")];
  check(previewSignals.some(signal => signal.outcome === "shown" && signal.attempt === 0), "两张预览实际加载成功后通知埋点入口");
  const aligned = () => images()[0].style.cssText === images()[1].style.cssText;
  const pane = () => host.querySelector<HTMLDivElement>(".result-viewport")!;
  const previewKey = (value: string, extra: KeyboardEventInit = {}, node: EventTarget = pane()) => {
    const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra });
    node.dispatchEvent(event); return event.defaultPrevented;
  };
  check(aligned() && parseFloat(images()[0].style.width) <= pane().clientWidth + 1, "初始左右适配显示且保持同一位置");
  const fittedWidth = images()[0].width;
  button("查看本次消除区域").click(); await paint();
  const imageBounds = images()[0].getBoundingClientRect(), paneBounds = pane().getBoundingClientRect(), scale = images()[0].width / size.width;
  check(images()[0].width > fittedWidth && aligned() && imageBounds.left + result.region.x * scale >= paneBounds.left &&
    imageBounds.top + result.region.y * scale >= paneBounds.top && imageBounds.left + (result.region.x + result.region.width) * scale <= paneBounds.right &&
    imageBounds.top + (result.region.y + result.region.height) * scale <= paneBounds.bottom, "消除区域定位到边角选区并保留周边，两侧同步且不改原图尺寸");
  const regionStyle = images()[0].style.cssText, regionBefore = JSON.stringify(result.region);
  button("适配对比图片").click(); await paint();
  check(images()[0].width === fittedWidth && aligned(), "局部查看后仍可一键返回整图适配");
  check(previewKey("r"), "结果预览 R 被弹窗自身处理"); await paint();
  check(images()[0].style.cssText === regionStyle && aligned() && JSON.stringify(result.region) === regionBefore && !accepted && !discarded &&
    button("查看本次消除区域").getAttribute("aria-keyshortcuts") === "R" && button("查看本次消除区域").parentElement!.textContent!.includes("（R）"),
    "R 与按钮定位到同一区域及周边，左右同步、提示一致，不修改选区或采用／放弃结果");
  previewKey("f"); await paint(); previewKey("1"); await paint(); previewKey("R"); await paint();
  check(images()[0].style.cssText === regionStyle && aligned(), "F 回看整图、1 查看细节后，R 可再次准确定位消除区域");
  check(previewKey("r"), "再次 R 仍可定位同一区域"); await paint();
  check(images()[0].style.cssText === regionStyle && !accepted && !discarded, "重复单次 R 保持视野稳定且不处理结果");
  previewKey("f"); await paint();
  button("100% 查看对比图片").click(); await paint();
  check(images()[0].width === size.width && aligned(), "100% 按图片原尺寸展示，两侧同步");
  const actualStyle = images()[0].style.cssText;
  check(previewKey("f"), "结果预览 F 被弹窗自身处理"); await paint();
  check(images()[0].width === fittedWidth && aligned(), "结果预览 F 与适配按钮显示相同整图");
  check(previewKey("1"), "结果预览 1 被弹窗自身处理"); await paint();
  check(images()[0].style.cssText === actualStyle && aligned() && button("适配对比图片").getAttribute("aria-keyshortcuts") === "F" &&
    button("100% 查看对比图片").getAttribute("aria-keyshortcuts") === "1" && !accepted && !discarded, "预览 1 与按钮显示相同细节，两侧同步且不采用或放弃结果");
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) {
    const before = images()[0].style.cssText;
    check(["f", "1", "r"].every(key => !previewKey(key, extra)), "结果预览 F／1／R 保留组合键并忽略重复或组词"); await paint();
    check(images()[0].style.cssText === before, "受限按键不改变结果查看位置");
  }
  for (const kind of ["input", "menu", "slider"]) {
    const control = document.createElement(kind === "input" ? "input" : "div"); control.setAttribute("role", kind);
    host.querySelector("dialog")!.append(control);
    check(["f", "1", "r"].every(key => !previewKey(key, {}, control)), "结果预览输入或控件保留自己的按键"); control.remove();
  }
  const otherDialog = document.createElement("dialog"); document.body.append(otherDialog); otherDialog.showModal();
  check(["f", "1", "r"].every(key => !previewKey(key)), "另一个弹窗打开时不操作下层结果预览"); otherDialog.close(); otherDialog.remove();
  const capture = pane().setPointerCapture; pane().setPointerCapture = () => {};
  pane().dispatchEvent(new PointerEvent("pointerdown", { pointerId: 41, button: 0, buttons: 1, bubbles: true }));
  check(["f", "1", "r"].every(key => !previewKey(key)), "结果拖动尚未松手时 F／1／R 不打断查看手势");
  pane().dispatchEvent(new PointerEvent("pointerup", { pointerId: 41, button: 0, bubbles: true })); pane().setPointerCapture = capture;
  check(!previewKey("c") && !previewKey("x") && !previewKey("Enter", { ctrlKey: true }) && !accepted && !discarded, "结果预览不响应主画布 C／X，也不通过 Ctrl+Enter 采用结果");
  const initial = images()[0].style.transform;
  pane().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); await paint();
  check(images()[0].style.transform !== initial && aligned(), "键盘平移同步两侧视图");
  const rect = pane().getBoundingClientRect(), anchor = { x: 160, y: 120 };
  const pointAt = () => { const matrix = new DOMMatrix(getComputedStyle(images()[0]).transform), scale = images()[0].width / size.width; return { x: (anchor.x - matrix.m41) / scale, y: (anchor.y - matrix.m42) / scale }; };
  const beforeZoom = pointAt();
  const wheel = new WheelEvent("wheel", { deltaY: -100, clientX: rect.left + anchor.x, clientY: rect.top + anchor.y, bubbles: true, cancelable: true });
  pane().dispatchEvent(wheel); await paint();
  const afterZoom = pointAt();
  check(wheel.defaultPrevented && aligned() && Math.abs(beforeZoom.x - afterZoom.x) < 1 && Math.abs(beforeZoom.y - afterZoom.y) < 1, "滚轮围绕指针缩放，阻止页面滚动且两侧对齐");
  button("适配对比图片").click(); await paint();
  check(parseFloat(images()[0].style.width) <= pane().clientWidth + 1 && aligned(), "适配恢复整图查看");
  const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
  dialog.style.width = "650px"; await paint(); await paint();
  check(parseFloat(images()[0].style.width) <= pane().clientWidth + 1 && aligned(), "窗口尺寸变化后适配和左右同步保持");
  show(true); await paint();
  check(["f", "1", "r"].every(key => !previewKey(key)), "采用结果过程中查看快捷键不生效");
  button("100% 查看对比图片").click();
  dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  check(button("100% 查看对比图片").disabled && discarded === 0 && accepted === 0, "采用处理中禁止查看操作及 Esc 放弃");
  show(false, "check", "暂时无法使用结果，图片和选区已保留。可重试使用，无需重新消除。"); await paint();
  check(!!host.querySelector("dialog [role=alert]") && host.querySelector(".result-footer .primary-button")!.textContent === "重试使用结果", "采用失败在弹窗内显示错误并提供重试入口");
  const oldImages = images(), sources = oldImages.map(image => image.src);
  images()[1].dispatchEvent(new Event("error")); await paint();
  check(["f", "1", "r"].every(key => !previewKey(key)), "预览加载失败时不通过快捷键调整未就绪图片");
  check(previewSignals.at(-1)?.outcome === "failed", "预览图片加载错误通知失败，不冒充算法失败");
  check(host.textContent!.includes("消除结果已保留") && host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled, "预览失败保留结果并禁止采用未加载图片");
  host.querySelector<HTMLButtonElement>(".result-recovery button")!.click(); await paint();
  await settle(() => !host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled);
  oldImages[1].dispatchEvent(new Event("error")); await paint();
  check(previewSignals.at(-1)?.outcome === "shown" && previewSignals.at(-1)?.attempt === 1, "重新加载成功后报告当前尝试，旧图片事件不反写埋点");
  check(images().every((image, index) => image !== oldImages[index] && image.src === sources[index]) && !host.querySelector(".result-recovery") && accepted === 0 && discarded === 0,
    "重新加载沿用原预览地址，旧图片事件不干扰重试且不采用或放弃结果");
  images()[0].dispatchEvent(new Event("error")); await paint();
  host.querySelector<HTMLButtonElement>(".result-recovery button")!.click();
  await settle(() => !host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled);
  check(!host.querySelector(".result-recovery"), "预览再次失败仍可重新加载");
  host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.click(); await paint();
  check(accepted === 1 && !host.querySelector("dialog"), "使用结果只触发采用回调，不执行业务保存");
  show(false, "discard"); await paint(); host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); await paint();
  check(discarded === 0 && !!host.querySelector<HTMLDialogElement>("dialog")?.open, "Esc 保留结果弹窗，不触发放弃");
  host.querySelector<HTMLButtonElement>(".result-footer .secondary-button")!.click(); await paint();
  check(discarded === 1 && !host.querySelector("dialog"), "只有点击放弃结果才关闭弹窗并放弃结果");
  const recovery = { beforeUrl: "", afterUrl: "", previewError: "对比图片生成失败，消除结果已保留。可重新生成预览，无需重新消除。" };
  show(false, "generation", undefined, recovery); await paint();
  check(!previewKey("r"), "预览尚未生成时 R 不定位未就绪图片");
  check(!images().length && host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled && host.textContent!.includes("无需重新消除"), "预览生成失败不请求空图片地址，并禁止采用未生成的预览");
  host.querySelector<HTMLButtonElement>(".result-recovery button")!.click(); await paint();
  check(regenerated === 1 && accepted === 1 && discarded === 1, "重新生成预览仅触发恢复，不采用或放弃结果");
  show(false, "generation", undefined, { ...recovery, previewPreparing: true }); await paint();
  check(host.querySelector<HTMLButtonElement>(".result-recovery button")!.disabled && host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled &&
    !host.querySelector<HTMLButtonElement>(".result-footer .secondary-button")!.disabled, "预览重新生成期间防止重复操作，仍可明确放弃结果");
  show(false, "generation");
  await settle(() => !host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled);
  check(aligned() && pane().clientWidth > 0 && !host.querySelector(".result-recovery"), "重新生成成功后恢复图片加载、同步查看与采用");
  show(false, "generation", undefined, { region: undefined }); await paint();
  const noRegionStyle = images()[0].style.cssText;
  check(button("查看本次消除区域").disabled && !previewKey("r"), "缺少区域信息时按钮与 R 均不可用，不猜测定位位置"); await paint();
  check(images()[0].style.cssText === noRegionStyle && accepted === 1 && discarded === 1, "缺少区域时 R 保持查看位置和结果决策不变");
  root.render(null); await paint();
  const preview = document.getElementById("preview")!; preview.hidden = false;
  preview.onclick = () => show(false, `preview-${Date.now()}`);
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally {
  editorConfig.eraseApiUrl = configUrl;
  document.getElementById("results")!.textContent = reports.join("\n");
}
window.addEventListener("pagehide", () => urls.forEach(url => URL.revokeObjectURL(url)), { once: true });
