import { createEditor, picture, settle } from "./editing-tools";
import type { AddedText, EditorIntegration, ReplaceOutcome, ReplacementInput } from "../src/integration";
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
}
