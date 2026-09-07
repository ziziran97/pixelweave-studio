import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { EraserPanel } from "../src/components/EraserPanel";
import { ResultPreview } from "../src/components/ResultPreview";
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
  editorTest.dispose(); root.render(null); await paint(); host.style.width = "auto";

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
  const result = { assetId: "fixture", beforeUrl: urls[0], afterUrl: urls[1], documentId: "fixture", revision: 0 };
  let accepted = 0, discarded = 0;
  const show = (busy = false, key = "check", acceptError?: string) => root.render(createElement(ResultPreview, { key, result: { ...result, acceptError }, size, busy,
    accept: () => { accepted++; root.render(null); }, discard: () => { discarded++; root.render(null); } }));
  show();
  await settle(() => !!host.querySelector<HTMLButtonElement>(".result-footer .primary-button") && !host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled);
  const images = () => [...host.querySelectorAll<HTMLImageElement>(".result-images img")];
  const aligned = () => images()[0].style.cssText === images()[1].style.cssText;
  const pane = () => host.querySelector<HTMLDivElement>(".result-viewport")!;
  check(aligned() && parseFloat(images()[0].style.width) <= pane().clientWidth + 1, "初始左右适配显示且保持同一位置");
  button("100% 查看对比图片").click(); await paint();
  check(images()[0].width === size.width && aligned(), "100% 按图片原尺寸展示，两侧同步");
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
  button("100% 查看对比图片").click();
  dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  check(button("100% 查看对比图片").disabled && discarded === 0 && accepted === 0, "采用处理中禁止查看操作及 Esc 放弃");
  show(false, "check", "暂时无法使用结果，图片和选区已保留。可重试使用，无需重新消除。"); await paint();
  check(!!host.querySelector("dialog [role=alert]") && host.querySelector(".result-footer .primary-button")!.textContent === "重试使用结果", "采用失败在弹窗内显示错误并提供重试入口");
  const oldImages = images(), sources = oldImages.map(image => image.src);
  images()[1].dispatchEvent(new Event("error")); await paint();
  check(host.textContent!.includes("消除结果已保留") && host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled, "预览失败保留结果并禁止采用未加载图片");
  host.querySelector<HTMLButtonElement>(".result-recovery button")!.click(); await paint();
  await settle(() => !host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!.disabled);
  oldImages[1].dispatchEvent(new Event("error")); await paint();
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
  const preview = document.getElementById("preview")!; preview.hidden = false;
  preview.onclick = () => show(false, `preview-${Date.now()}`);
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally {
  editorConfig.eraseApiUrl = configUrl;
  document.getElementById("results")!.textContent = reports.join("\n");
}
window.addEventListener("pagehide", () => urls.forEach(url => URL.revokeObjectURL(url)), { once: true });
