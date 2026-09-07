import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { checkPositioning } from "./positioning";
import { frame, picture, settle } from "./editing-tools";
import type { EditorIntegration } from "../src/integration";
import "../src/styles.css";

const reports: string[] = [];
const check = (value: boolean, message: string) => { if (!value) throw new Error(message); reports.push(`PASS ${message}`); };
const host = document.getElementById("test-root")!, root = createRoot(host);
const paint = async () => { await frame(); await frame(); };
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
try {
  await checkPositioning(check);
  const integration: EditorIntegration = { initialImage: await picture(), context: { taskId: "position-ui", imageId: "test" },
    validateTexts: async () => ({ passed: true }), replace: async () => ({ status: "pending" }), confirmResult: async () => ({ status: "pending" }), onClose: () => {} };
  root.render(createElement(App, { integration }));
  await settle(() => !!button("文字") && !button("文字").disabled);
  check(button("相对图片水平居中").disabled && button("相对图片垂直居中").disabled, "初始界面两种居中入口均禁用");
  button("文字").click(); await paint(); button("添加文字").click();
  await settle(() => !!host.querySelector(".layer-card.selected")); await paint();
  check(!button("相对图片水平居中").disabled && !button("相对图片垂直居中").disabled, "选中文字后启用两种相对图片居中入口");
  button("相对图片水平居中").click(); await paint();
  check(!!button("修改文字") && host.querySelector<HTMLSelectElement>("select[aria-label='对齐']")!.value === "left", "图片居中不改变文字框内对齐，结束输入后恢复修改文字入口");
  const chosen = host.querySelector<HTMLElement>(".layer-card.selected")!.dataset.layerId;
  const zoom = host.querySelector("output")!.textContent;
  button("收起工具属性").click(); await paint();
  button("相对图片垂直居中").click(); await paint();
  const key = (name: string, type: string) => button("相对图片垂直居中").dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }));
  key("ArrowRight", "keydown"); key("ArrowRight", "keyup"); await paint();
  button("撤销").click(); await paint();
  check(host.querySelector<HTMLElement>(".settings-panel")!.hidden && host.querySelector<HTMLElement>(".layer-card.selected")!.dataset.layerId === chosen && host.querySelector("output")!.textContent === zoom, "属性栏收起时居中、微调及撤销保留收起状态、选择和缩放");
  button("平移").click(); await paint();
  check(button("相对图片水平居中").disabled && button("相对图片垂直居中").disabled, "平移模式在界面上禁用居中入口");
  button("选择").click(); await paint();
  const footer = host.querySelector(".layer-footer")!.getBoundingClientRect();
  const buttons = [...host.querySelectorAll<HTMLButtonElement>(".layer-position button")];
  check(buttons.every(item => { const b = item.getBoundingClientRect(); return b.left >= footer.left && b.right <= footer.right && b.height >= 32 && item.scrollWidth <= item.clientWidth; }), "紧凑图层栏的居中按钮完整显示，点击高度至少 32px");
  check(host.querySelector(".layer-position-help")!.textContent!.includes("方向键微调") && host.querySelector(".layer-order")!.getBoundingClientRect().bottom <= footer.bottom, "快捷键提示可见，原有图层操作保留在底部");
  button("操作帮助").click(); await paint();
  check(host.querySelector(".shortcut-help-dialog")!.textContent!.includes("10 px"), "操作帮助说明图片像素微调及加速步长");
  host.querySelector<HTMLButtonElement>("button[aria-label='关闭操作帮助']")!.click(); await paint();
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally { document.getElementById("results")!.textContent = reports.join("\n"); }
