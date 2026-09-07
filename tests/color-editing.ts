import { Path, Rect, Textbox } from "fabric";
import { createEditor } from "./editing-tools";
import { textProperties } from "../src/editor/text";

export async function checkColorEditing(check: (value: boolean, message: string) => void) {
  const { editor, state, click, drag, dispose } = createEditor();
  const last = () => editor.canvas.getObjects().at(-1)!;
  try {
    await editor.initialize(); editor.setTool("rect");
    const initial = editor.beginColorEdit("shape")!; initial.preview("#ff0000"); initial.finish(false);
    check(!state().canUndo && state().shape.color === "#2574d8", "取消新建颜色恢复默认值且不产生历史");
    editor.setFieldColor("shape", "#ff0000");
    const viewport = [...editor.canvas.viewportTransform];
    drag(80, 80, 150, 140); const first = last() as Rect;
    drag(180, 80, 250, 140); const second = last();
    check(first !== second && state().layers.length === 3 && state().tool === "rect" && !state().selectedId, "无需重复点击类型即可连续绘制两个独立矩形");
    check(first.fill === "#ff0000" && second.fill === "#ff0000" && editor.canvas.viewportTransform.every((v, i) => v === viewport[i]), "连续绘制保持已确认颜色和画布视野");
    await editor.undo(); check(state().layers.length === 2, "连续图形按一个图形一步撤销");
    await editor.undo(true); editor.selectLayer(first.editorId!);
    const original = editor.canvas.getActiveObject() as Rect;
    const cancel = editor.beginColorEdit("shape")!; cancel.preview("#00ff00"); cancel.preview("#0000ff");
    check(original.fill === "#0000ff" && state().selectedId === first.editorId, "颜色连续预览实时作用于开始时的对象并保留选择");
    cancel.finish(false); check(original.fill === "#ff0000", "取消颜色预览恢复对象原色");
    await editor.undo(); check(state().layers.length === 2, "取消颜色没有额外历史，撤销仍移除上一图形");
    await editor.undo(true); editor.selectLayer(first.editorId!);
    const apply = editor.beginColorEdit("shape")!; apply.preview("#00ff00"); apply.preview("#0000ff"); apply.finish(true);
    await editor.undo(); check(state().selectedId === first.editorId && state().shape.color === "#ff0000", "多次颜色预览应用后一次撤销恢复原色及选择");
    await editor.undo(true); check(state().shape.color === "#0000ff", "一次重做恢复应用的颜色");
    const pick = editor.beginColorEdit("shape")!;
    await editor.startColorPick(color => { pick.preview(color); pick.finish(true); }, () => pick.finish(false));
    const count = state().layers.length; click(450, 350);
    check(state().selectedId === first.editorId && state().shape.color !== "#0000ff" && state().layers.length === count, "图片取色不被 Fabric 取消选择，不意外新建或改变其他对象");
    await editor.undo(); check(state().shape.color === "#0000ff", "外部取色作为一次修改可撤销");
    const aborted = editor.beginColorEdit("shape")!;
    const preparing = editor.startColorPick(color => aborted.preview(color), () => aborted.finish(false));
    editor.cancelColorPick(); await preparing;
    check(!state().busy && !state().picking && !state().colorEditing && state().shape.color === "#0000ff", "取色准备期间取消后晚到渲染不会恢复取色或改写对象");
    editor.setTool("circle"); drag(300, 80, 360, 140); drag(380, 80, 440, 140);
    check(state().tool === "circle" && !state().selectedId && state().layers.length === count + 2, "椭圆同样连续绘制，每次保持未选中状态");
    editor.setTool("draw"); drag(80, 220, 180, 220); const path = last() as Path; editor.selectLayer(path.editorId!);
    const stroke = path.stroke; const brush = editor.beginColorEdit("drawing")!; brush.preview("#ff00ff"); brush.finish(false);
    check(path.stroke === stroke, "画笔颜色取消恢复原笔画");
    editor.setTool("text"); await editor.addText({ x: 120, y: 280 }); let text = last() as Textbox;
    const shadowEdit = editor.beginColorEdit("shadowColor")!; shadowEdit.preview("#ff0000"); shadowEdit.finish(false);
    check(text.shadow === null && textProperties(text).shadowColor === "#000000", "阴影未启用时取消颜色仍恢复原值");
    editor.setFieldColor("shadowColor", "#ff0000");
    check(text.shadow === null && textProperties(text).shadowColor === "#ff0000", "阴影参数为零时仍记住文字自身的阴影颜色");
    await editor.undo(); text = editor.canvas.getActiveObject() as Textbox;
    check(textProperties(text).shadowColor === "#000000", "未启用阴影的颜色修改可以单步撤销");
    await editor.undo(true); text = editor.canvas.getActiveObject() as Textbox;
    check(text.shadow === null && textProperties(text).shadowColor === "#ff0000", "历史重载保留尚未启用的阴影颜色");
    await editor.duplicateSelected(); text = editor.canvas.getActiveObject() as Textbox;
    check(text.shadow === null && textProperties(text).shadowColor === "#ff0000", "复制文字保留尚未启用的阴影颜色");
    await editor.updateText({ ...textProperties(text), shadowBlur: 8 });
    check(text.shadow?.color === "#ff0000", "随后启用阴影使用此前选择的颜色");
    // Older documents stored only Fabric's active shadow color.
    delete text.editorTextShadowColor;
    check(textProperties(text).shadowColor === "#ff0000", "旧文字仍从已有阴影读取颜色");
    const legacyCancel = editor.beginColorEdit("shadowColor")!; legacyCancel.preview("#00ff00"); legacyCancel.finish(false);
    check(text.editorTextShadowColor === undefined && textProperties(text).shadowColor === "#ff0000", "取消旧文字试色不添加元数据或改变阴影");
    await editor.updateText({ ...textProperties(text), background: true, strokeWidth: 2, shadowBlur: 4 });
    for (const channel of ["fill", "backgroundColor", "stroke", "shadowColor"] as const) {
      const before = textProperties(text)[channel]; const edit = editor.beginColorEdit(channel)!;
      edit.preview("#abcdef"); check(textProperties(text)[channel] === "#abcdef", `文字 ${channel} 复用实时颜色预览`);
      edit.finish(false); check(textProperties(text)[channel] === before, `文字 ${channel} 取消恢复原值`);
    }
  } finally { dispose(); }
}
