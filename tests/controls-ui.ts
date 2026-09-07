import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { frame, settle } from "./editing-tools";
import "../src/styles.css";

const reports: string[] = [];
const check = (value: boolean, message: string) => { if (!value) throw new Error(message); reports.push(`PASS ${message}`); };
const host = document.getElementById("test-root")!;
const root = createRoot(host);
const paint = async () => { await frame(); await frame(); };
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const zoom = () => host.querySelector("output[aria-label='当前缩放比例']")!.textContent;
const viewport = () => host.querySelector<HTMLElement>(".canvas-viewport")!;
try {
  root.render(createElement(App));
  await settle(() => !!button("收起图层") && !button("收起图层").disabled);
  check(!host.querySelector(".top-actions")!.textContent!.includes("上传") && host.querySelector(".top-right .upload-button")!.textContent === "上传本地图片", "上传入口移至右上角，名称明确本地来源");
  check(host.querySelector(".top-right .upload-button")!.getAttribute("aria-describedby") !== null && host.querySelector(".top-right")!.textContent!.includes("暂不替换任务图片"), "上传说明区分载入草稿和提交任务");
  check(host.querySelectorAll(".canvas-controls .zoom-control > [role=group]").length === 4, "底部操作按模式、缩放、对比、图层分组");
  check([...host.querySelectorAll(".top-actions button")].map(item => item.getAttribute("aria-label")).join("/") === "撤销/重做/还原初始/按住查看原图" && [...host.querySelectorAll(".top-actions button")].every(item => !item.textContent), "左上角按顺序显示四个纯图标按钮");
  check(button("100% 查看").textContent === "100%" && !!button("按住查看原图").querySelector("svg") && !button("按住查看原图").textContent && !button("收起图层").textContent, "对比和图层仅用图标，100% 保留数字");
  const width = viewport().clientWidth, initialZoom = zoom();
  button("收起图层").click(); await paint();
  check(getComputedStyle(host.querySelector(".layers-panel")!).display === "none" && viewport().clientWidth > width && zoom() === initialZoom, "收起图层实际释放空间，适配状态下也保持缩放比例");
  button("绘制").click(); await paint();
  check(!!button("展开图层"), "切换工具不自动展开图层");
  button("文字").click(); await paint();
  const canvas = host.querySelector<HTMLCanvasElement>(".upper-canvas")!, bounds = canvas.getBoundingClientRect();
  for (const type of ["mousedown", "mouseup"]) (type === "mousedown" ? canvas : document).dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === "mousedown" ? 1 : 0,
    clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
  }));
  await settle(() => !!host.querySelector(".layer-card.selected[data-purpose=content]"));
  check(!!button("展开图层"), "新增文字不自动展开图层");
  const selectedLayer = host.querySelector(".layer-card.selected");
  button("展开图层").click(); await paint();
  check(viewport().clientWidth === width && zoom() === initialZoom && host.querySelector(".layer-card.selected") === selectedLayer, "展开恢复空间且保持文字选中状态");
  button("100% 查看").click(); await paint();
  button("收起图层").click(); await paint();
  check(zoom() === "100%", "实际尺寸查看时收起也不重新适配");
  const compare = button("按住查看原图");
  const held = () => compare.getAttribute("aria-pressed") === "true";
  const key = (type: string, value: string, repeat = false) => compare.dispatchEvent(new KeyboardEvent(type, { key: value, repeat, bubbles: true, cancelable: true }));
  compare.click(); await paint();
  check(!held(), "单击不会锁定原图查看状态");
  key("keydown", " "); await paint();
  check(held() && host.querySelector(".original-badge")!.textContent!.includes("松开返回编辑") && zoom() === "100%", "按住空格立即查看原图，同尺寸保持缩放并提示松开返回");
  const lowerCompare = host.querySelector<HTMLButtonElement>(".canvas-controls button[aria-label='按住查看原图']")!;
  check(lowerCompare.getAttribute("aria-pressed") === "true", "左上角按住查看时右下角入口同步高亮");
  key("keydown", " ", true); await paint();
  check(held(), "长按产生的重复按键不切换状态");
  button("展开图层").click(); await paint();
  key("keyup", " "); await paint();
  check(zoom() === "100%" && !host.querySelector(".original-badge"), "对比期间切换图层后仍可恢复编辑缩放");
  lowerCompare.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await paint();
  check(held() && lowerCompare.getAttribute("aria-pressed") === "true", "右下角入口也可开始查看，两处状态一致");
  lowerCompare.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true })); await paint();
  check(!held() && lowerCompare.getAttribute("aria-pressed") === "false", "右下角松开后两处同步恢复");
  key("keydown", "Enter"); await paint();
  key("keyup", " "); await paint();
  check(held(), "无关按键松开不会结束 Enter 查看");
  key("keyup", "Enter"); await paint();
  check(!held(), "松开 Enter 恢复编辑");
  key("keydown", "Enter"); await paint(); window.dispatchEvent(new Event("blur")); await paint();
  check(!held(), "窗口失焦自动恢复编辑");
  compare.focus(); key("keydown", " "); await paint(); compare.blur(); await paint();
  check(!held(), "按钮失焦自动恢复编辑");
  // DOM-dispatched pointer events do not create native pointers; capture itself is checked manually in-browser.
  const capture = compare.setPointerCapture; compare.setPointerCapture = () => {};
  const pointer = (target: EventTarget, type: string, id = 7, mouseButton = 0, buttons = 0) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, button: mouseButton, buttons, bubbles: true, cancelable: true }));
  try {
    pointer(compare, "pointerdown", 7, 0, 1); await paint();
    check(held(), "鼠标按下立即显示原图");
    pointer(window, "pointerup", 8); pointer(window, "pointerup", 7, 2, 1); await paint();
    check(held(), "其他指针或右键松开不会结束左键查看");
    pointer(window, "pointerup"); await paint();
    check(!held(), "移出按钮后松手恢复编辑");
    pointer(compare, "pointerdown", 7, 0, 1); await paint(); pointer(window, "pointercancel"); await paint();
    check(!held(), "指针取消恢复编辑");
    pointer(compare, "pointerdown", 7, 0, 1); await paint(); pointer(compare, "lostpointercapture"); await paint();
    check(!held(), "丢失指针捕获恢复编辑");
  } finally { compare.setPointerCapture = capture; }
  button("收起图层").focus(); await paint();
  check(getComputedStyle(button("收起图层").parentElement!.querySelector("[role=tooltip]")!).visibility === "visible", "图标按钮键盘聚焦时显示提示");
  host.style.width = "1000px"; await paint();
  const group = host.querySelector<HTMLElement>(".canvas-zoom-controls")!, zoomButtons = [...group.querySelectorAll("button")];
  check(zoomButtons.every(item => item.getBoundingClientRect().top === zoomButtons[0].getBoundingClientRect().top), "较窄空间中缩放组完整保留在同一行");
  const controls = host.querySelector<HTMLElement>(".canvas-controls")!.getBoundingClientRect();
  check([...host.querySelectorAll<HTMLElement>(".zoom-control button")].every(item => { const box = item.getBoundingClientRect(); return box.left >= controls.left && box.right <= controls.right; }), "较窄画布的操作按钮不溢出");
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally { document.getElementById("results")!.textContent = reports.join("\n"); }
