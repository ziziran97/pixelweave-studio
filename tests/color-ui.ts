import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { frame, picture, settle } from "./editing-tools";
import "../src/styles.css";

const reports: string[] = [];
const check = (value: boolean, message: string) => { if (!value) throw new Error(message); reports.push(`PASS ${message}`); };
const host = document.getElementById("test-root")!, root = createRoot(host);
const paint = async () => { await frame(); await frame(); };
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const dialog = () => document.querySelector<HTMLElement>(".color-popover-backdrop:not([hidden]) .color-popover");
const action = (text: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
const rows = () => [...host.querySelectorAll<HTMLElement>('.layer-card[data-purpose="content"]')];
const rowColor = (row: HTMLElement) => row.querySelector<HTMLElement>(".layer-color")!.style.backgroundColor;
const selected = () => host.querySelector<HTMLElement>(".layer-card.selected");
const mouse = (type: string, x: number, y: number) => {
  const canvas = host.querySelector<HTMLCanvasElement>(".upper-canvas")!, bounds = canvas.getBoundingClientRect();
  (type === "mousedown" || type === "mousemove" ? canvas : document).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true,
    button: 0, buttons: type === "mouseup" ? 0 : 1, clientX: bounds.left + bounds.width / 2 + x, clientY: bounds.top + bounds.height / 2 + y }));
};
const drag = async (x: number, y: number, endX: number, endY: number) => { mouse("mousedown", x, y); mouse("mousemove", endX, endY); mouse("mouseup", endX, endY); await paint(); };
const input = async (value: string, label = "HEX 颜色") => {
  const element = dialog()!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true })); await paint();
};
const format = async (value: string) => {
  const select = dialog()!.querySelector<HTMLSelectElement>('select[aria-label="颜色格式"]')!;
  select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); await paint();
};
const color = () => host.querySelector(".color-value")!.textContent;
const swatch = () => host.querySelector<HTMLElement>(".current-color-swatch")!.style.backgroundColor;
const esc = async (target: EventTarget = dialog()!) => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await paint(); };
try {
  root.render(createElement(App, { integration: {
    initialImage: await picture("#ffffff"), context: { taskId: "colors", imageId: "white" },
    validateTexts: async () => ({ passed: true as const }), replace: async () => ({ status: "failed" as const, message: "仅测试" }),
    confirmResult: async () => ({ status: "pending" as const }), onClose: () => {},
  } }));
  await settle(() => !!button("绘制") && !button("绘制").disabled);
  button("绘制").click(); await paint(); button("矩形").click(); await paint();
  check(swatch() === "rgb(37, 116, 216)", "自定义颜色入口直接显示当前新建样式颜色");
  button("自定义填充颜色").click(); await paint();
  check(!!dialog() && !host.querySelector('input[type="color"]') && document.activeElement === dialog(), "自定义颜色使用统一弹窗并接收键盘焦点");
  const bounds = dialog()!.getBoundingClientRect(), canvasBounds = host.querySelector(".upper-canvas")!.getBoundingClientRect();
  check(bounds.right <= canvasBounds.left && bounds.height < 420 && dialog()!.scrollWidth === dialog()!.clientWidth,
    "紧凑颜色面板优先落在属性栏中，不遮挡画布或横向溢出");
  await input("bad"); check(action("应用").disabled && dialog()!.textContent!.includes("6 位"), "无效 HEX 不允许应用且说明正确格式");
  await input("aBcDeF"); check(!action("应用").disabled && host.querySelector(".color-value")!.textContent === "#ABCDEF", "HEX 接受省略井号和混合大小写并实时预览");
  check(swatch() === "rgb(171, 205, 239)", "实时预览同步回显到入口色块");
  await format("RGB");
  check([...dialog()!.querySelectorAll<HTMLInputElement>('.color-inputs input')].map(input => input.value).join() === "171,205,239" && color() === "#ABCDEF", "切换 RGB 显示正确通道值且不改变颜色");
  for (const invalid of ["256", "-1", "2.5", ""]) {
    await input(invalid, "RGB R"); check(action("应用").disabled && color() === "#ABCDEF", `RGB 无效值 ${invalid || "空值"} 不改写预览`);
  }
  await input("18", "RGB R"); await input("52", "RGB G"); await input("86", "RGB B");
  check(color() === "#123456" && !action("应用").disabled, "RGB 输入按实际通道实时转换颜色");
  for (let i = 0; i < 3; i++) { await format("HSL"); await format("RGB"); await format("HEX"); }
  check(color() === "#123456" && dialog()!.querySelector<HTMLInputElement>('.color-hex input')!.value === "#123456", "反复切换格式不会因 HSL 显示舍入改变原色");
  await format("HSL"); await input("0", "HSL H"); await input("100", "HSL S"); await input("50", "HSL L");
  for (const [hue, expected] of [["0", "#FF0000"], ["120", "#00FF00"], ["240", "#0000FF"], ["360", "#FF0000"]]) {
    await input(hue, "HSL H"); check(color() === expected, `HSL 色相 ${hue} 正确转换为 ${expected}`);
  }
  await input("101", "HSL S"); check(action("应用").disabled && color() === "#FF0000", "HSL 超范围输入不改写颜色");
  await input("0", "HSL S"); await input("50", "HSL L"); check(color() === "#808080", "HSL 支持无饱和度的中性灰色");
  await input("20.5", "HSL L"); check(color() === "#343434", "HSL 小数明度可正确微调");
  await input("120", "HSL H"); await input("50", "HSL L");
  const draftState = () => JSON.stringify({
    fields: [...dialog()!.querySelectorAll<HTMLInputElement>('.color-inputs input')].map(input => input.value),
    hue: dialog()!.querySelector<HTMLInputElement>('.color-hue')!.value,
    pointer: dialog()!.querySelector('.color-sv i')!.getAttribute('style'),
    format: dialog()!.querySelector<HTMLSelectElement>('select')!.value,
  });
  const cancelSampling = async () => {
    const before = draftState(); action("取色").click(); await settle(() => !!host.querySelector(".picking-hint")); await paint();
    check(!document.querySelector('.color-popover')!.contains(document.activeElement), "取色时隐藏面板不占用键盘焦点");
    await esc(window); check(draftState() === before && document.activeElement === dialog(), "取消取色完整保留输入、格式、色相与色板位置并恢复焦点");
  };
  await cancelSampling();
  for (const [mode, label, invalid] of [["HEX", "HEX 颜色", "12"], ["RGB", "RGB R", ""], ["HSL", "HSL H", "361"]]) {
    await format(mode); await input(invalid, label); await cancelSampling();
    check(action("应用").disabled, `${mode} 未完成或无效输入在取消取色后保持原样`);
  }
  action("原颜色").click(); await paint();
  check(!!dialog() && !action("应用").disabled && color() === "#2574D8", "点击原颜色恢复预览并清除无效输入，保持面板打开");
  await format("HEX"); await input("123456");
  await esc(); check(!dialog() && button("撤销").disabled && host.querySelector(".color-value")!.textContent === "#2574D8", "Esc 取消新建颜色，不产生历史也不关闭编辑");
  button("填充颜色 #e34432").click(); await paint();
  await drag(-180, -110, -100, -40); await drag(30, -110, 110, -40);
  check(rows().length === 2 && !selected() && host.textContent!.includes("新矩形样式"), "连续拖动新增两个矩形并保持新建样式");
  const first = rows()[1], firstId = first.dataset.layerId, firstColor = rowColor(first);
  first.querySelector<HTMLButtonElement>(".layer-select")!.click(); await paint();
  check(swatch() === firstColor, "选中已有对象后入口回显该对象的实际颜色");
  button("自定义填充颜色").click(); await paint();
  await input("123456"); action("原颜色").click(); await paint();
  check(rowColor(selected()!) === firstColor && !!dialog(), "已有对象点击原颜色后仍可继续试色");
  await format("RGB"); await format("HSL"); await format("HEX"); action("应用").click(); await paint();
  button("撤销").click(); await settle(() => !button("绘制").disabled); await paint();
  check(rows().length === 1, "只切换颜色格式后应用不增加历史，撤销仍删除上一图形");
  button("重做").click(); await settle(() => !button("绘制").disabled); await paint();
  button("自定义填充颜色").click(); await paint(); await input("112233");
  check(rowColor(first) === "rgb(17, 34, 51)" && selected()?.dataset.layerId === firstId, "选中对象的颜色实时预览且保留选择");
  await format("RGB"); await input("52", "RGB B"); await format("HSL"); await format("HEX");
  await input("445566"); action("应用").click(); await paint();
  button("撤销").click(); await settle(() => !button("绘制").disabled); await paint();
  check(rowColor(rows().find(r => r.dataset.layerId === firstId)!) === firstColor && selected()?.dataset.layerId === firstId, "多次颜色修改应用后一次撤销全部恢复");
  button("自定义填充颜色").click(); await paint(); await input("123456");
  document.querySelector(".color-popover-backdrop")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })); await paint();
  check(!dialog() && rows().length === 2 && selected()?.dataset.layerId === firstId && rowColor(selected()!) === firstColor, "点击弹窗外取消预览，恢复原色并保持图层与选择");
  button("自定义填充颜色").click(); await paint(); await input("223344"); await format("RGB"); action("取色").click();
  await settle(() => !!host.querySelector(".picking-hint")); await paint();
  check(!dialog(), "弹窗内取色暂时收起颜色面板");
  mouse("mousemove", 180, 100); await paint();
  check(!!document.querySelector(".color-lens") && document.querySelector(".color-lens span")!.textContent === "#FFFFFF", "取色放大镜显示图内实际采样颜色");
  await esc(window);
  check(!!dialog() && dialog()!.querySelector<HTMLSelectElement>('select[aria-label="颜色格式"]')!.value === "RGB" &&
    [...dialog()!.querySelectorAll<HTMLInputElement>('.color-inputs input')].map(input => input.value).join() === "34,51,68", "Esc 只取消取色，保留此前颜色草稿和 RGB 格式");
  action("取色").click(); await settle(() => !!host.querySelector(".picking-hint"));
  mouse("mousedown", 180, 100); mouse("mouseup", 180, 100); await paint();
  check(!!dialog() && rowColor(selected()!) === "rgb(255, 255, 255)", "弹窗内取色回到草稿预览，等待应用");
  await input("300", "RGB R"); action("取色").click(); await settle(() => !!host.querySelector(".picking-hint"));
  mouse("mousedown", 180, 100); mouse("mouseup", 180, 100); await paint();
  check(!action("应用").disabled && [...dialog()!.querySelectorAll<HTMLInputElement>('.color-inputs input')].map(input => input.value).join() === "255,255,255",
    "成功采到与上次预览相同的颜色仍刷新无效输入，并保留 RGB 格式");
  action("原颜色").click(); await paint(); await input("80", "RGB R");
  action("取消").click(); await paint(); check(rowColor(selected()!) === firstColor, "取消颜色面板也撤回其中的取色预览");
  button("填充颜色取色").click(); await settle(() => !!host.querySelector(".picking-hint"));
  mouse("mousedown", 180, 100); mouse("mouseup", 180, 100); await paint();
  check(!dialog() && selected()?.dataset.layerId === firstId && rowColor(selected()!) === "rgb(255, 255, 255)" && rows().length === 2, "独立取色直接应用到原对象且不会丢失选择或误绘制");
  button("文字").click(); await paint(); button("自定义文字颜色").click(); await paint();
  check(dialog()?.getAttribute("aria-label") === "自定义文字颜色", "文字颜色复用相同自定义面板");
  await esc();
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally { document.getElementById("results")!.textContent = reports.join("\n"); }
