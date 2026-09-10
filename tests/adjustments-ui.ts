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
const panel = () => host.querySelector<HTMLElement>(".adjustment-panel")!;
const number = (label: string) => host.querySelector<HTMLInputElement>(`input[type=number][aria-label="${label}"]`)!;
const action = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
const input = async (field: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true })); await paint();
};
const editNumber = async (label: string, value: string, finish: "Enter" | "Escape" | "blur" = "Enter") => {
  const field = number(label); field.focus(); await input(field, value);
  if (finish === "blur") field.blur();
  else field.dispatchEvent(new KeyboardEvent("keydown", { key: finish, bubbles: true, cancelable: true }));
  await paint();
};
const range = async (label: string, values: number[], finish: "pointerup" | "keyup" | "blur" = "pointerup") => {
  const field = host.querySelector<HTMLInputElement>(`input[type=range][aria-label="${label}滑块"]`)!;
  field.focus();
  for (const value of values) await input(field, String(value));
  if (finish === "pointerup") window.dispatchEvent(new PointerEvent("pointerup"));
  else if (finish === "keyup") field.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
  else field.blur();
  await paint();
};
const undo = async (redo = false) => { button(redo ? "重做" : "撤销").click(); await settle(() => !button("调色").disabled); await paint(); };
try {
  root.render(createElement(App, { integration: {
    initialImage: await picture("#6080a0"), context: { taskId: "adjustments", imageId: "sample" },
    validateTexts: async () => ({ passed: true as const }), replace: async () => ({ status: "failed" as const, message: "仅测试" }),
    confirmResult: async () => ({ status: "pending" as const }), onClose: () => {},
  } }));
  await settle(() => !!button("调色") && !button("调色").disabled);
  button("调色").click(); await paint();
  check([...panel().querySelectorAll('section[aria-label], details')].map(item => item.getAttribute('aria-label') ?? '颜色叠加').join() === "基础调节,滤镜,颜色叠加", "面板按基础调节、滤镜、颜色叠加排列");
  check(panel().querySelectorAll('section[aria-label="基础调节"] input[type=number]').length === 5 && !panel().textContent!.includes("模糊"), "五项基础调节齐全，移除模糊入口");
  check(!panel().querySelector('details')!.open && button("滤镜：无滤镜").getAttribute("aria-pressed") === "true" && action("重置调色", host).disabled, "初始无任何效果，叠加折叠、无滤镜、重置禁用");
  await settle(() => panel().querySelectorAll('.filter-thumbnail img').length === 9);
  check(getComputedStyle(panel().querySelector('.filter-grid')!).gridTemplateColumns.split(' ').length === 3, "九个选项使用三列当前底图缩略图");
  await editNumber("亮度", "15"); check(number("亮度").value === "15", "数字回车应用亮度");
  await editNumber("亮度", "45", "Escape");
  check(number("亮度").value === "15" && document.activeElement === number("亮度") && !host.querySelector('dialog[open]'), "Esc 取消数字草稿、保留焦点且不关闭编辑");
  number("亮度").blur(); await paint(); await undo(); check(number("亮度").value === "0", "取消数字草稿不增加历史，撤销回到零");
  await range("色温", [10, 20, 35]); await undo(); check(number("色温").value === "0", "滑块连续拖动一次撤销");
  await undo(true); check(number("色温").value === "35", "重做回显色温数值");
  await range("色温", [40, 45], "keyup"); await undo(); check(number("色温").value === "35", "键盘连续调整在松键时结束历史");
  await range("锐化", [15, 40], "blur"); await undo(); check(number("锐化").value === "0", "滑块失焦也完整收尾");
  panel().querySelector<HTMLElement>('summary')!.click(); await paint();
  await range("叠加强度", [10, 25]);
  button("自定义叠加颜色").click(); await paint();
  let dialog = document.querySelector<HTMLElement>('.color-popover')!;
  check(!!dialog && button("调色").disabled, "颜色叠加复用现有自定义颜色面板");
  const hex = dialog.querySelector<HTMLInputElement>('.color-hex input')!;
  await input(hex, "#223344");
  check(panel().querySelector('.color-value')!.textContent === "#223344", "叠加颜色输入实时回显");
  action("取消", dialog).click(); await paint();
  check(panel().querySelector('.color-value')!.textContent === "#FFFFFF" && number("叠加强度").value === "25", "取消颜色面板还原原色，保留叠加强度");
  button("自定义叠加颜色").click(); await paint(); dialog = document.querySelector<HTMLElement>('.color-popover')!;
  await input(dialog.querySelector<HTMLInputElement>('.color-hex input')!, "#887744"); action("应用", dialog).click(); await paint();
  await undo(); check(panel().querySelector('.color-value')!.textContent === "#FFFFFF" && number("叠加强度").value === "25", "确认颜色一步撤销，强度不回退");
  button("滤镜：清透").click(); await paint(); await editNumber("滤镜强度", "55");
  button("滤镜：暖阳").click(); await paint();
  check(number("色温").value === "35" && number("叠加强度").value === "25" && number("滤镜强度").value === "55", "切换滤镜保留基础调节、叠加及强度");
  button("滤镜：无滤镜").click(); await paint();
  check(!number("滤镜强度") && number("色温").value === "35" && number("叠加强度").value === "25", "无滤镜只取消滤镜，隐藏无效强度控件");
  action("取消叠加", host).click(); await paint(); check(number("叠加强度").value === "0" && number("色温").value === "35", "取消叠加只清除叠加强度");
  button("滤镜：柔和").click(); await paint(); action("重置调色", host).click(); await paint();
  check(number("色温").value === "0" && button("滤镜：无滤镜").getAttribute("aria-pressed") === "true", "重置调色一起清除基础、叠加与滤镜");
  await undo(); check(number("色温").value === "35" && button("滤镜：柔和").getAttribute("aria-pressed") === "true", "一次撤销恢复重置前整套调色");
  button("重置色温").click(); await paint();
  check(number("色温").value === "0" && button("滤镜：柔和").getAttribute("aria-pressed") === "true", "单项复位仅恢复对应参数，不清除滤镜");
  await undo(); check(number("色温").value === "35", "单项复位可以一步撤销");
  const beforeCompare = host.querySelector<HTMLInputElement>('input[aria-label="色温"]')!.value;
  const hold = button("按住查看调色前"); hold.focus();
  for (const finish of ["keyup", "blur", "hidden"] as const) {
    hold.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })); await paint();
    check(hold.getAttribute("aria-pressed") === "true" && !hold.disabled && number("色温").matches(":disabled"), `调色前按住查看生效且保持入口可松开（${finish}）`);
    if (finish === "keyup") window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    else if (finish === "blur") window.dispatchEvent(new Event("blur"));
    else { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); delete (document as unknown as { hidden?: boolean }).hidden; }
    await paint(); check(hold.getAttribute("aria-pressed") === "false" && number("色温").value === beforeCompare, `松开或离开页面恢复调色且参数不变（${finish}）`);
  }
  host.style.width = "1000px"; host.style.height = "600px"; await paint();
  check(panel().scrollWidth <= panel().clientWidth && [...panel().querySelectorAll('input, .filter-option')].every(item => item.getBoundingClientRect().right <= panel().getBoundingClientRect().right + 1), "紧凑布局的数字控件和滤镜无横向溢出");
  const scroll = host.querySelector<HTMLElement>('.panel-content')!; scroll.scrollTop = scroll.scrollHeight; await paint();
  check(action("重置调色", host).getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom + 1, "窄矮窗口仍可滚动到重置操作");
  button("收起工具属性").click(); await paint(); await undo();
  check(getComputedStyle(host.querySelector('.settings-panel')!).display === "none", "撤销调色不自动展开已收起属性栏");
  button("调色").click(); await paint();
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally { document.getElementById("results")!.textContent = reports.join("\n"); }
