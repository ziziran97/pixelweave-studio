import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { SubmissionDialog } from "../src/components/SubmissionDialog";
import { createEditor, frame, picture } from "./editing-tools";
import type { EditorIntegration, ReplaceOutcome, TextCheck } from "../src/integration";
import "../src/styles.css";

const reports: string[] = [];
const check = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
  reports.push(`PASS ${message}`); document.getElementById("results")!.textContent = reports.join("\n") + "\n运行中…";
};
const host = document.getElementById("test-root")!, root = createRoot(host);
const paint = async () => { await frame(); await frame(); };
const waitFor = async (ready: () => boolean) => {
  const end = Date.now() + 12000;
  while (!ready()) { if (Date.now() > end) throw new Error("等待替换状态超时"); await new Promise(resolve => setTimeout(resolve, 20)); }
  await paint();
};
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const dialog = () => host.querySelector<HTMLDialogElement>(".submission-dialog");
const status = (id: string) => dialog()?.querySelector<HTMLElement>(`[data-step="${id}"]`)?.dataset.status;
const action = () => dialog()?.querySelector<HTMLButtonElement>(".primary-button");
const start = async () => {
  host.querySelector<HTMLButtonElement>(".top-right .primary-button")!.click();
  await waitFor(() => host.querySelector<HTMLButtonElement>(".confirmation-dialog .primary-button")?.disabled === false);
  host.querySelector<HTMLButtonElement>(".confirmation-dialog .primary-button")!.click(); await paint();
};
const addText = async () => { button("文字").click(); await paint(); button("添加文字").click(); await waitFor(() => !!host.querySelector('.layer-card[data-purpose="content"]')); };
const fixture = await picture();
try {
  let saves = 0, queries = 0, reviews = 0, submissionId = "", queriedId = "";
  let report!: Parameters<EditorIntegration["replace"]>[1];
  const validation = deferred<TextCheck>(), replacement = deferred<ReplaceOutcome>();
  let query = deferred<ReplaceOutcome>();
  const integration: EditorIntegration = { initialImage: fixture, context: { taskId: "submission-test", imageId: "test" },
    validateTexts: () => validation.promise,
    replace: (input, progress) => { saves++; submissionId = input.submissionId; report = progress; return replacement.promise; },
    confirmResult: id => { queries++; queriedId = id; return query.promise; },
    onClose: () => { reviews++; if (reviews === 1) throw new Error("模拟审核刷新失败"); },
  };
  root.render(createElement(App, { integration, preview: true }));
  await waitFor(() => !!button("文字") && !button("文字").disabled);
  check(!host.querySelector(".preview-scenario"), "宿主真实适配器优先，不显示演示场景");
  await addText(); await start();
  check(status("texts") === "active" && status("image") === "waiting" && saves === 0, "新增文案等待期间只显示实际阶段，尚未提交成图");
  validation.resolve({ passed: true }); await waitFor(() => saves === 1);
  check(status("texts") === "done" && status("image") === "active" && status("saving") === "waiting", "未回报阶段时保留通用等待，不自动推进保存");
  report("后端正在处理本次图片"); await paint();
  check(dialog()!.textContent!.includes("后端正在处理本次图片") && status("saving") === "waiting", "旧版字符串回报兼容，仅更新说明");
  for (const [stage, text] of [["person", "人物"], ["ocr", "识别"], ["image_text", "符合要求"], ["marking", "保存信息"]] as const) {
    report({ stage }); await paint(); check(status("image") === "active" && dialog()!.textContent!.includes(text), `${stage} 回报更新图片检测说明`);
  }
  report({ stage: "saving" }); await paint();
  report({ stage: "ocr", message: "过期说明" }); report({ stage: "invalid" } as never); await paint();
  check(status("image") === "done" && status("saving") === "active" && !dialog()!.textContent!.includes("过期说明"), "真实保存阶段才推进，乱序及无效阶段不回退");
  replacement.resolve({ status: "pending" }); await waitFor(() => !!action());
  check(dialog()!.querySelector("h2")!.textContent === "替换结果待确认" && !dialog()!.querySelector(".submission-steps") && document.activeElement === action(), "结果未知单独展示并聚焦查询，不误标保存完成");
  dialog()!.dispatchEvent(new Event("cancel", { cancelable: true })); await paint();
  check(!!dialog()?.open, "进度与结果待确认弹窗的 Esc 不放弃或关闭提交");
  const queryButton = action()!; queryButton.click(); queryButton.click(); await paint();
  report({ stage: "saving", message: "不应出现的晚到阶段" }); await paint();
  check(queries === 1 && queriedId === submissionId && !action() && dialog()!.textContent!.includes("正在查询替换结果") && !dialog()!.textContent!.includes("不应出现"), "查询只执行一次并沿用提交标识，旧替换回报不能覆盖查询");
  query.resolve({ status: "pending" }); await waitFor(() => !!action());
  query = deferred<ReplaceOutcome>(); action()!.click(); await paint(); query.resolve({ status: "succeeded", recordId: "saved-test" });
  await waitFor(() => status("review") === "failed");
  check(dialog()!.querySelector("h2")!.textContent === "图片已保存" && status("saving") === "done" && saves === 1 && queries === 2 && reviews === 1, "查询成功后审核刷新失败仍保留已保存状态");
  const retry = action()!; retry.click(); retry.click(); await waitFor(() => !dialog());
  check(saves === 1 && reviews === 2, "刷新失败只重试审核回流，不重新保存");
  root.render(null); await paint();

  // Real controller with no added text: still checks the composed image.
  const noTextResult = deferred<ReplaceOutcome>(); let imageCalls = 0, textCalls = 0;
  const test = createEditor({ ...integration, validateTexts: async () => { textCalls++; return { passed: true }; },
    replace: () => { imageCalls++; return noTextResult.promise; } });
  try {
    await test.editor.initialize(); test.editor.setTool("rect"); test.drag(30, 30, 120, 100);
    const pending = test.confirm(() => test.editor.submitReplacement()); await waitFor(() => imageCalls === 1);
    check(textCalls === 0 && test.state().submissionProgress?.textsSkipped === true && test.state().submissionProgress?.step === "image", "没有新增文字时明确跳过文案，成图检测照常提交");
    const timerView = { ...test.state(), submissionProgress: { ...test.state().submissionProgress!, waitStartedAt: Date.now() - 11000 } };
    root.render(createElement(SubmissionDialog, { view: timerView, engine: test.editor })); await paint();
    check(!!dialog()!.querySelector(".submission-elapsed")?.textContent?.includes("11 秒") && status("texts") === "skipped", "超过十秒显示实际已等待秒数，无新增文案标明无需检查");
    const bounds = dialog()!.getBoundingClientRect();
    check(bounds.left >= 0 && bounds.right <= innerWidth && dialog()!.scrollWidth <= dialog()!.clientWidth, "进度步骤与提示在当前窗口内无横向溢出");
    root.render(createElement(SubmissionDialog, { view: { ...timerView, needsConfirmation: true, submissionProgress: { ...timerView.submissionProgress, status: "unknown" } }, engine: test.editor })); await paint();
    check(!dialog()!.querySelector(".submission-elapsed"), "结果未知等待用户操作时不继续显示处理计时");
    root.render(null); await paint(); noTextResult.resolve({ status: "failed", message: "明确失败" }); await pending;
    check(!test.state().submitting && test.state().dirty && !test.state().saved, "明确失败解锁并保留编辑草稿");
  } finally { test.dispose(); }

  // Exercise the same production dialog and draft through the local-only scenario selector.
  root.render(createElement(App, { preview: true })); await waitFor(() => !!button("文字") && !button("文字").disabled);
  check(host.querySelector(".brand")!.getBoundingClientRect().right < host.querySelector(".top-actions")!.getBoundingClientRect().left, "演示场景入口为标题留出宽度，不与撤销等按钮重叠");
  await addText();
  const selectScenario = async (value: string) => {
    const select = host.querySelector<HTMLSelectElement>(".preview-scenario select")!;
    select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); await paint();
  };
  const layerBefore = host.querySelector('.layer-card[data-purpose="content"]')!.getAttribute("data-layer-id");
  for (const scenario of ["success", "no_progress", "image_blocked", "detection_failed", "unknown", "review_failed"]) {
    await selectScenario(scenario); await start();
    check(dialog()!.textContent!.includes("演示 · 未保存到任务") && host.querySelector<HTMLSelectElement>(".preview-scenario select")!.disabled, `${scenario} 使用实际进度弹窗且明确标识模拟`);
    if (scenario === "image_blocked" || scenario === "detection_failed") {
      await waitFor(() => !dialog());
      check(!!host.querySelector(".eraser-notice")?.textContent?.includes("尚未替换图片"), `${scenario} 保留草稿并提示未替换`);
    } else {
      await waitFor(() => !!action());
      if (scenario === "unknown") { check(action()!.textContent === "查询替换结果", "演示结果未知提供查询入口"); action()!.click(); await waitFor(() => action()?.textContent === "返回编辑"); }
      if (scenario === "review_failed") { check(action()!.textContent === "重新加载审核图片", "演示审核刷新失败提供单独重试"); action()!.click(); await waitFor(() => action()?.textContent === "返回编辑"); }
      check(dialog()!.querySelector("h2")!.textContent === "演示完成", `${scenario} 完成后仍明确未保存`);
      action()!.click(); await waitFor(() => !dialog());
    }
    check(host.querySelector('.layer-card[data-purpose="content"]')!.getAttribute("data-layer-id") === layerBefore && !host.querySelector<HTMLButtonElement>(".top-right .primary-button")!.disabled, `${scenario} 返回后保留同一草稿且可继续替换`);
  }
  reports.push("全部检查通过");
} catch (error) { reports.push(`FAIL ${(error as Error).message}`); }
finally { document.getElementById("results")!.textContent = reports.join("\n"); }
