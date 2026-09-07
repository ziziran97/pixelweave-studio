import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { createEditor, frame, picture, settle } from "./editing-tools";
import { ConfirmationDialog, CONFIRMATION_COPY } from "../src/components/ConfirmationDialog";
import { ResultPreview } from "../src/components/ResultPreview";
import type { EditorIntegration } from "../src/integration";
import "../src/styles.css";

const reports: string[] = [];
const check = (value: boolean, message: string) => { if (!value) throw new Error(message); reports.push(`PASS ${message}`); };
const host = document.getElementById("test-root")!, root = createRoot(host);
const paint = async () => { await frame(); await frame(); };
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const dialog = () => host.querySelector<HTMLDialogElement>(".confirmation-dialog")!;
const submit = () => host.querySelector<HTMLButtonElement>(".top-right .primary-button")!;
let validations = 0, replacements = 0, nativeConfirm = 0;
const originalConfirm = window.confirm;
window.confirm = () => { nativeConfirm++; throw new Error("不应调用浏览器确认框"); };
const fixture = await picture();
const integration: EditorIntegration = { initialImage: fixture, context: { taskId: "confirmation-test", imageId: "test" },
  validateTexts: async () => { validations++; return { passed: true }; },
  replace: async () => { replacements++; return { status: "failed", message: "固定失败回执，不保存图片" }; },
  confirmResult: async () => ({ status: "pending" }), onClose: () => {} };
