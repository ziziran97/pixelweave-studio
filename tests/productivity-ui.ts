import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { checkProductivity } from "./productivity";
import { frame, picture, settle } from "./editing-tools";
import "../src/styles.css";

const reports: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
  reports.push(`PASS ${message}`); document.getElementById("results")!.textContent = reports.join("\n") + "\n运行中…";
};
const host = document.getElementById("test-root")!, root = createRoot(host);
document.getElementById("results")!.style.cssText = "position:fixed;bottom:0;left:0;max-height:100px;overflow:auto;z-index:2;background:white";
const paint = async () => { await frame(); await frame(); };
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const row = () => host.querySelector<HTMLElement>(".layer-card.selected")!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"][aria-label="图层快捷操作"]');
const command = (label: string) => document.querySelector<HTMLButtonElement>(`.layer-context-menu button[aria-label="${label}"]`)!;
const ready = async () => { await settle(() => !!button("文字") && !button("文字").disabled); await paint(); };
const input = async (label: string, value: string) => {
  const element = field(label); element.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true })); await paint(); return element;
};
const openMenu = async () => {
  const target = row(), bounds = target.getBoundingClientRect();
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: bounds.left + 40, clientY: bounds.top + 20 });
  target.dispatchEvent(event); await paint(); return event;
};
try {
  await checkProductivity(check);
  root.render(createElement(App, { integration: { initialImage: await picture(), context: { taskId: "productivity", imageId: "image" }, validateTexts: async () => ({ passed: true as const }),
    replace: async () => ({ status: "failed" as const, message: "测试结束" }), confirmResult: async () => ({ status: "pending" as const }), onClose: () => {} } }));
  await ready(); button("文字").click(); await paint(); button("添加文字").click(); await ready();
  const selectedId = row().dataset.layerId;
  const size = await input("字号", "150");
  check(!button("撤销").disabled && !size.disabled, "字号有效输入立即进入预览，输入框保持可编辑");
  const canvas = host.querySelector<HTMLCanvasElement>("canvas.upper-canvas")!, bounds = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, clientX: bounds.left + 3, clientY: bounds.top + 3 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: bounds.left + 3, clientY: bounds.top + 3 })); await paint();
  host.querySelector<HTMLButtonElement>(`[data-layer-id="${selectedId}"] .layer-select`)!.click(); await paint();
  check(field("字号").value === "150", "输入字号后直接点击画布，再选原图层仍保留输入结果");
  button("撤销").click(); await ready(); const before = field("字号").value;
  const numeric = await input("字号", "80"); await input("字号", "120");
  numeric.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await paint();
  check(field("字号").value === before && document.activeElement === numeric, "同一轮输入Esc还原最初数值并保留焦点");
  numeric.blur();
  const last = Number(field("字号").value); const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
  field("字号").dispatchEvent(wheel); await paint();
  check(Number(field("字号").value) === last && !wheel.defaultPrevented, "未聚焦数字框不拦截滚轮或误改数值");
  field("字号").focus(); const focusedWheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
  field("字号").dispatchEvent(focusedWheel); await paint();
  check(Number(field("字号").value) === last + 1 && focusedWheel.defaultPrevented, "聚焦且位于数字框上方的滚轮立即微调并阻止画布缩放");
  field("字号").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await paint();
  host.querySelector<HTMLDetailsElement>(".text-effects")!.open = true; await paint();
  const opacity = await input("不透明度", "12.7"); opacity.blur(); await paint();
  check(field("不透明度").value === "13", "整数属性结束输入后回显实际归一化值，不遗留与画布不同的小数");
  const keyboardCount = host.querySelectorAll(".layer-card").length;
  const keyboard = async (key: string) => {
    row().focus(); const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
    row().dispatchEvent(event); await ready(); return event;
  };
  check((await keyboard("c")).defaultPrevented && host.querySelectorAll(".layer-card").length === keyboardCount,
    "实际图层快捷键Ctrl+C记录内容且不创建对象");
  await keyboard("d"); await keyboard("v");
  check(host.querySelectorAll(".layer-card").length === keyboardCount + 2 && field("不透明度").value === "13",
    "Ctrl+D与Ctrl+V各创建副本并保留复制时的属性");
  const count = host.querySelectorAll(".layer-card").length;
  const contextEvent = await openMenu();
  check(contextEvent.defaultPrevented && !!menu() && !command("粘贴").disabled, "已选图层右键展示快捷菜单，并回显已有复制记录");
  command("复制").click(); await paint();
  check(!menu() && host.querySelectorAll(".layer-card").length === count, "菜单复制只记录内容并关闭，不直接增加图层");
  await openMenu(); check(!command("粘贴").disabled, "复制后右键菜单启用粘贴");
  command("粘贴").click(); await ready();
  check(host.querySelectorAll(".layer-card").length === count + 1 && row().dataset.layerId !== selectedId, "菜单粘贴创建独立图层并选中新副本");
  const copyId = row().dataset.layerId;
  await openMenu(); command("调整层级").click(); await paint();
  check(!!document.querySelector('[aria-label="调整图层层级"]') && command("置顶").disabled && !command("置底").disabled,
    "层级子菜单按真实位置禁用边界操作");
  command("置底").click(); await paint();
  const rows = [...host.querySelectorAll<HTMLElement>(".layer-card")];
  check(rows.at(-2)!.dataset.layerId === copyId && rows.at(-1)!.dataset.purpose === "base", "菜单置底只排在新增内容底部，底图仍固定最下层");
  await openMenu(); const oldId = row().dataset.layerId;
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await paint();
  check(!menu() && row().dataset.layerId === oldId, "Esc仅关闭图层菜单，不取消选择");
  await openMenu(); const outside = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }); canvas.dispatchEvent(outside); await paint();
  check(!menu() && outside.defaultPrevented && row().dataset.layerId === oldId, "菜单外首次点击只关闭菜单，不穿透画布操作");
  row().focus(); row().dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })); await paint();
  check(!!menu(), "图层行支持Shift+F10打开菜单");
  command("锁定图层").click(); await paint();
  check(!host.querySelector(".layer-card.selected") && host.querySelector(`[data-layer-id="${oldId}"]`)!.textContent!.includes("已锁定"), "菜单锁定沿用取消对应选择与保留工作区规则");
  document.getElementById("results")!.textContent = reports.join("\n") + `\n\n全部通过，共 ${reports.length} 项`;
} catch (error) { document.getElementById("results")!.textContent = reports.join("\n") + `\nFAIL ${(error as Error).stack}`; }
