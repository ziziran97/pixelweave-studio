import { FabricObject, Textbox } from "fabric";
import { createEditor, picture } from "./editing-tools";
import { ContentTextbox } from "../src/editor/ContentTextbox";
import { applyTextProperties, DEFAULT_TEXT, textProperties } from "../src/editor/text";
import { Assets } from "../src/editor/assets";
import { renderDocument } from "../src/editor/render";
import { SERIALIZED_PROPS } from "../src/editor/model";
import { DEFAULT_ADJUSTMENTS } from "../src/types";

export async function checkTextBackgroundOpacity(check: (value: boolean, message: string) => void) {
  const { editor, state, dispose } = createEditor();
  const active = () => editor.canvas.getActiveObject() as Textbox;
  try {
    await editor.initialize(); editor.setTool("text");
    check(state().text?.backgroundOpacity === 100, "文字背景默认完全不透明，兼容已有外观");
    editor.updateTextBackgroundOpacity(45, false); editor.finishPropertyEdit();
    check(state().text?.backgroundOpacity === 45 && !state().dirty && !state().canUndo, "新文字背景不透明度只改变预设，不记历史");
    await editor.addText({ x: 180, y: 140 });
    const id = active().editorId!;
    check(active().editorTextBackgroundOpacity === .45 && active().opacity === 1, "新增文字使用背景预设，文字本身保持不透明");
    await editor.updateText({ ...state().text!, background: true, underline: true, strokeEnabled: true, shadowEnabled: true });
    const geometry = () => [active().text, active().left, active().top, active().width, active().height, active().angle, active().fontSize, active().fill, active().stroke, active().shadow?.color].join();
    const before = geometry();
    for (const value of [80, 60, 30]) editor.updateTextBackgroundOpacity(value, false);
    check(state().text?.backgroundOpacity === 30 && !state().busy && geometry() === before && active().opacity === 1, "背景连续预览不加载字体，不改变文案、位置、字形或效果");
    editor.finishPropertyEdit(); await editor.undo();
    check(state().selectedId === id && state().text?.backgroundOpacity === 45, "连续调整背景一次撤销恢复原值及选择");
    await editor.undo(true); check(state().text?.backgroundOpacity === 30, "重做恢复背景最终不透明度");
    await editor.updateText({ ...state().text!, background: false });
    check(state().text?.backgroundOpacity === 30, "关闭背景保留独立不透明度");
    await editor.updateText({ ...state().text!, background: true });
    check(state().text?.backgroundOpacity === 30 && active().editorTextBackground === true, "重新开启背景恢复原独立不透明度");
    for (const apply of [false, true]) {
      const edit = editor.beginColorEdit("backgroundColor")!; edit.preview("#123456"); edit.finish(apply);
      check(state().text?.backgroundOpacity === 30, `背景颜色${apply ? "应用" : "取消"}保留独立不透明度`);
    }
    editor.updateTextBackgroundOpacity(0);
    check(active().editorTextBackgroundOpacity === 0 && active().opacity === 1 && !state().layers.find(layer => layer.id === id)?.transparent, "0%背景不将文字图层标成完全透明，文字继续可编辑");
    editor.updateTextBackgroundOpacity(40); editor.updateTextOpacity(50); editor.toggleTextOrientation();
    await editor.duplicateSelected();
    const copyId = active().editorId!;
    check(active().editorTextBackgroundOpacity === .4 && active().opacity === .5 && active().angle === 90, "复制保留背景与整体不透明度、旋转和文字效果");
    editor.updateLayer(copyId, { visible: false }); editor.updateLayer(copyId, { visible: true });
    editor.updateLayer(copyId, { locked: true }); editor.updateLayer(copyId, { locked: false }); editor.selectLayer(copyId);
    check(state().text?.backgroundOpacity === 40 && state().text?.opacity === 50, "显隐和锁定往返保留两种不透明度");
    editor.deleteSelected(); await editor.undo(); editor.selectLayer(copyId);
    check(state().text?.backgroundOpacity === 40 && state().text?.opacity === 50, "删除撤销恢复文字背景及整体不透明度");
    editor.updateTextBackgroundOpacity(0); await editor.undo();
    check(state().text?.backgroundOpacity === 40, "零背景可单步撤销恢复");
    editor.selectLayer(id);
    // A legacy object without the new field must not gain a history change on cancelled color edits.
    delete active().editorTextBackgroundOpacity; editor.canvas.fire("object:modified", { target: active() });
    const legacy = JSON.stringify((active() as FabricObject).toObject(SERIALIZED_PROPS));
    const edit = editor.beginColorEdit("backgroundColor")!; edit.preview("#abcdef"); edit.finish(false);
    check(JSON.stringify((active() as FabricObject).toObject(SERIALIZED_PROPS)) === legacy && textProperties(active()).backgroundOpacity === 100, "旧文字取消试色不新增背景元数据，按100%回显");
  } finally { dispose(); }

  const assets = new Assets();
  const capture = async (text: Textbox, format: "png" | "jpeg" = "png") => {
    const blob = await renderDocument({ size: { width: 320, height: 200 }, objects: [
      { type: "Rect", editorPurpose: "base", left: 0, top: 0, originX: "left", originY: "top", width: 320, height: 200, strokeWidth: 0, fill: "#ffffff" },
      (text as FabricObject).toObject(SERIALIZED_PROPS),
    ], masks: [], adjustments: { ...DEFAULT_ADJUSTMENTS } }, assets, "final", format);
    const image = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0); image.close();
    return ctx.getImageData(0, 0, 320, 200).data;
  };
  try {
    const text = new ContentTextbox("MMMM", { left: 70, top: 60, width: 160, originX: "left", originY: "top", editorPurpose: "content" });
    const style = { ...DEFAULT_TEXT, fontSize: 40, fill: "#ff0000", background: true, backgroundColor: "#000000", backgroundPadding: 16 };
    applyTextProperties(text, style); const full = await capture(text);
    applyTextProperties(text, { ...style, backgroundOpacity: 50 }); const half = await capture(text);
    applyTextProperties(text, { ...style, backgroundOpacity: 0 }); const clear = await capture(text);
    const sample = (pixels: Uint8ClampedArray) => pixels[(70 * 320 + 60) * 4];
    check(sample(full) === 0 && Math.abs(sample(half) - 127) <= 1 && sample(clear) === 255, `背景100%/50%/0%分别实心、混合底色及完全透明（${sample(full)}/${sample(half)}/${sample(clear)}）`);
    const glyphs: number[] = [];
    for (let i = 0; i < clear.length; i += 4) if (clear[i] > 250 && clear[i + 1] < 3 && clear[i + 2] < 3) glyphs.push(i);
    check(glyphs.length > 30 && glyphs.every(i => half[i] > 250 && half[i + 1] < 3 && half[i + 2] < 3), "半透明及全透明背景均不削弱文字实体像素");
    applyTextProperties(text, { ...style, backgroundOpacity: 50, opacity: 50 }); const combined = await capture(text);
    check(Math.abs(sample(combined) - 191) <= 1 && glyphs.every(i => Math.abs(combined[i + 1] - 127) <= 2), "背景50%叠加整体50%得到25%背景覆盖，文字仍按整体50%合成一次");
    const jpg = await capture(text, "jpeg");
    check(Math.abs(sample(jpg) - 191) <= 3, "最终JPG保留背景与整体不透明度的组合结果");
    const clone = await text.clone(SERIALIZED_PROPS), cloned = await capture(clone);
    check(combined.every((value, i) => value === cloned[i]), "背景半透明经序列化复制后成图像素一致");
    for (const angle of [0, 37, 90]) {
      text.set({ angle, left: 150, top: 100, originX: "center", originY: "center" });
      applyTextProperties(text, { ...style, backgroundOpacity: 40, underline: true, strokeEnabled: true, stroke: "#ffffff", strokeWidth: 3, shadowEnabled: true, shadowBlur: 5, shadowOffsetX: 7 });
      const opaque = await capture(text); text.set("opacity", .5); const faded = await capture(text);
      check(opaque.every((value, i) => Math.abs(faded[i] - (i % 4 === 3 ? 255 : (value + 255) / 2)) <= 2), `${angle}度半透明背景与文字装饰、描边、阴影仍按整体不透明度合成一次`);
    }
    const base = await assets.add(await picture("#ffffff", 320, 200));
    const snapshot = { size: { width: 320, height: 200 }, objects: [
      { type: "Image", editorPurpose: "base" as const, editorAssetId: base.id, width: 320, height: 200, left: 0, top: 0, originX: "left", originY: "top" },
      (text as FabricObject).toObject(SERIALIZED_PROPS),
    ], masks: [], adjustments: { ...DEFAULT_ADJUSTMENTS } };
    const source = await renderDocument(snapshot, assets, "base", "png");
    const bitmap = await createImageBitmap(source), canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    check(ctx.getImageData(0, 0, 320, 200).data.every(value => value === 255), "半透明文字背景仍不进入消除源图");
  } finally { assets.dispose(); }
}