try {
  root.render(createElement(App, { integration }));
  await settle(() => !!button("文字") && !button("文字").disabled);
  button("文字").click(); await paint();
  button("添加文字").click();
  await settle(() => !!host.querySelector(".layer-card[data-purpose=content]"));
  const layerName = host.querySelector(".layer-card[data-purpose=content] strong")!.textContent;
  const start = async () => { submit().click(); await settle(() => !!dialog()?.open); };
  await start();
  check(dialog().textContent!.includes("替换后无法恢复") && document.activeElement === dialog().querySelector(".secondary-button"), "替换确认说明不可恢复并默认聚焦返回编辑");
  check(validations === 0 && replacements === 0, "确认前不调用检测或保存服务");
  dialog().dispatchEvent(new MouseEvent("click", { bubbles: true })); await paint();
  check(!!dialog()?.open, "点击弹窗空白不关闭确认");
  dialog().querySelector<HTMLButtonElement>(".secondary-button")!.click(); await paint();
  check(!dialog() && replacements === 0 && host.querySelector(".layer-card[data-purpose=content] strong")!.textContent === layerName, "取消替换保留草稿且不提交");
  await start(); dialog().dispatchEvent(new Event("cancel", { cancelable: true })); await paint();
  check(!dialog() && replacements === 0, "Esc 对应取消，不提交或关闭编辑器");
  await start(); button("取消并关闭弹窗").click(); await paint();
  check(!dialog() && replacements === 0, "右上角关闭确认弹窗等同取消");
  await start(); const accept = dialog().querySelector<HTMLButtonElement>(".primary-button")!;
  accept.click(); accept.click();
  await settle(() => replacements === 1 && !submit().disabled);
  check(validations === 1 && replacements === 1 && !dialog(), "连续确认只执行一次检测和保存，失败回到可编辑草稿");
  const fileInput = host.querySelector<HTMLInputElement>("input[type=file][accept='.jpg,.jpeg']")!;
  const files = new DataTransfer(); files.items.add(new File([fixture], "upload.jpg"));
  fileInput.files = files.files; fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(() => !!dialog()?.open);
  check(dialog().textContent!.includes("不会立即替换任务图片") && dialog().textContent!.includes("确认载入新图片"), "上传使用统一弹窗并区分载入编辑与任务替换");
  dialog().querySelector<HTMLButtonElement>(".secondary-button")!.click(); await paint();
  check(host.querySelector(".layer-card[data-purpose=content] strong")!.textContent === layerName, "取消载入不清空编辑内容");
  button("关闭编辑").click(); await settle(() => !!dialog()?.open);
  check(dialog().textContent!.includes("放弃编辑并关闭"), "关闭存在草稿的编辑器需要确认");
  dialog().querySelector<HTMLButtonElement>(".secondary-button")!.click(); await paint();
  check(!!host.querySelector(".workspace"), "继续编辑保留当前页面");
  root.render(null); await paint();

  // Exercise every confirmation kind in the controller, including the host-only switch entry.
  const test = createEditor(integration);
  let disposed = false;
  try {
    await test.editor.initialize(); test.editor.setTool("rect"); test.drag(30, 30, 100, 90);
    const before = JSON.stringify(test.editor.canvas.toJSON());
    for (const [kind, run] of [
      ["reset", () => test.editor.resetOriginal()], ["upload", () => test.editor.uploadReplacement(new File([fixture], "new.jpg"))],
      ["close", () => test.editor.requestClose()], ["switch", () => test.editor.openImage(fixture, "切换")], ["replace", () => test.editor.submitReplacement()],
    ] as const) {
      const done = run(), prompt = test.state().confirmation!;
      check(prompt.kind === kind, `${kind} 使用对应确认类型`);
      await test.editor.undo(); test.editor.setTool("draw"); await test.editor.submitReplacement();
      test.editor.answerConfirmation("stale-id", true);
      check(test.state().confirmation?.id === prompt.id && JSON.stringify(test.editor.canvas.toJSON()) === before, `${kind} 等待期间阻止编辑、重复提交和过期确认`);
      test.editor.answerConfirmation(prompt.id, false); await done;
      check(!test.state().confirmation && JSON.stringify(test.editor.canvas.toJSON()) === before && !test.state().closed, `${kind} 取消保留草稿`);
    }
    const nextImage = await picture("#ffffff", 160, 120);
    await test.confirm(() => test.editor.openImage(nextImage, "新图片"));
    check(test.state().size.width === 160 && test.state().layers.length === 1 && !test.state().confirmation, "确认切图后才载入新文档并清空旧内容");
    test.editor.setTool("rect"); test.drag(10, 10, 60, 60);
    const pending = test.editor.requestClose(); test.dispose(); disposed = true; await pending;
    check(!test.state().closed, "销毁编辑器会取消尚未回答的确认，不继续执行");
  } finally { if (!disposed) test.dispose(); }
  const closing = createEditor();
  try {
    await closing.editor.openImage(fixture, "无修改", false);
    await closing.editor.requestClose();
    check(closing.state().closed && !closing.state().confirmation, "无修改时直接关闭，不增加多余确认");
    await closing.editor.openImage(fixture, "编辑后关闭", false); closing.editor.setTool("rect"); closing.drag(30, 30, 100, 90);
    await closing.confirm(() => closing.editor.requestClose());
    check(closing.state().closed && !closing.state().confirmation, "确认放弃后关闭编辑器");
  } finally { closing.dispose(); }

  // A late erase preview must not steal focus from an unanswered confirmation.
  const url = URL.createObjectURL(fixture);
  try {
    let cancelled = false;
    const render = (pending: boolean) => root.render(createElement("div", null,
      pending && createElement(ResultPreview, { result: { assetId: "test", beforeUrl: url, afterUrl: url, documentId: "test", revision: 0 }, size: { width: 512, height: 384 }, busy: false, suspended: !cancelled, accept: () => {}, discard: () => {} }),
      !cancelled && createElement(ConfirmationDialog, { confirmation: { id: "test", kind: "close" }, answer: () => { cancelled = true; render(true); } })));
    render(false); await paint(); render(true); await paint();
    check(!!dialog()?.open && !host.querySelector<HTMLDialogElement>(".result-dialog")!.open && document.activeElement === dialog().querySelector(".secondary-button"), "消除结果晚返回时不抢占当前确认弹窗");
    dialog().querySelector<HTMLButtonElement>(".secondary-button")!.click(); await paint();
    check(!dialog() && !!host.querySelector<HTMLDialogElement>(".result-dialog")!.open, "取消关闭后继续查看已返回的消除结果");
    root.render(null); await paint();
  } finally { URL.revokeObjectURL(url); }
  check(nativeConfirm === 0 && Object.keys(CONFIRMATION_COPY).length === 5, "五类操作均不使用浏览器原生确认框");
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally { window.confirm = originalConfirm; document.getElementById("results")!.textContent = reports.join("\n"); }
