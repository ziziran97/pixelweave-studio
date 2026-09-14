import { createEditor, picture, settle } from "./editing-tools";
import type { AddedText, EditorIntegration, ImageContext, ReplaceOutcome, ReplacementInput } from "../src/integration";
import { Textbox } from "fabric";

export async function checkReplacementFlow(check: (condition: boolean, message: string) => void) {
  const initialImage = await picture(); let validateCalls = 0, replaceCalls = 0, closeCalls = 0;
  let blocked = true, queryOutcome: ReplaceOutcome = { status: "failed", message: "测试明确失败，后台不会继续生效" };
  let latest!: ReplacementInput, texts: AddedText[] = [], oldProgress: (value: string) => void = () => {};
  let throwOnClose = true, release!: () => void;
  const queryIds: string[] = [];
  const adapter: EditorIntegration = {
    initialImage, context: { taskId: "task-a", imageId: "image-a", baseRecordId: "record-original" },
    validateTexts: async values => { validateCalls++; texts = values; return blocked ? { passed: false, message: "文案命中测试词", objectId: values[0].id } : { passed: true }; },
    replace: async (input, progress) => {
      latest = input; replaceCalls++;
      if (replaceCalls === 1) { oldProgress = progress; return { status: "pending" }; }
      await new Promise<void>(resolve => { release = resolve; });
      throw new Error("模拟响应丢失");
    },
    confirmResult: async id => { queryIds.push(id); return queryOutcome; },
    onClose: () => { closeCalls++; if (throwOnClose) throw new Error("测试刷新失败"); },
  };
  const { editor, state, dispose, confirm } = createEditor(adapter);
  try {
    await editor.initialize(); editor.setTool("text"); await editor.addText({ x: 40, y: 40 }); await settle(() => editor.canvas.getActiveObject() instanceof Textbox && !state().busy);
    const text = editor.canvas.getActiveObject() as Textbox;
    text.set("text", "Review this copy"); text.exitEditing();
    await confirm(() => editor.submitReplacement());
    check(validateCalls === 1 && replaceCalls === 0 && !state().submitting && state().selectedId === text.editorId,
      "新增文案命中时定位对象并保留草稿，不发送保存请求");
    blocked = false; await confirm(() => editor.submitReplacement());
    check(state().submitting && state().needsConfirmation && !state().canSubmit && texts[0].text === "Review this copy",
      "保存结果未知时保持处理状态和文案，不允许重复提交");
    const firstId = latest.submissionId, size = state().size.width, before = editor.canvas.toJSON();
    await editor.requestClose(); await editor.uploadReplacement(new File([await picture("#ffffff", 300, 200)], "other.jpg"));
    editor.setTool("draw"); await editor.undo(); await confirm(() => editor.submitReplacement());
    check(state().submitting && !state().closed && state().size.width === size && replaceCalls === 1 && JSON.stringify(editor.canvas.toJSON()) === JSON.stringify(before),
      "处理中关闭、上传、编辑、撤销和重复提交均被阻止");
    await editor.confirmReplacement();
    check(queryIds[0] === firstId && replaceCalls === 1 && !state().submitting && state().canSubmit, "使用原提交标识确认失败后恢复草稿，不新建记录");
    const second = confirm(() => editor.submitReplacement()); await settle(() => replaceCalls === 2);
    const secondStage = state().submissionStage;
    oldProgress("过期请求错误进度");
    check(state().submissionStage === secondStage, "旧提交的迟到进度不能覆盖后续提交");
    release(); await second;
    check(state().needsConfirmation && latest.submissionId !== firstId && replaceCalls === 2,
      "响应丢失进入结果确认，仅明确失败后的新提交使用新标识");
    queryOutcome = { status: "succeeded", recordId: "saved-record" };
    await editor.confirmReplacement();
    check(state().saved && !state().closed && state().submissionStage.includes("刷新失败") && closeCalls === 1,
      "保存成功但刷新失败时保留成功状态，不恢复编辑或重复保存");
    await confirm(() => editor.submitReplacement()); check(replaceCalls === 2, "保存成功后禁止再次提交");
    throwOnClose = false; await editor.returnToReview();
    check(state().closed && closeCalls === 2 && replaceCalls === 2, "刷新重试只返回审核，不再次保存");
    check(latest.context.imageId === "image-a" && latest.context.baseRecordId === "record-original" && latest.source === "online", "在线编辑保留目标图片及底图关联");
  } finally { dispose(); }

  let validations = 0, replacements = 0;
  const { editor: uploadEditor, state: uploadState, dispose: disposeUpload, confirm: confirmUpload } = createEditor({
    ...adapter, validateTexts: async () => { validations++; return { passed: true }; },
    replace: async input => { latest = input; replacements++; return { status: "failed", message: "仅验证提交，不保存" }; },
  });
  try {
    await uploadEditor.initialize();
    await uploadEditor.uploadReplacement(new File([initialImage], "direct.jpg"));
    await confirmUpload(() => uploadEditor.submitReplacement());
    check(validations === 0 && replacements === 1 && !uploadState().submitting, "直接上传无新增文案时跳过文案接口，仍提交最终 JPG 给业务系统检测");
    check(latest.source === "upload" && latest.context.imageId === "image-a" && latest.context.baseRecordId === undefined,
      "上传保留本次替换目标，但不继承原图的底图记录关联");
  } finally { disposeUpload(); }
  const local = createEditor();
  try {
    await local.editor.openImage(initialImage, "local", false); local.editor.setTool("rect"); local.drag(30, 30, 80, 80);
    await local.confirm(() => local.editor.submitReplacement());
    check(local.state().notice.includes("尚未接入") && !local.state().saved && local.state().canSubmit, "未接入服务时明确提示并保留草稿，不模拟成功");
  } finally { local.dispose(); }
  await checkRuntimeReceipts(check, initialImage);
  await checkSessionContext(check, initialImage);
}

