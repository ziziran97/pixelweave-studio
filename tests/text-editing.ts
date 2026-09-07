import { Textbox } from "fabric";
import { createEditor, frame, picture } from "./editing-tools";
import { FONT_FAMILY, FONT_WEIGHTS, ensureFont } from "../src/editor/fonts";
import { textProperties, toggleTextBold } from "../src/editor/text";
import { ContentTextbox } from "../src/editor/ContentTextbox";

export async function checkTextEditing(check: (value: boolean, message: string) => void) {
  let validations = 0, replacements = 0;
  let checkedTexts = new Map<string, string>();
  const { editor, state, click, confirm, dispose } = createEditor({
    initialImage: await picture(), context: { taskId: "text-test", imageId: "image" },
    validateTexts: async texts => { validations++; checkedTexts = new Map(texts.map(item => [item.id, item.text])); return { passed: true }; },
    replace: async () => { replacements++; return { status: "failed", message: "测试结束，未保存" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {},
  });
  const active = () => editor.canvas.getActiveObject() as Textbox;
  const input = (value: string) => {
    const text = active(); text.hiddenTextarea!.value = value;
    text.hiddenTextarea!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  };
  try {
    await editor.initialize(); editor.setTool("text"); await editor.addText({ x: 80, y: 80 });
    check(active().text === "Your text" && active().selectionStart === 0 && active().selectionEnd === 9 && active().isEditing, "默认英文占位全选，可直接覆盖输入");
    click(2, 2); await frame();
    check(state().layers.length === 2, "未修改占位文字结束输入仍保留图层");
    await confirm(() => editor.submitReplacement());
    check(validations === 1 && replacements === 1, "占位文字作为普通文案参与成图和提交");
    const id = state().layers.find(layer => layer.role === "text")!.id; editor.selectLayer(id);
    await editor.updateText({ ...state().text!, fontWeight: "300" });
    await editor.updateText(toggleTextBold(state().text!));
    check(active().fontWeight === "700", "Light 点击加粗切换真实 Bold");
    await editor.updateText(toggleTextBold(state().text!));
    check(active().fontWeight === "300", "再次加粗恢复先前 Light 字重");
    await editor.updateText({ ...state().text!, fontWeight: "500", fontStyle: "italic" });
    check(document.fonts.check('italic 500 40px "Alibaba Sans"') && active().fontStyle === "italic", "Medium 使用匹配的真实斜体资源");
    await editor.updateText({ ...state().text!, strokeEnabled: true, stroke: "#ff0000", strokeWidth: 5,
      shadowEnabled: true, shadowColor: "#00ff00", shadowBlur: 9, shadowOffsetX: -3, shadowOffsetY: 7,
      background: true, backgroundColor: "#ffff00" });
    await editor.updateText({ ...state().text!, strokeEnabled: false, shadowEnabled: false });
    check(active().shadow === null && active().stroke === null && state().text!.strokeWidth === 5 && state().text!.shadowBlur === 9, "关闭描边和阴影保留参数但不渲染效果");
    await editor.duplicateSelected();
    check(state().text!.stroke === "#ff0000" && state().text!.shadowColor === "#00ff00" && !state().text!.shadowEnabled, "复制保留已关闭效果的颜色与开关");
    await editor.undo(); await editor.undo(true); editor.selectLayer(state().layers.find(layer => layer.id !== id && layer.role === "text")!.id);
    await editor.updateText({ ...state().text!, strokeEnabled: true, shadowEnabled: true });
    check(active().strokeWidth === 5 && active().shadow?.blur === 9 && active().shadow?.offsetX === -3, "复制和历史恢复后重新启用效果仍用原参数");
    editor.editSelectedText(); input("Original copy"); click(2, 2); await frame();
    const copyId = state().layers.find(layer => layer.name === "Original copy")!.id;
    editor.selectLayer(copyId); editor.editSelectedText(); input("");
    check(active().isEditing && state().layers.some(layer => layer.id === copyId), "输入过程临时清空不删除对象");
    input(" \n \t"); editor.updateLayer(copyId, { locked: true }); await frame();
    check(!state().layers.some(layer => layer.id === copyId) && !state().selectedId && state().workspace === "text", "全空白结束输入删除整段文字及背景，锁定不操作已移除对象");
    await editor.undo(); editor.selectLayer(copyId);
    check(active().text === "Original copy" && active().editorTextBackground === true && active().shadow?.blur === 9, "一次撤销恢复清空前文字及完整样式");
    editor.editSelectedText(); input(""); editor.selectLayer(copyId); await frame();
    check(!state().selectedId && !state().layers.some(layer => layer.id === copyId), "选择刚清空的文字不会产生幽灵选中对象");
    await editor.undo(); editor.selectLayer(copyId); editor.editSelectedText();
    active().hiddenTextarea!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input("中文");
    check(!state().textError && active().text === "中文", "中文输入法组词期间保留输入且不提前报错");
    active().hiddenTextarea!.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" })); await frame();
    check(!state().textError && active().text === "中文", "组词结束不按汉字误判语言，也不静默改写原文");
    click(2, 2); await frame(); editor.updateLayer(copyId, { visible: false, locked: true });
    const counts = [validations, replacements];
    await confirm(() => editor.submitReplacement());
    check(validations === counts[0] + 1 && replacements === counts[1] + 1 && checkedTexts.get(copyId) === "中文" && !state().problemObjectId, "隐藏锁定的汉字文案正常进入宿主检测，通过后才提交");
    editor.updateLayer(copyId, { visible: true, locked: false }); editor.selectLayer(copyId); editor.editSelectedText(); input("Café déjà vu — 20% €"); click(2, 2); await frame();
    await confirm(() => editor.submitReplacement());
    check(validations === counts[0] + 2 && replacements === counts[1] + 2 && checkedTexts.get(copyId) === "Café déjà vu — 20% €", "重音拉丁字母、数字和标点正常提交");
    for (const copy of ["日本製", "高品質", "送料無料", "この商品は軽量です", "サイズ", "おすすめ", "한국어", "منتج عالي الجودة"]) {
      editor.selectLayer(copyId); editor.editSelectedText();
      active().hiddenTextarea!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); input(copy);
      check(!state().textError && active().text === copy, `输入法组词不拦截或修改：${copy}`);
      active().hiddenTextarea!.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: copy })); await frame();
      check(!state().textError && active().text === copy, `结束组词不误报中文：${copy}`);
      click(2, 2); await frame(); const before = [validations, replacements];
      await confirm(() => editor.submitReplacement());
      check(validations === before[0] + 1 && replacements === before[1] + 1 && checkedTexts.get(copyId) === copy, `按原文进入检测，通过后提交：${copy}`);
    }
    editor.selectLayer(copyId);
    // A failed first face load must not mutate an object or poison its retry.
    const NativeFontFace = window.FontFace;
    window.FontFace = class { load() { return Promise.reject(new Error("测试字体断网")); } } as unknown as typeof FontFace;
    try { await editor.updateText({ ...state().text!, fontWeight: "800", fontStyle: "italic" }); }
    finally { window.FontFace = NativeFontFace; }
    check(!!state().textFontError && active().fontWeight === "500", "字体加载失败保留原样式并提供重试状态");
    await editor.retryTextFont();
    check(!state().textFontError && !state().notice.includes("加载失败") && active().fontWeight === "800" && active().fontStyle === "italic", "重试成功才应用字重及斜体，并清除过时失败提示");
    for (const variant of FONT_WEIGHTS) {
      await ensureFont(FONT_FAMILY, variant.value);
      if (variant.value !== "900") await ensureFont(FONT_FAMILY, variant.value, "italic");
    }
    check(FONT_WEIGHTS.every(item => document.fonts.check(`${item.value} 32px "Alibaba Sans"`)), "六种真实字重和五种斜体均能载入");
    const wrapped = new ContentTextbox("Hello world\nSupercalifragilisticexpialidocious\nCafé  déjà", { fontFamily: FONT_FAMILY, fontSize: 32, width: 175, splitByGrapheme: true });
    check(wrapped.textLines[0].trim() === "Hello" && wrapped.textLines[1] === "world", "英文正常单词整体换行并保留手动换行");
    check(wrapped.textLines.length > 4 && wrapped.textLines.join("").replaceAll("\n", "") === wrapped.text.replaceAll("\n", ""), "超长词可拆分，所有空格及字符保持完整");
    let validCursors = true;
    for (let index = 0; index <= wrapped.text.length; index++) {
      const cursor = wrapped.get2DCursorLocation(index);
      validCursors &&= cursor.lineIndex < wrapped.textLines.length && cursor.charIndex <= wrapped.textLines[cursor.lineIndex].length;
    }
    check(validCursors, "自动折行、手动换行及连续空格下逐字符光标位置有效");
  } finally { dispose(); }
}
