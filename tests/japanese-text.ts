import { FabricObject, Textbox } from "fabric";
import { createEditor, frame } from "./editing-tools";
import { FONT_FAMILY, JP_FONT_FAMILY, JP_FONT_WEIGHTS, ensureFont } from "../src/editor/fonts";
import { DEFAULT_TEXT, applyTextProperties, toggleTextBold } from "../src/editor/text";
import { ContentTextbox } from "../src/editor/ContentTextbox";
import { SERIALIZED_PROPS } from "../src/editor/model";
import { Assets } from "../src/editor/assets";
import { renderDocument } from "../src/editor/render";
import { DEFAULT_ADJUSTMENTS } from "../src/types";

export async function checkJapaneseText(check: (value: boolean, message: string) => void) {
  const { editor, state, click, dispose } = createEditor();
  const active = () => editor.canvas.getActiveObject() as Textbox;
  const copy = "日本製の高品質バッグ\n軽量・コンパクト 20% OFF";
  try {
    await editor.initialize(); editor.setTool("text"); await editor.addText({ x: 40, y: 40 });
    active().exitEditing();
    const id = active().editorId!, previous = JSON.stringify((active() as FabricObject).toObject(SERIALIZED_PROPS));
    // Latin Regular is already loaded. JP Regular must use a different cache key.
    const NativeFontFace = window.FontFace;
    window.FontFace = class { load() { return Promise.reject(new Error("测试日文字体断网")); } } as unknown as typeof FontFace;
    try { await editor.updateText({ ...state().text!, fontFamily: JP_FONT_FAMILY, fontWeight: "400", fontStyle: "normal" }); }
    finally { window.FontFace = NativeFontFace; }
    check(!!state().textFontError?.includes("日文") && JSON.stringify((active() as FabricObject).toObject(SERIALIZED_PROPS)) === previous, "已缓存拉丁Regular仍独立加载日文，失败完整保留原文字及样式");
    await editor.retryTextFont();
    check(active().fontFamily === JP_FONT_FAMILY && !state().textFontError, "日文字体重试成功后才应用，清除失败提示");
    editor.editSelectedText();
    active().hiddenTextarea!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    active().hiddenTextarea!.value = copy;
    active().hiddenTextarea!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText" }));
    check(active().text === copy && active().isEditing, "日文字体下输入法保留汉字、假名、标点、英文和换行");
    active().hiddenTextarea!.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: copy }));
    click(2, 2); await frame(); editor.selectLayer(id);
    await editor.updateText({ ...state().text!, fontWeight: "500" });
    await editor.updateText(toggleTextBold(state().text!)); await editor.updateText(toggleTextBold(state().text!));
    check(active().fontWeight === "500" && active().fontFamily === JP_FONT_FAMILY && active().fontStyle === "normal", "日文加粗使用真实Bold，再次点击恢复当前家族Medium");
    const position = [active().left, active().top, active().width], viewport = [...editor.canvas.viewportTransform];
    await editor.updateText({ ...state().text!, fontFamily: FONT_FAMILY, fontWeight: "500", fontStyle: "italic" });
    await editor.updateText({ ...state().text!, fontFamily: JP_FONT_FAMILY, fontWeight: "700", fontStyle: "normal", boldRestoreWeight: undefined });
    check(active().text === copy && position.every((v, i) => v === [active().left, active().top, active().width][i]) && viewport.every((v, i) => v === editor.canvas.viewportTransform[i]), "切换日文家族及字重保留原文、文本框位置宽度和画布视野");
    await editor.undo(); check(active().fontFamily === FONT_FAMILY && active().fontStyle === "italic", "日文字体切换可一步撤销为原拉丁斜体");
    await editor.undo(true); check(active().fontFamily === JP_FONT_FAMILY && active().fontWeight === "700" && active().fontStyle === "normal", "重做等待真实日文字体就绪并恢复Bold");
    await editor.updateText({ ...state().text!, background: true, underline: true, opacity: 50, strokeEnabled: true, shadowEnabled: true });
    await editor.duplicateSelected(); const cloneId = active().editorId!;
    check(active().fontFamily === JP_FONT_FAMILY && active().text === copy && active().opacity === .5 && active().underline && active().editorTextBackground === true, "复制日文保留文案、字体、字重和组合样式");
    editor.updateLayer(cloneId, { visible: false, locked: true }); await editor.undo(); editor.selectLayer(cloneId);
    check(active().fontFamily === JP_FONT_FAMILY && active().fontWeight === "700" && active().visible && !active().editorLocked, "日文显隐锁定及历史恢复不替换字体");
    editor.setTool("select"); click(2, 2); await frame();
    const historyBefore = (editor as unknown as { revision: number }).revision;
    await editor.updateText({ ...state().text!, fontFamily: JP_FONT_FAMILY, fontWeight: "400", fontStyle: "normal" });
    check((editor as unknown as { revision: number }).revision === historyBefore, "选择日文新文字样式不增加历史或改动已有文字");
    await editor.addText({ x: 300, y: 40 });
    check(active().fontFamily === JP_FONT_FAMILY && active().fontWeight === "400" && active().isEditing, "新添加采用日文预设并直接进入输入");
    let rejected = false;
    try { await ensureFont(JP_FONT_FAMILY, "400", "italic"); } catch { rejected = true; }
    check(rejected, "字体加载层拒绝未提供的日文斜体，不伪造斜体文件");
    for (const variant of JP_FONT_WEIGHTS) await ensureFont(JP_FONT_FAMILY, variant.value);
    const faces = [...document.fonts].filter(face => face.family.replaceAll('"', '') === JP_FONT_FAMILY && face.status === "loaded");
    check(JP_FONT_WEIGHTS.every(item => faces.some(face => face.weight === item.value && face.style === "normal")), "三个日文字重均有独立加载成功的真实FontFace");
  } finally { dispose(); }

  const assets = new Assets();
  const raster = async (text: Textbox) => {
    const blob = await renderDocument({ size: { width: 620, height: 300 }, objects: [(text as FabricObject).toObject(SERIALIZED_PROPS)], masks: [], adjustments: { ...DEFAULT_ADJUSTMENTS } }, assets, "final", "png");
    const image = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = 620; canvas.height = 300;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 620, 300); ctx.drawImage(image, 0, 0); image.close(); return ctx.getImageData(0, 0, 620, 300).data;
  };
  try {
    const text = new ContentTextbox(copy, { left: 25, top: 25, width: 550, editorPurpose: "content", editorRole: "text" });
    applyTextProperties(text, { ...DEFAULT_TEXT, fontFamily: JP_FONT_FAMILY, fontSize: 32, fill: "#000000" });
    const regular = await raster(text);
    check(regular.filter((value, index) => index % 4 === 0 && value < 128).length > 1000, "日文混排文案实际进入最终图片，成图不是空白");
    text.set("fontWeight", "700"); text.initDimensions(); const bold = await raster(text);
    const regularInk = regular.filter((value, index) => index % 4 === 0 && value < 128).length, boldInk = bold.filter((value, index) => index % 4 === 0 && value < 128).length;
    check(boldInk > regularInk, `日文真实Bold在成图中增加笔画覆盖，未沿用Regular缓存（${regularInk} → ${boldInk}）`);
    const clone = await text.clone(SERIALIZED_PROPS), cloned = await raster(clone);
    check(bold.every((value, index) => value === cloned[index]), "日文字体及混排文案经序列化复制后成图逐像素一致");
  } finally { assets.dispose(); }
}