async function checkRuntimeReceipts(check: (condition: boolean, message: string) => void, initialImage: Blob) {
  let outcome: unknown = { status: "succeeded", recordId: "   " }, replacements = 0, closes = 0;
  let submitted!: ReplacementInput;
  const queries: string[] = [];
  const test = createEditor({ initialImage, context: { taskId: "receipt-task", imageId: "receipt-image" },
    validateTexts: async () => ({ passed: true }),
    replace: async input => { replacements++; submitted = input; return outcome as ReplaceOutcome; },
    confirmResult: async id => { queries.push(id); return outcome as ReplaceOutcome; }, onClose: () => { closes++; } });
  try {
    await test.editor.initialize(); test.editor.setTool("rect"); test.drag(20, 20, 100, 90);
    const draft = JSON.stringify(test.editor.canvas.toJSON());
    await test.confirm(() => test.editor.submitReplacement());
    check(!test.state().saved && !test.state().closed && test.state().needsConfirmation && closes === 0,
      "纯空格保存记录不被当成成功，保留原提交等待查询");
    for (const recordId of [{ invalid: true }, 123, "", null]) {
      outcome = { status: "succeeded", recordId }; await test.editor.confirmReplacement();
      check(test.state().needsConfirmation && !test.state().saved && !test.state().canSubmit && closes === 0 &&
        queries.at(-1) === submitted.submissionId && replacements === 1,
        `查询回执中的无效记录 ${JSON.stringify(recordId)} 不关闭、不解锁、不重新保存`);
    }
    outcome = { status: "failed", message: {}, objectId: {} }; await test.editor.confirmReplacement();
    check(!test.state().needsConfirmation && test.state().canSubmit && test.state().notice.includes("编辑内容已保留") &&
      JSON.stringify(test.editor.canvas.toJSON()) === draft,
      "明确失败但提示字段异常时使用兜底文案，原草稿完整恢复");
    outcome = { status: "succeeded", recordId: " saved-record " };
    await test.confirm(() => test.editor.submitReplacement());
    check(test.state().saved && test.state().closed && closes === 1 && replacements === 2,
      "有效成功回执才进入审核回流，明确失败后可以发起新提交");
  } finally { test.dispose(); }
}

