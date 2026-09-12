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
const menuKey = async (target: HTMLElement, options: KeyboardEventInit = {}) => {
  target.focus();
  const event = new KeyboardEvent("keydown", { key: "X", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event); await paint(); return event;
};
const dismissMenu = async () => {
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await paint();
};
try {
  await checkProductivity(check);
  root.render(createElement(App, { integration: { initialImage: await picture(), context: { taskId: "productivity", imageId: "image" }, validateTexts: async () => ({ passed: true as const }),
    replace: async () => ({ status: "failed" as const, message: "测试结束" }), confirmResult: async () => ({ status: "pending" as const }), onClose: () => {} } }));
  await ready();
  const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
  const emptyCanvas = host.querySelector<HTMLCanvasElement>("canvas.upper-canvas")!;
  for (const options of [{}, { key: "F10", ctrlKey: false }, { key: "ContextMenu", ctrlKey: false, shiftKey: false }]) {
    check((await menuKey(viewport, options)).defaultPrevented && !menu(), "无选择时菜单按键被编辑区接管，不弹浏览器或图层菜单");
  }
  const blankContext = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
  emptyCanvas.dispatchEvent(blankContext); await paint();
  check(blankContext.defaultPrevented && !menu(), "空白画布右键不提供误导性的浏览器另存为与复制图片菜单");
  const baseContext = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
  host.querySelector('[data-purpose="base"]')!.dispatchEvent(baseContext); await paint();
  check(baseContext.defaultPrevented && !menu(), "底图行无可用选择时也拦截浏览器原生菜单");
  button("文字").click(); await paint(); button("添加文字").click(); await ready();
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
  check(!(await menuKey(numeric)).defaultPrevented && !menu(), "数字输入时Ctrl+Shift+X不打开图层菜单");
  check(!(await menuKey(numeric, { key: "F10", ctrlKey: false })).defaultPrevented && !menu(), "数字输入时保留Shift+F10的原生编辑菜单用法");
  const inputContext = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
  numeric.dispatchEvent(inputContext);
  check(!inputContext.defaultPrevented, "输入框右键保留原生编辑菜单");
  numeric.blur();
  const last = Number(field("字号").value); const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
  field("字号").dispatchEvent(wheel); await paint();
  check(Number(field("字号").value) === last && !wheel.defaultPrevented, "未聚焦数字框不拦截滚轮或误改数值");
  field("字号").focus(); const focusedWheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
  field("字号").dispatchEvent(focusedWheel); await paint();
  check(Number(field("字号").value) === last + 1 && focusedWheel.defaultPrevented, "聚焦且位于数字框上方的滚轮立即微调并阻止画布缩放");
  field("字号").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await paint();
  const sizeKey = async (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
    field("字号").dispatchEvent(event); await paint(); return event;
  };
  await input("字号", "32.4"); await sizeKey("Enter");
  check(field("字号").value === "32.4" && field("字号").validity.valid, "小数字号保留且不被原生整数步长判为无效");
  button("增大字号").click(); await paint();
  check(field("字号").value === "33.4" && document.activeElement === field("字号"), "字号步进按钮加1保留小数并保持输入焦点");
  check((await sizeKey("ArrowDown")).defaultPrevented && field("字号").value === "32.4", "字号上下键与步进按钮相反操作可恢复原小数");
  field("字号").dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })); await paint();
  check(field("字号").value === "33.4", "小数字号滚轮同样加1，不对齐整数");
  button("减小字号").click(); await paint();
  check(field("字号").value === "32.4", "字号向下步进减1并保留小数");
  await sizeKey("ArrowUp"); await sizeKey("ArrowUp", { repeat: true }); await sizeKey("Enter");
  check(field("字号").value === "34.4", "字号上下键支持长按重复，回车保留最终小数");
  button("撤销").click(); await ready();
  check(field("字号").value === "32.4" && row().dataset.layerId === selectedId, "混合按钮、滚轮及方向键连续调整只需一步撤销，保留选中文字");
  button("重做").click(); await ready();
  check(field("字号").value === "34.4", "重做恢复整轮字号微调");
  button("增大字号").click(); await paint(); await sizeKey("Escape");
  check(field("字号").value === "34.4" && document.activeElement === field("字号"), "步进后Esc还原起点并保留焦点");
  const nativeSpacing = field("字距");
  check(nativeSpacing.step === "0.1" && field("行距").step === "0.05" && !button("增大字距"), "仅字号启用相对步进，字距和行距保留原生步长");
  for (const [start, name, end] of [["499.75", "增大字号", "500"], ["8.25", "减小字号", "8"]]) {
    await input("字号", start); await sizeKey("Enter");
    button(name).click(); await paint(); button(name).click(); await paint();
    check(field("字号").value === end, "小数字号在范围边缘限制到真实上下限，重复步进不越界");
    await sizeKey("Escape");
    check(field("字号").value === start, "边界步进取消后恢复原小数");
  }
  await input("字号", "32.4"); await sizeKey("Enter");
  await input("字号", ""); button("增大字号").click(); await paint();
  check(field("字号").value === "33.4", "空字号草稿按最后有效字号继续微调");
  await sizeKey("Escape");
  // Pointer capture requires real browser input; suppress it only for this synthetic hold lifecycle.
  const holdButton = button("增大字号"), capture = holdButton.setPointerCapture;
  holdButton.setPointerCapture = () => {};
  const hold = () => holdButton.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 9, isPrimary: true, bubbles: true, cancelable: true }));
  try {
    hold(); await new Promise(resolve => setTimeout(resolve, 510)); await paint();
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9 }));
    const heldSize = field("字号").value;
    check(Number(heldSize) >= 34.4 && Math.abs(Number(heldSize) % 1 - .4) < .00001, "长按步进连续改变字号且保留小数");
    await new Promise(resolve => setTimeout(resolve, 130)); await paint();
    check(field("字号").value === heldSize, "松手后停止步进，不残留计时修改");
    await sizeKey("Escape");
    check(field("字号").value === "32.4", "长按后Esc整轮还原");
    hold(); window.dispatchEvent(new Event("blur")); await paint();
    await new Promise(resolve => setTimeout(resolve, 450)); await paint();
    check(field("字号").value === "33.4", "窗口失焦收尾并停止长按");
    field("字号").blur(); button("撤销").click(); await ready();
    check(field("字号").value === "32.4", "失焦收尾的长按可一步撤销");
  } finally { holdButton.setPointerCapture = capture; window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 9 })); }
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
  check((await menuKey(row(), { key: "F10", ctrlKey: false })).defaultPrevented && !menu(), "已选图层上的旧Shift+F10不再打开任一菜单");
  for (const options of [{ shiftKey: false }, { altKey: true }, { isComposing: true }]) {
    check(!(await menuKey(row(), options)).defaultPrevented && !menu(), "不完整组合、Alt组合及输入法组词不触发图层菜单");
  }
  check((await menuKey(row(), { repeat: true })).defaultPrevented && !menu(), "长按重复不反复打开图层菜单");
  check((await menuKey(row())).defaultPrevented && !!menu(), "图层行支持Ctrl+Shift+X打开菜单");
  const rowBox = row().getBoundingClientRect(), menuBox = menu()!.getBoundingClientRect();
  check(Math.abs(menuBox.top - Math.max(8, Math.min(rowBox.top + rowBox.height / 2, innerHeight - menuBox.height - 8))) < 1,
    "键盘从图层行打开菜单时贴近该行并在窗口边缘避让");
  await dismissMenu();
  check(document.activeElement === row(), "键盘菜单关闭后返回对应图层行焦点");
  check((await menuKey(viewport)).defaultPrevented && !!menu(), "画布支持Ctrl+Shift+X打开当前选择的菜单");
  const canvasMenuX = menu()!.getBoundingClientRect().left;
  check(Math.abs(canvasMenuX - (viewport.getBoundingClientRect().left + 20)) > 40, "画布快捷菜单定位在对象附近，不固定在容器左上角");
  await dismissMenu();
  check(document.activeElement === viewport, "画布键盘菜单关闭后恢复画布焦点");
  const zoom = Number(host.querySelector('[aria-label="当前缩放比例"]')!.textContent!.replace("%", "")) / 100;
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }));
  viewport.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })); await paint();
  await menuKey(viewport);
  check(Math.abs(menu()!.getBoundingClientRect().left - canvasMenuX - zoom * 10) < 1, "移动对象后快捷菜单锚点同步移动，不复用旧坐标");
  await dismissMenu();
  check((await menuKey(row(), { ctrlKey: false, metaKey: true })).defaultPrevented && !!menu(), "兼容Command+Shift+X且不改变所选图层");
  await dismissMenu();
  const unselected = host.querySelector<HTMLElement>('.layer-card:not(.selected)[data-purpose="content"]')!;
  check((await menuKey(unselected)).defaultPrevented && !menu() && row().dataset.layerId === oldId, "未选中图层行的快捷键不切换选择或弹出浏览器菜单");
  const unselectedContext = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
  unselected.dispatchEvent(unselectedContext); await paint();
  check(unselectedContext.defaultPrevented && !menu() && row().dataset.layerId === oldId, "右键未选中图层不打开原生菜单，也不切换原有选择");
  button("平移").click(); await paint();
  check((await menuKey(viewport)).defaultPrevented && !menu(), "平移状态下不打开菜单或泄漏到浏览器默认行为");
  button("选择").click(); await paint();
  const layerKey = async (key: string, extra: KeyboardEventInit = {}, target: HTMLElement = viewport) => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra })); await paint();
  };
  const layerIds = () => [...host.querySelectorAll<HTMLElement>('.layer-card[data-purpose="content"]')].map(item => item.dataset.layerId);
  await layerKey("ArrowUp", { shiftKey: true });
  check(layerIds()[0] === oldId && button("置顶").disabled && button("上移一层").disabled, "Ctrl+Shift+↑置顶后图层列表及按钮边界同步");
  await layerKey("ArrowDown", { shiftKey: true });
  check(layerIds().at(-1) === oldId && button("置底").disabled && button("下移一层").disabled, "Ctrl+Shift+↓置底后仍保留在底图上方，并同步禁用向下按钮");
  await openMenu(); command("调整层级").click(); await paint();
  check(document.querySelector('[role="menu"][aria-label="调整图层层级"]')!.textContent!.includes("Ctrl+Shift+↑"), "右键层级子菜单展示排序快捷键");
  await layerKey("ArrowUp", {}, document.activeElement as HTMLElement);
  check(!menu() && layerIds().at(-2) === oldId && row().dataset.layerId === oldId, "层级子菜单内Ctrl+↑执行上移并关闭菜单，保留选择");
  await openMenu(); const repeatedOrder = layerIds().join();
  await layerKey("ArrowDown", { repeat: true }, document.activeElement as HTMLElement);
  check(!!menu() && layerIds().join() === repeatedOrder, "菜单中的重复组合键不连续排序"); await dismissMenu();
  button("收起工具属性")?.click(); await paint(); button("收起图层")?.click(); await paint();
  const allZoom = host.querySelector('[aria-label="当前缩放比例"]')!.textContent;
  const selectableCount = host.querySelectorAll('.layer-card[data-purpose="content"] .layer-select:not(:disabled)').length;
  await layerKey("a");
  check(host.querySelectorAll(".layer-card.selected").length === selectableCount && selectableCount > 1 &&
    getComputedStyle(host.querySelector(".settings-panel")!).display === "none" && getComputedStyle(host.querySelector(".layers-panel")!).display === "none" &&
    host.querySelector('[aria-label="当前缩放比例"]')!.textContent === allZoom, "Ctrl+A全选保持两个面板收起及原缩放");
  check(["置顶", "上移一层", "下移一层", "置底"].every(label => button(label).disabled), "全选形成多选后禁用四个排序按钮");
  await menuKey(viewport);
  check(!command(`复制所选 ${selectableCount} 个图层`).disabled && !command(`创建所选 ${selectableCount} 个图层副本`).disabled &&
    command("调整层级").disabled && command("隐藏图层").disabled && command("锁定图层").disabled, "多选菜单开放整批复制与创建副本，排序显隐锁定保持原范围");
  command(`复制所选 ${selectableCount} 个图层`).click(); await paint();
  await menuKey(viewport); const batchCount = layerIds().length;
  command("粘贴").click(); await settle(() => layerIds().length === batchCount + selectableCount); await ready();
  check(host.querySelectorAll(".layer-card.selected").length === selectableCount && getComputedStyle(host.querySelector(".settings-panel")!).display === "none" &&
    getComputedStyle(host.querySelector(".layers-panel")!).display === "none", "菜单粘贴整批选中新副本并保留两个面板收起状态");
  button("撤销").click(); await ready(); check(layerIds().length === batchCount, "菜单整批粘贴一步撤销");
  await layerKey("a"); await menuKey(viewport);
  await layerKey("d", {}, document.activeElement as HTMLElement); await settle(() => layerIds().length === batchCount + selectableCount); await ready();
  check(!menu() && host.querySelectorAll(".layer-card.selected").length === selectableCount, "多选菜单Ctrl+D创建完整批次并关闭菜单");
  button("撤销").click(); await ready();
  button("展开图层").click(); await paint();
  host.querySelector<HTMLButtonElement>(`[data-layer-id="${oldId}"] .layer-select`)!.click(); await paint();
  button("操作帮助").click(); await paint();
  const helpText = host.querySelector(".shortcut-help-dialog")!.textContent!;
  const helpLabels = [...host.querySelectorAll(".shortcut-list dt")].map(item => item.textContent);
  check(helpText.includes("全选可编辑图层") && helpText.includes("Ctrl+A") && helpText.includes("Ctrl+Shift+↓") &&
    ["全选可编辑图层", "上移 / 下移一层", "置顶 / 置底"].every(label => helpLabels.filter(item => item === label).length === 1),
    "帮助以全选一行及排序两行展示新增快捷键");
  button("关闭操作帮助").click(); await paint();
  await menuKey(row());
  command("锁定图层").click(); await paint();
  check(!host.querySelector(".layer-card.selected") && host.querySelector(`[data-layer-id="${oldId}"]`)!.textContent!.includes("已锁定"), "菜单锁定沿用取消对应选择与保留工作区规则");
  document.getElementById("results")!.textContent = reports.join("\n") + `\n\n全部通过，共 ${reports.length} 项`;
} catch (error) { document.getElementById("results")!.textContent = reports.join("\n") + `\nFAIL ${(error as Error).stack}`; }
