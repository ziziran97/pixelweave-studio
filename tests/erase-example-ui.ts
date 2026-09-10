import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { EraseExampleEntry } from "../src/components/EraseExampleEntry";
import { readEraseTelemetry } from "../src/telemetry";
import { createEditor, frame, picture } from "./editing-tools";
import { checkEraseDemoFlow } from "./erase-demo-flow";
import "../src/styles.css";

const reports: string[] = [];
const check = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
  reports.push(`PASS ${message}`); document.getElementById("results")!.textContent = reports.join("\n") + "\n运行中…";
};
const host = document.getElementById("test-root")!, root = createRoot(host);
const paint = async () => { await frame(); await frame(); };
const waitFor = async (ready: () => boolean) => {
  const end = Date.now() + 8000;
  while (!ready()) { if (Date.now() > end) throw new Error("等待固定样例超时"); await new Promise(resolve => setTimeout(resolve, 20)); }
  await paint();
};
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const dialog = () => host.querySelector<HTMLDialogElement>(".result-dialog");
const images = () => [...host.querySelectorAll<HTMLImageElement>(".result-images img")];
const loaded = () => images().length === 2 && images().every(image => image.complete && image.naturalWidth === 2910) && !button("100% 查看对比图片").disabled;
const closeButton = () => host.querySelector<HTMLButtonElement>(".result-footer .primary-button")!;
const aligned = () => images()[0].style.cssText === images()[1].style.cssText;
const originalFetch = window.fetch;
let postRequests = 0;
window.fetch = async (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method.toUpperCase() === "POST") { postRequests++; throw new Error("固定样例不得调用业务接口"); }
  return originalFetch(input, init);
};
const test = createEditor(undefined, true);
let disposed = false;
try {
  await test.editor.initialize();
  test.editor.setTool("rect"); test.drag(80, 80, 210, 140);
  const layerId = test.editor.canvas.getObjects().at(-1)!.editorId!;
  test.editor.selectLayer(layerId); test.editor.setEraseMode("rect"); test.drag(240, 170, 290, 210);
  test.editor.zoomTo(.8); await paint();
  const probe = test.editor as unknown as { snapshot: () => unknown; revision: number };
  const draft = () => JSON.stringify({ document: probe.snapshot(), revision: probe.revision, viewport: test.editor.canvas.viewportTransform,
    selected: test.state().selectedId, tool: test.state().tool, workspace: test.state().workspace, canUndo: test.state().canUndo, canRedo: test.state().canRedo });
  const savedDraft = draft(), telemetry = JSON.stringify(readEraseTelemetry());
  root.render(createElement(EraseExampleEntry, { disabled: false })); await paint();
  const entry = button("查看消除结果示例");
  check(!!entry && !entry.disabled && test.state().hasMask, "已有图片、对象和选区时可打开独立固定样例");
  entry.focus(); entry.click(); await waitFor(loaded);
  check(dialog()!.textContent!.includes("固定样例 · 效果示意，未调用消除服务") && images().every(image => image.naturalHeight === 1800), "实际加载 2910 × 1800 的前后样图，明确标注效果示意");
  check(closeButton().textContent === "关闭示例" && host.querySelectorAll(".result-footer button").length === 1 && !dialog()!.textContent!.includes("使用消除结果"), "示例只提供关闭，不提供采用或放弃真实结果的操作");
  check(document.activeElement === closeButton(), "打开示例默认聚焦关闭按钮");
  const fittedWidth = images()[0].width;
  check(aligned() && fittedWidth <= host.querySelector<HTMLElement>(".result-viewport")!.clientWidth + 1, "示例初始完整适配，两侧同步");
  button("100% 查看对比图片").click(); await paint();
  check(images()[0].width === 2910 && aligned(), "示例 100% 查看按真实像素尺寸展示");
  button("查看本次消除区域").click(); await paint();
  const pane = host.querySelector<HTMLElement>(".result-viewport")!, paneBounds = pane.getBoundingClientRect();
  const imageBounds = images()[0].getBoundingClientRect(), scale = images()[0].width / 2910;
  check(aligned() && images()[0].width > fittedWidth && imageBounds.left + 1899 * scale >= paneBounds.left - 1 &&
    imageBounds.top + 1374 * scale >= paneBounds.top - 1 && imageBounds.left + 2790 * scale <= paneBounds.right + 1 && imageBounds.top + 1725 * scale <= paneBounds.bottom + 1,
    "消除区域定位到等比放大后的橙色标签范围，两侧同步且完整包含示例区域");
  const transform = images()[0].style.transform;
  pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })); await paint();
  check(images()[0].style.transform !== transform && aligned(), "示例视图支持键盘平移，两侧保持同步");
  const oldWidth = images()[0].width;
  pane.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: paneBounds.left + 80, clientY: paneBounds.top + 80, bubbles: true, cancelable: true })); await paint();
  check(images()[0].width > oldWidth && aligned(), "示例支持滚轮缩放");
  for (const event of [new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
    new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }), new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true })]) dialog()!.dispatchEvent(event);
  await paint();
  check(draft() === savedDraft, "示例查看及快捷键不修改底层图片、对象、选区、选择、历史或画布视野");
  images()[1].dispatchEvent(new Event("error")); await paint();
  check(dialog()!.textContent!.includes("示例图片加载失败") && !closeButton().disabled && button("100% 查看对比图片").disabled, "示例图片加载失败可关闭，未加载图片不能缩放");
  host.querySelector<HTMLButtonElement>(".result-recovery button")!.click(); await waitFor(loaded);
  check(!host.querySelector(".result-recovery") && aligned(), "示例加载失败后可重试恢复查看");
  closeButton().click(); await paint();
  check(!dialog() && document.activeElement === entry && draft() === savedDraft, "关闭示例返回原入口，完整保留原编辑草稿");
  entry.click(); await waitFor(loaded);
  check(images()[0].width === fittedWidth, "重新打开示例恢复整图适配，不沿用上次局部查看位置");
  dialog()!.dispatchEvent(new Event("cancel", { cancelable: true })); await paint();
  check(!dialog() && document.activeElement === entry && !test.state().closed && draft() === savedDraft, "Esc 只关闭固定示例，不关闭编辑或清空选区");
  entry.click(); root.render(createElement(EraseExampleEntry, { disabled: true })); await paint(); await paint();
  check(entry.disabled && !dialog(), "编辑状态受限时禁用示例入口，加载期间的迟到结果不打开弹窗");
  check(postRequests === 0 && JSON.stringify(readEraseTelemetry()) === telemetry && !test.state().pending && !test.state().task,
    "打开、查看、重试及关闭均不请求算法、不创建真实消除结果或埋点");
  root.render(null); await paint(); test.dispose(); disposed = true;

  root.render(createElement(App, { preview: true }));
  await waitFor(() => !!button("查看消除结果示例") && !button("查看消除结果示例").disabled);
  check(host.querySelector<HTMLButtonElement>(".erase-submit")?.disabled === true && !!button("查看消除结果示例"), "独立页面无需选区即可看示例，开始消除仍要求真实选区");
  check(host.querySelector(".document-size")?.textContent === "2910 × 1800 px", "独立预览默认工作图片为 2910 × 1800");
  button("查看消除结果示例").click(); await waitFor(loaded);
  check(!!dialog()?.open, "消除笔面板入口可打开同一结果查看弹窗");
  const initialImage = await originalFetch(host.querySelector<HTMLImageElement>(".layer-thumb img")!.src).then(response => response.blob());
  const sampleImage = await originalFetch(images()[0].src).then(response => response.blob());
  const digest = async (blob: Blob) => new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())).join(",");
  check(await digest(initialImage) === await digest(sampleImage), "默认底图与消除前样图使用完全相同的图片资源");
  closeButton().click(); await paint();
  const integration = { initialImage: await picture(), context: { taskId: "example-gate", imageId: "test" },
    validateTexts: async () => ({ passed: true as const }),
    replace: async () => ({ status: "failed" as const, message: "不保存" }), confirmResult: async () => ({ status: "pending" as const }), onClose: () => {} };
  root.render(null); await paint(); root.render(createElement(App, { preview: true, integration }));
  await waitFor(() => !!button("消除笔") && !button("消除笔").disabled);
  check(!button("查看消除结果示例") && !host.querySelector(".preview-scenario"), "真实宿主即使在开发环境并传入 preview 也不显示演示入口");
  check(host.querySelector(".document-size")?.textContent === "512 × 384 px", "真实宿主提供的初始图片不被演示默认图覆盖");
  root.render(null); await paint(); root.render(createElement(App, { preview: false }));
  await waitFor(() => !!button("消除笔") && !button("消除笔").disabled);
  check(!button("查看消除结果示例"), "未启用独立演示时不显示固定样例");
  check(postRequests === 0, "实际页面检查未请求任何消除或保存接口");
  root.render(null); await paint();
  await checkEraseDemoFlow(check);
  reports.push("全部检查通过");
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally {
  window.fetch = originalFetch;
  if (!disposed) test.dispose();
  document.getElementById("results")!.textContent = reports.join("\n");
}