async function checkSessionContext(check: (condition: boolean, message: string) => void, initialImage: Blob) {
  const original: ImageContext = { taskId: "context-task-a", imageId: "context-image-a", baseRecordId: "base-a", targetVersion: "version-a" };
  const context = { ...original }, seenTexts: ImageContext[] = [], queries: { id: string; context: ImageContext }[] = [];
  let submitted!: ReplacementInput, outcome: ReplaceOutcome = { status: "pending" };
  const adapter: EditorIntegration = { initialImage, context,
    validateTexts: async (_texts, input) => { seenTexts.push({ ...input }); input.imageId = "mutated-validation"; input.targetVersion = "mutated"; return { passed: true }; },
    replace: async input => {
      submitted = { ...input, context: { ...input.context }, texts: input.texts.map(text => ({ ...text })) };
      input.submissionId = "mutated-submission"; input.context.imageId = "mutated-replacement"; input.context.targetVersion = "mutated";
      input.texts.length = 0;
      return outcome;
    },
    confirmResult: async (id, input) => { queries.push({ id, context: { ...input } }); input.imageId = "mutated-query"; input.targetVersion = "mutated"; return outcome; },
    onClose: () => {} };
  const test = createEditor(adapter);
  const matchesOriginal = (input: ImageContext, uploaded = false) => input.taskId === original.taskId && input.imageId === original.imageId &&
    input.targetVersion === original.targetVersion && input.baseRecordId === (uploaded ? undefined : original.baseRecordId);
  try {
    const opening = test.editor.initialize();
    Object.assign(context, { taskId: "host-new-task", imageId: "host-new-image", baseRecordId: "host-new-base", targetVersion: "host-new-version" });
    await opening;
    test.editor.setTool("text"); await test.editor.addText();
    await test.confirm(() => test.editor.submitReplacement());
    check(matchesOriginal(seenTexts[0]) && matchesOriginal(submitted.context) && submitted.texts.length === 1,
      "初始图片加载期间宿主更新上下文，不改变本次文案检测和替换目标及版本");
    const id = submitted.submissionId;
    await test.editor.confirmReplacement(); outcome = { status: "failed", message: "测试明确失败，允许继续编辑" };
    await test.editor.confirmReplacement();
    check(queries.length === 2 && queries.every(query => query.id === id && matchesOriginal(query.context)),
      "宿主修改文案、替换和查询入参副本，不污染原提交标识或后续查询上下文");
    await test.confirm(() => test.editor.uploadReplacement(new File([initialImage], "new.jpg")));
    await test.confirm(() => test.editor.submitReplacement());
    check(submitted.source === "upload" && matchesOriginal(submitted.context, true),
      "上传清除实际系统底图关联，但保留打开时的任务、图片和目标生效版本");
    await test.confirm(() => test.editor.resetOriginal());
    check(!test.state().canSubmit, "还原初始没有新修改时仍不能替换");
    await test.editor.undo(); await test.confirm(() => test.editor.submitReplacement());
    check(submitted.source === "upload" && matchesOriginal(submitted.context, true),
      "撤销还原恢复上传来源，目标生效版本保持不变");
    await test.confirm(() => test.editor.resetOriginal());
    test.editor.setTool("rect"); test.drag(20, 20, 100, 90); await test.confirm(() => test.editor.submitReplacement());
    check(submitted.source === "online" && matchesOriginal(submitted.context),
      "还原后继续编辑使用打开时系统底图，不能读入宿主后来修改的记录");
  } finally { test.dispose(); }
  const next = createEditor(adapter);
  try {
    await next.editor.initialize(); next.editor.setTool("rect"); next.drag(20, 20, 100, 90);
    await next.confirm(() => next.editor.submitReplacement());
    check(submitted.context.imageId === context.imageId && submitted.context.targetVersion === context.targetVersion,
      "真正重新打开编辑会话时使用宿主最新目标及版本，不复用旧会话");
  } finally { next.dispose(); }
}
