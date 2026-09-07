import { Textbox } from "fabric";
import { createEditor, picture, settle } from "./editing-tools";
import { createTextValidator, textCheckIssues } from "../src/integration";
import type { TextCheck } from "../src/integration";

export async function checkTextValidation(check: (value: boolean, message: string) => void) {
  const inputs: string[] = []; let saves = 0, mode = "words", disposed = false;
  let late!: (words: string[]) => void;
  const test = createEditor({ initialImage: await picture(), context: { taskId: "words", imageId: "image" },
    validateTexts: createTextValidator(async text => {
      inputs.push(text);
      if (mode === "error") throw new Error("测试网络断开");
      if (mode === "late") return new Promise(resolve => { late = resolve; });
      if (mode === "malformed") return null as unknown as string[];
      return text.includes("forbidden") ? ["forbidden", "restricted", "forbidden"] : [];
    }),
    replace: async () => { saves++; return { status: "failed", message: "测试保存失败，草稿保留" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {} });
  const { editor, state, confirm, dispose } = test;
  const active = () => editor.canvas.getActiveObject() as Textbox;
  const edit = (text: string) => { editor.editSelectedText(); const object = active(); object.set("text", text); editor.canvas.fire("text:changed", { target: object as never }); object.exitEditing(); };
  try {
    await editor.initialize(); editor.setTool("text"); await editor.addText();
    edit("forbidden offer"); const first = active().editorId!;
    await editor.duplicateSelected(); const second = active().editorId!;
    editor.updateTextOpacity(0); editor.updateLayer(second, { visible: false, locked: true });
    editor.selectLayer(first); await editor.updateText({ ...state().text!, fill: "#ee3300" });
    await new Promise(resolve => setTimeout(resolve, 600));
    check(inputs.length === 0, "输入、停顿、结束编辑及样式调整均不触发违禁词请求");
    await confirm(() => editor.submitReplacement(), false);
    check(inputs.length === 0 && saves === 0, "取消替换确认不检测、不保存");
    await confirm(() => editor.submitReplacement());
    check(inputs.length === 1 && inputs[0] === "forbidden offer", "接口只收到文案字符串，同批相同文案复用一次结果");
    check(state().problemObjectIds?.length === 2 && saves === 0 && state().canSubmit, "返回违禁词标记所有对应图层并阻止保存、保留草稿");
    check(state().notice === "2 个文字图层的文案需修改。", "画布顶部只显示问题图层数量，不堆放多个违禁词");
    check(state().textError === "包含违禁词：forbidden、restricted，请修改后再次替换。", "当前文字展示去重后的具体违禁词");
    check(state().layers.find(layer => layer.id === second)?.locked === true && state().layers.find(layer => layer.id === second)?.visible === false, "隐藏锁定及完全透明文字仍参与检测，结果不改变状态");
    await editor.updateText({ ...state().text!, fontSize: 64 });
    editor.updateTextOpacity(50);
    check(state().problemObjectIds?.length === 2 && !!state().textError && inputs.length === 1, "改字号和不透明度保留违禁词问题且不重复检测");
    await editor.undo();
    check(state().problemObjectIds?.length === 2 && !!state().textError, "撤销样式保持与原文案对应的检测问题");
    editor.selectLayer(first); edit("Allowed offer");
    check(!state().textError && state().problemObjectIds?.length === 1 && state().problemObjectId === second && inputs.length === 1, "修改文案清除该层旧提示，其他问题保留，未自动复检");
    check(state().notice === "1 个文字图层的文案需修改。", "修改其中一层后顶部同步剩余问题数量");
    await editor.undo();
    check(state().problemObjectIds?.length === 2 && !!state().textError, "撤销文案修改恢复已知问题，不将旧违禁文案显示为通过");
    edit("Allowed offer");
    editor.updateLayer(second, { visible: true, locked: false }); editor.selectLayer(second); editor.deleteSelected();
    check(!state().problemObjectIds?.length && !state().notice.includes("文字图层的文案需修改"), "删除剩余问题文字后移除定位与过期违禁词提示");
    await confirm(() => editor.submitReplacement());
    check(saves === 1 && inputs.at(-1) === "Allowed offer" && !state().problemObjectIds?.length, "再次确认替换时检测最新文案，通过后才进入保存");
    mode = "error"; await confirm(() => editor.submitReplacement());
    check(saves === 1 && !state().submitting && state().canSubmit && state().notice.includes("文案检测失败") && state().notice.includes("重试"), "检测网络失败不保存并解锁草稿供再次替换重试");
    mode = "malformed"; await confirm(() => editor.submitReplacement());
    check(saves === 1 && state().notice.includes("检测") && state().canSubmit, "缺失词数组不能误判通过");
    mode = "late";
    const originalTimeout = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => originalTimeout(handler, timeout === 15000 ? 30 : timeout, ...args)) as typeof window.setTimeout;
    try { await confirm(() => editor.submitReplacement()); } finally { window.setTimeout = originalTimeout; }
    check(saves === 1 && state().notice.includes("超时") && !state().submitting, "检测超时恢复编辑，允许用户再次替换");
    mode = "words"; await confirm(() => editor.submitReplacement());
    const notice = state().notice; late(["late word"]); await new Promise(resolve => setTimeout(resolve, 30));
    check(saves === 2 && state().notice === notice && !state().problemObjectIds?.length, "超时请求晚到不能覆盖重试结果或重复保存");
    for (const invalid of [null, {}, { passed: false, issues: [] }, { passed: false, issues: [{ objectId: "unknown", words: ["word"] }] }]) {
      let rejected = false; try { textCheckIssues(invalid as TextCheck, [{ id: first, text: "Allowed offer" }]); } catch { rejected = true; }
      check(rejected, "不完整或无法对应图层的检测回执被拒绝");
    }
    mode = "late"; const pending = confirm(() => editor.submitReplacement()); await settle(() => state().submitting && inputs.at(-1) === "Allowed offer");
    await Promise.resolve(); await Promise.resolve(); dispose(); disposed = true; late(["late word"]); await pending;
    check(saves === 2, "编辑会话卸载后的检测结果不会继续保存");
  } finally { if (!disposed) dispose(); }
}


export async function checkStandalonePreview(check: (value: boolean, message: string) => void) {
  const demo = createEditor(undefined, true);
  const edit = (editor: typeof demo.editor, text: string) => {
    const object = editor.canvas.getActiveObject() as Textbox;
    object.set("text", text); object.exitEditing(); editor.canvas.fire("object:modified", { target: object });
  };
  try {
    await demo.editor.initialize(); demo.editor.setTool("text"); await demo.editor.addText(); edit(demo.editor, "A DURABLE item");
    await demo.confirm(() => demo.editor.submitReplacement(), false);
    check(!demo.state().textError && !demo.state().problemObjectId, "独立演示确认前和取消确认不进行检测");
    await demo.confirm(() => demo.editor.submitReplacement());
    check(!!demo.state().textError?.includes("durable") && demo.state().canSubmit && !demo.state().saved, "普通预览命中完整单词，不区分大小写并保留草稿");
    edit(demo.editor, "reliable");
    check(!demo.state().textError, "演示文案修改后清除旧问题，等待再次替换");
    await demo.confirm(() => demo.editor.submitReplacement());
    check(demo.state().notice.includes("文案检测通过") && demo.state().notice.includes("未保存到任务") && !demo.state().submitting && !demo.state().closed && !demo.state().saved && demo.state().canSubmit, "演示通过只提示未保存，留在可编辑画布并允许再次体验");
    check((demo.editor.canvas.getActiveObject() as Textbox).text === "reliable" && demo.state().canUndo, "演示检测保留文字、选择及可撤销编辑");
    edit(demo.editor, "nondurable durables"); await demo.confirm(() => demo.editor.submitReplacement());
    check(!demo.state().textError && demo.state().notice.includes("文案检测通过"), "模拟规则不把单词的一部分误判为 durable");
    demo.editor.deleteSelected(); demo.editor.setTool("rect"); demo.drag(40, 40, 100, 100);
    await demo.confirm(() => demo.editor.submitReplacement());
    check(demo.state().notice === "当前为演示，未保存到任务。", "无新增文案不声称完成文案检测，也不伪造保存");
  } finally { demo.dispose(); }
  let checks = 0, saves = 0, fail = true;
  const hosted = createEditor({ initialImage: await picture(), context: { taskId: "host", imageId: "real" },
    validateTexts: async () => { checks++; if (fail) throw new Error("host error"); return { passed: true }; },
    replace: async () => { saves++; return { status: "failed", message: "宿主保存失败" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {} }, true);
  try {
    await hosted.editor.initialize(); hosted.editor.setTool("text"); await hosted.editor.addText(); edit(hosted.editor, "durable");
    await hosted.confirm(() => hosted.editor.submitReplacement());
    check(checks === 1 && saves === 0 && hosted.state().notice.includes("文案检测失败") && !hosted.state().textError, "提供宿主后真实检测优先，接口失败不回退模拟");
    fail = false; await hosted.confirm(() => hosted.editor.submitReplacement());
    check(checks === 2 && saves === 1 && hosted.state().notice === "宿主保存失败", "宿主通过时继续真实保存契约，不使用演示提示或模拟词拦截");
  } finally { hosted.dispose(); }
}
