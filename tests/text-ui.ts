import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { checkTextEditing } from "./text-editing";
import { checkTextOpacity } from "./text-opacity";
import { checkTextBackgroundOpacity } from "./text-background-opacity";
import { checkTextLayout } from "./text-layout";
import { checkJapaneseText } from "./japanese-text";
import { checkJapaneseLayout } from "./japanese-layout";
import { FONT_FAMILY, JP_FONT_FAMILY } from "../src/editor/fonts";
import { frame, picture, settle } from "./editing-tools";
import "../src/styles.css";

const reports: string[] = [];
const check = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
  reports.push(`PASS ${message}`);
  document.getElementById("results")!.textContent = `${reports.join("\n")}\n运行中…`;
};
const host = document.getElementById("test-root")!, root = createRoot(host);
const paint = async () => { await frame(); await frame(); };
const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const ready = async () => {
  // Let React publish the pending state, including disabled inherited from the fieldset.
  await paint();
  await settle(() => !!button("添加文字") && !button("添加文字").matches(":disabled"));
  await paint();
};
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const number = async (name: string, value: string, end: string) => {
  const element = field(name); element.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true })); await paint();
  element.dispatchEvent(new KeyboardEvent("keydown", { key: end, bubbles: true, cancelable: true }));
  if (end === "Escape") check(document.activeElement === element, "Esc 取消数值时保留输入框焦点");
  element.blur(); await ready();
};
const weight = async (value: string, family = FONT_FAMILY) => {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="字体"]')!;
  select.value = `${family}:${value}`; select.dispatchEvent(new Event("change", { bubbles: true })); await ready();
};
const alignment = () => host.querySelector<HTMLSelectElement>('select[aria-label="对齐"]')!;
const toggle = async (label: string) => { [...host.querySelectorAll<HTMLLabelElement>(".text-properties .check-field")].find(item => item.textContent === label)!.querySelector<HTMLInputElement>("input")!.click(); await ready(); };
const align = async (value: string) => {
  alignment().value = value; alignment().dispatchEvent(new Event("change", { bubbles: true })); await ready();
};
try {
  await checkTextEditing(check);
  await checkJapaneseText(check);
  await checkJapaneseLayout(check);
  await checkTextLayout(check);
  await checkTextOpacity(check);
  await checkTextBackgroundOpacity(check);
  root.render(createElement(App, { integration: { initialImage: await picture(), context: { taskId: "ui", imageId: "image" },
    validateTexts: async () => ({ passed: true as const }), replace: async () => ({ status: "failed" as const, message: "测试" }),
    confirmResult: async () => ({ status: "pending" as const }), onClose: () => {} } }));
  await settle(() => !!button("文字") && !button("文字").disabled); button("文字").click(); await ready();
  check(!!field("字距") && !!field("行距") && alignment().options.length === 4, "字距行距使用文字标签，对齐下拉提供四种选项");
  check(button("竖版").disabled && host.querySelectorAll('[aria-label="文字样式"] button').length === 5, "五个样式按钮同行，新文字预设禁用竖版操作");
  check(!host.querySelector('input[accept*="woff"]') && host.querySelectorAll('select[aria-label="字体"] optgroup').length === 2, "拉丁与日文按两个字体家族分组，没有任意字体上传入口");
  await number("字距", "2", "Enter"); await number("字号", "60", "Enter");
  check(field("字距").value === "2" && button("撤销").disabled, "新文字字号改变仍保持像素字距，不记历史");
  await number("字号", "98", "Escape"); check(field("字号").value === "60", "Esc 后立即失焦不应用已取消字号");
  check(!field("背景不透明度"), "背景关闭时不堆放背景不透明度控件");
  await toggle("背景填充"); check(field("背景不透明度").value === "100", "开启文字背景默认100%不透明");
  await number("背景不透明度", "45", "Enter");
  check(button("撤销").disabled, "面板设置新文字背景不透明度不记历史");
  button("添加文字").click(); await ready();
  check(field("背景不透明度").value === "45", "新增文字采用面板背景不透明度预设");
  check(!!document.querySelector('textarea[data-fabric="textarea"]') && host.textContent!.includes("当前文字属性"), "添加进入画布输入并切换当前文字属性");
  check(!button("修改文字"), "正在输入时隐藏重复的修改文字入口");
  await weight("300"); button("加粗").click(); await ready(); button("加粗").click(); await ready();
  check(host.querySelector<HTMLSelectElement>('select[aria-label="字体"]')!.value === `${FONT_FAMILY}:300`, "面板加粗再次点击恢复 Light");
  button("斜体").click(); await ready(); await weight("900");
  check(button("斜体").disabled && button("斜体").getAttribute("aria-pressed") === "false", "选择 Black 清除斜体并禁用 I");
  await weight("500"); button("斜体").click(); await ready();
  await weight("500", JP_FONT_FAMILY);
  check(button("斜体").disabled && button("斜体").getAttribute("aria-pressed") === "false", "拉丁斜体切换日文时取消斜体并禁用I");
  check(host.querySelectorAll('optgroup[label="阿里巴巴普惠体日文"] option').length === 3, "日文字体仅提供Regular、Medium、Bold三个真实字重");
  button("加粗").click(); await ready(); button("加粗").click(); await ready();
  check(host.querySelector<HTMLSelectElement>('select[aria-label="字体"]')!.value === `${JP_FONT_FAMILY}:500`, "日文Medium加粗后再次点击恢复Medium，保留日文字体");
  await weight("700", JP_FONT_FAMILY); button("加粗").click(); await ready();
  check(host.querySelector<HTMLSelectElement>('select[aria-label="字体"]')!.value === `${JP_FONT_FAMILY}:400`, "直接选择日文Bold清除旧恢复记录，取消加粗回Regular");
  await weight("400");
  check(!button("斜体").disabled && button("斜体").getAttribute("aria-pressed") === "false", "切回拉丁字体恢复I入口，不自动恢复已取消的斜体");
  button("斜体").click(); await ready(); await weight("400", JP_FONT_FAMILY); button("撤销").click(); await ready();
  check(host.querySelector<HTMLSelectElement>('select[aria-label="字体"]')!.value === `${FONT_FAMILY}:400` && button("斜体").getAttribute("aria-pressed") === "true", "撤销跨家族切换恢复原拉丁字体及真实斜体");
  button("重做").click(); await ready();
  check(host.querySelector<HTMLSelectElement>('select[aria-label="字体"]')!.value === `${JP_FONT_FAMILY}:400` && button("斜体").disabled, "重做恢复日文字体及斜体禁用状态");
  await weight("400"); await align("center");
  check(alignment().value === "center", "对齐下拉应用并回显当前选项");
  check(!!button("修改文字"), "结束输入后恢复修改文字入口");
  button("下划线").click(); await ready(); button("删除线").click(); await ready(); button("竖版").click(); await ready();
  check(button("下划线").getAttribute("aria-pressed") === "true" && button("删除线").getAttribute("aria-pressed") === "true" && button("竖版").getAttribute("aria-pressed") === "true", "下划线、删除线和竖版组合开启并明确高亮");
  check(alignment().options[0].text === "上对齐" && alignment().options[2].text === "下对齐" && alignment().selectedOptions[0].text === "垂直居中", "竖版将下拉名称切换为上中下对齐，并保留选中项");
  await align("justify-left"); button("竖版").click(); await ready();
  check(alignment().value === "justify-left" && alignment().options[0].text === "左对齐", "横竖往返保留两端对齐并恢复横版名称");
  await number("行距", "1.5", "Enter"); button("撤销").click(); await ready();
  check(field("行距").value === "1.16", "字号行距数值按一次应用记一步历史");
  host.querySelector<HTMLDetailsElement>(".text-properties details")!.open = true; await paint();
  await toggle("文字阴影");
  check(field("阴影模糊").value === "4" && field("水平偏移").value === "2" && field("垂直偏移").value === "2", "首次开启阴影使用预设，未开启时不渲染");
  await number("阴影模糊", "12", "Enter"); await toggle("文字阴影"); await toggle("文字阴影");
  check(field("阴影模糊").value === "12", "面板关闭再启用阴影恢复原参数");
  for (const name of ["阴影模糊", "水平偏移", "垂直偏移"]) await number(name, "0", "Enter");
  const zeroShadow = () => ["阴影模糊", "水平偏移", "垂直偏移"].every(name => field(name)?.value === "0");
  await toggle("文字阴影"); await toggle("文字阴影");
  check(zeroShadow(), "阴影三个零值关闭重开后不被默认值覆盖");
  button("撤销").click(); await ready(); button("重做").click(); await ready();
  host.querySelector<HTMLDetailsElement>(".text-effects")!.open = true; await paint();
  check(zeroShadow(), "撤销重做重新开启阴影仍保留三个零值");
  await toggle("文字阴影"); button("复制图层").click(); await ready();
  host.querySelector<HTMLDetailsElement>(".text-effects")!.open = true; await paint(); await toggle("文字阴影");
  check(zeroShadow(), "复制关闭阴影的文字后重新开启仍使用保存的零值");
  const opacitySlider = host.querySelector<HTMLInputElement>('input[aria-label="文字不透明度滑块"]')!;
  opacitySlider.focus();
  for (const value of [80, 60, 25]) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(opacitySlider, String(value));
    opacitySlider.dispatchEvent(new Event("input", { bubbles: true })); await paint();
  }
  opacitySlider.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true })); await ready();
  check(field("不透明度").value === "25", "文字不透明度滑块实时同步数字输入");
  button("撤销").click(); await ready(); check(field("不透明度").value === "100", "面板连续调整不透明度只记一步撤销");
  host.querySelector<HTMLDetailsElement>(".text-effects")!.open = true; await paint();
  await number("不透明度", "15", "Escape"); check(field("不透明度").value === "100", "文字不透明度数字Esc取消后失焦不应用");
  const backgroundSlider = host.querySelector<HTMLInputElement>('input[aria-label="文字背景不透明度滑块"]')!;
  backgroundSlider.focus();
  for (const value of [80, 60, 25]) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(backgroundSlider, String(value));
    backgroundSlider.dispatchEvent(new Event("input", { bubbles: true })); await paint();
  }
  backgroundSlider.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true })); await ready();
  check(field("背景不透明度").value === "25" && field("不透明度").value === "100", "背景滑块同步数值且不改变整体不透明度");
  button("撤销").click(); await ready(); check(field("背景不透明度").value === "45", "背景连续调整只记一步撤销");
  button("重做").click(); await ready(); check(field("背景不透明度").value === "25", "背景连续调整重做恢复最终值");
  await number("背景不透明度", "10", "Escape"); check(field("背景不透明度").value === "25", "背景数字Esc取消并保留原值");
  await number("背景不透明度", "0", "Enter");
  check(host.textContent!.includes("背景完全透明") && !host.querySelector('.layer-card')!.textContent!.includes("完全透明"), "0%背景提示恢复，文字图层不标记完全透明");
  await toggle("背景填充"); check(!field("背景不透明度"), "关闭背景收起对应控件");
  await toggle("背景填充"); check(field("背景不透明度").value === "0", "重新开启背景保留零不透明度");
  await number("背景不透明度", "45", "Enter");
  const resumedBackgroundSlider = field("文字背景不透明度滑块"); resumedBackgroundSlider.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(resumedBackgroundSlider, "35");
  resumedBackgroundSlider.dispatchEvent(new Event("input", { bubbles: true })); await paint();
  resumedBackgroundSlider.blur(); await ready();
  button("撤销").click(); await ready(); check(field("背景不透明度").value === "45", "背景滑块失焦收尾后可单步撤销");
  host.querySelector<HTMLDetailsElement>(".text-effects")!.open = true; await paint();
  await number("不透明度", "0", "Enter");
  check(host.textContent!.includes("文字完全透明，可调整不透明度恢复") && host.querySelector('.layer-card')!.textContent!.includes("完全透明"), "0%文字在属性与图层提示恢复方式");
  host.querySelector<HTMLDetailsElement>(".text-effects")!.open = false; await paint();
  check(host.querySelector('.text-effects-summary')!.textContent!.includes("完全透明"), "收起更多效果仍可看到透明状态");
  const settings = host.querySelector<HTMLElement>(".settings-panel")!; settings.scrollTop = settings.scrollHeight; await paint();
  check(button("添加文字").getBoundingClientRect().top >= settings.getBoundingClientRect().top - 2, "属性滚动到底仍保留添加文字入口");
  document.getElementById("results")!.textContent = reports.join("\n") + `\n\n全部通过，共 ${reports.length} 项`;
} catch (error) { document.getElementById("results")!.textContent = reports.join("\n") + `\nFAIL ${(error as Error).stack}`; }
