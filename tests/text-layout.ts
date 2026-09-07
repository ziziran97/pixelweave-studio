import { FabricObject, Textbox } from "fabric";
import { createEditor } from "./editing-tools";
import { ContentTextbox } from "../src/editor/ContentTextbox";
import { FONT_FAMILY, ensureFont } from "../src/editor/fonts";
import { Assets } from "../src/editor/assets";
import { renderDocument } from "../src/editor/render";
import { SERIALIZED_PROPS } from "../src/editor/model";
import { DEFAULT_ADJUSTMENTS } from "../src/types";

export async function checkTextLayout(check: (value: boolean, message: string) => void) {
  const { editor, state, dispose } = createEditor();
  const active = () => editor.canvas.getActiveObject() as Textbox;
  try {
    await editor.initialize(); editor.setTool("text");
    await editor.updateText({ ...state().text!, underline: true, linethrough: true, textAlign: "justify-left" });
    check(!state().canUndo && !state().dirty, "新文字装饰和两端对齐预设不产生历史");
    await editor.addText({ x: 100, y: 100 });
    const id = active().editorId!; active().exitEditing();
    await editor.updateText({ ...state().text!, background: true, shadowEnabled: true, shadowBlur: 4, shadowOffsetX: 3, strokeEnabled: true });
    const center = active().getCenterPoint(), viewport = [...editor.canvas.viewportTransform], requests = state().propertiesRequest;
    editor.toggleTextOrientation();
    check(active().angle === 90 && state().textVertical === true && active().getCenterPoint().distanceFrom(center) < .001, "竖版围绕中心旋转到90度，保留文字位置");
    check(active().underline && active().linethrough && active().editorTextBackground === true && !!active().shadow && !!active().stroke && active().textAlign === "justify-left", "横竖切换保留装饰、背景、效果及两端对齐");
    check(state().propertiesRequest === requests && viewport.every((v, i) => v === editor.canvas.viewportTransform[i]), "横竖切换不改变画布视野或发起展开面板请求");
    await editor.undo(); check(active().angle === 0 && !state().textVertical, "一次撤销竖版恢复横版和选中对象");
    await editor.undo(true); editor.toggleTextOrientation();
    check(active().angle === 0 && active().getCenterPoint().distanceFrom(center) < .001, "再次切换回0度，中心不漂移");
    active().rotate(37); editor.canvas.fire("object:modified", { target: active() }); editor.toggleTextOrientation();
    await editor.undo(); check(active().angle === 37 && !state().textVertical, "任意角度切竖版后撤销恢复原自由旋转角度");
    await editor.undo(true); active().rotate(115); editor.canvas.fire("object:rotating", { target: active() } as never);
    check(!state().textVertical, "手动转离90度立即退出竖版高亮");
    editor.canvas.fire("object:modified", { target: active() }); editor.toggleTextOrientation();
    await editor.duplicateSelected();
    check(active().angle === 90 && active().underline && active().linethrough && active().textAlign === "justify-left", "复制保留横竖方向、下划线、删除线和对齐");
    await editor.undo(); await editor.undo(true);
    const copy = editor.canvas.getObjects().find(item => item instanceof Textbox && item.editorId !== id) as Textbox;
    check(copy.angle === 90 && copy.underline && copy.linethrough && copy.editorTextBackground === true, "历史恢复保留文字方向及完整装饰");
    editor.selectLayer(id); await editor.addText({ x: 350, y: 100 });
    check(active().angle === 0 && active().underline && active().linethrough, "从竖版文字新增时继承样式，但新文字仍为横版");
    const newId = active().editorId!; editor.updateLayer(newId, { locked: true }); editor.toggleTextOrientation();
    check(editor.canvas.getObjects().find(item => item.editorId === newId)!.angle === 0, "锁定文字取消选择后竖版操作不改写对象");
  } finally { dispose(); }

  await ensureFont(FONT_FAMILY);
  const copy = "One two three four five six seven\nShort\nSupercalifragilisticexpialidocious";
  const options = { fontFamily: FONT_FAMILY, fontSize: 24, width: 170, splitByGrapheme: true, charSpacing: 40 };
  const normal = new ContentTextbox(copy, options);
  const justified = new ContentTextbox(copy, { ...options, textAlign: "justify-left" });
  const bounds = (text: Textbox, line: number) => { text.getLineWidth(line); return text.__charBounds[line]; };
  let expanded = 0, untouched = true, edges = true, glyphs = true;
  justified._textLines.forEach((line, i) => {
    const a = bounds(normal, i), b = bounds(justified, i);
    let last = line.length - 1; while (last >= 0 && /\s/u.test(line[last])) last--;
    const hasGap = line.slice(0, last).some(char => char === " ");
    if (!justified.isEndOfWrapping(i) && hasGap) {
      expanded++; edges &&= Math.abs(b[last].left + b[last].width - 24 * 40 / 1000 - justified.width) < .001;
    } else untouched &&= a.every((box, index) => Math.abs(box.left - b[index].left) < .001 && Math.abs(box.width - b[index].width) < .001);
    line.forEach((char, index) => { if (!/\s/u.test(char)) glyphs &&= a[index].width === b[index].width; });
  });
  check(expanded > 0 && edges, "两端对齐将非末行最后一个词推至框边，不把额外间距分配到行尾空格");
  check(untouched, "手动换行前末行、单行及无词间空白的长词行保持原排版");
  check(glyphs && justified.charSpacing === 40 && justified.text === copy, "两端对齐保留字距、原文及字形宽度");
  const assets = new Assets();
  const pixels = async (text: Textbox) => {
    text.set({ left: 200, top: 180, fill: "#000000", editorPurpose: "content" });
    const blob = await renderDocument({ size: { width: 600, height: 600 }, objects: [(text as FabricObject).toObject(SERIALIZED_PROPS)], masks: [], adjustments: { ...DEFAULT_ADJUSTMENTS } }, assets, "final", "png");
    const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = canvas.height = 600;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, 600, 600).data;
  };
  try {
    const plain = await pixels(justified);
    justified.set({ underline: true, linethrough: true });
    const decorated = await pixels(justified);
    check(plain.some((value, index) => value !== decorated[index]), "下划线和删除线实际进入最终成图像素");
    justified.set("angle", 90); const vertical = await pixels(justified);
    check(vertical.some((value, index) => value !== decorated[index]), "竖版方向实际进入最终成图");
    const clone = await justified.clone(SERIALIZED_PROPS), restored = await pixels(clone);
    check(vertical.every((value, index) => value === restored[index]), "序列化复制后的竖版装饰和两端对齐成图逐像素一致");
  } finally { assets.dispose(); }
}
