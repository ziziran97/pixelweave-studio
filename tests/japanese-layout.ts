import { FabricObject, StaticCanvas, Textbox } from "fabric";
import { ContentTextbox } from "../src/editor/ContentTextbox";
import { ensureFont, JP_FONT_FAMILY } from "../src/editor/fonts";
import { Assets } from "../src/editor/assets";
import { SERIALIZED_PROPS } from "../src/editor/model";
import { renderDocument } from "../src/editor/render";
import { DEFAULT_ADJUSTMENTS } from "../src/types";
import { createEditor, frame } from "./editing-tools";

export async function checkJapaneseLayout(check: (value: boolean, message: string) => void) {
  await ensureFont(JP_FONT_FAMILY);
  const options = { fontFamily: JP_FONT_FAMILY, fontSize: 40, width: 420, splitByGrapheme: true, fill: "#000000" };
  const sample = "この商品はとても軽「高品質」\nこの商品はとても軽量。持ち運びに便利です。";
  const text = new ContentTextbox(sample, options);
  check(text._textLines[0].join("") === "この商品はとても軽" && text._textLines[1].join("") === "「高品質」", "自动折行将左引号带到下一行，不留在行尾");
  check(text._textLines.every(line => !/^[。、」』）]/u.test(line.join(""))) && text._textLines.flat().join("") === sample.replaceAll("\n", ""), "日文句号随前字换行，保留全部文案而不出现孤立标点");
  let boundaries = true, content = true, fits = true;
  const sentence = "日本製（高品質）、軽量バッグ！便利なポケット付き。ショップでSALE開催中「限定モデル」20% OFF。";
  for (const width of [60, 85, 170, 250, 420]) for (const charSpacing of [-50, 0, 100]) {
    const box = new ContentTextbox(sentence, { ...options, width, charSpacing });
    boundaries &&= box._textLines.every(line => !/^[、。！）」っゃュー]/u.test(line.join("")) && !/[（「]$/u.test(line.join("")));
    content &&= box._textLines.flat().join("") === sentence;
    fits &&= box._textLines.every((_, i) => box.getLineWidth(i) <= box.width + .01);
  }
  check(boundaries && content && fits, "多种窄宽度及正负字距下标点不孤立、文案不丢失、行宽不溢出");
  const narrow = new ContentTextbox("日本製（高品質）", { ...options, width: 60, textAlign: "justify-left" });
  const narrowCopy = await narrow.clone(SERIALIZED_PROPS);
  check(narrow.width === narrowCopy.width && JSON.stringify(narrow._textLines) === JSON.stringify(narrowCopy._textLines), "极窄文本框为标点组合保留最小宽度后，复制和恢复不改变换行");
  const manual = new ContentTextbox("日本製「\n。手動改行\n\n最後\n", options);
  check(manual._textLines.map(line => line.join("")).join("\n") === manual.text, "手动换行、空行及末尾换行原样保留，不自动挪动用户指定的标点");
  const graphemes = new ContentTextbox("日本か\u3099製品👩‍💻バッグ。", { ...options, width: 90 });
  check(graphemes._textLines.flat().includes("か\u3099") && graphemes._textLines.flat().includes("👩‍💻"), "换行保持组合假名和复合字符完整");
  const mixed = new ContentTextbox("軽量バッグ SALE NOW 送料無料", { ...options, width: 270 });
  check(mixed._textLines.some(line => line.join("").includes("SALE")) && mixed._textLines.some(line => line.join("").includes("NOW")), "日英混排仍优先保留完整英文单词");

  const aligned = new ContentTextbox(sentence + "\n短い行", { ...options, width: 270, textAlign: "justify-left", charSpacing: 25 });
  const plain = new ContentTextbox(aligned.text, { ...options, width: 270, charSpacing: 25 });
  let expanded = 0, finalUnchanged = true, edge = true, latinUnchanged = true;
  aligned._textLines.forEach((line, index) => {
    plain.getLineWidth(index); aligned.getLineWidth(index);
    const a = plain.__charBounds[index], b = aligned.__charBounds[index];
    let last = line.length - 1; while (last >= 0 && /\s/u.test(line[last])) last--;
    if (aligned.isEndOfWrapping(index)) finalUnchanged &&= a.every((box, i) => Math.abs(box.left - b[i].left) < .001 && Math.abs(box.width - b[i].width) < .001);
    else if (line.some(char => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char))) {
      expanded++; edge &&= Math.abs(b[last].left + b[last].width - 1 - aligned.width) < .001;
    }
    line.forEach((char, i) => {
      if (i + 1 < line.length && /[A-Z0-9]/.test(char) && /[A-Z0-9]/.test(line[i + 1])) latinUnchanged &&= Math.abs((a[i + 1].left - a[i].left) - (b[i + 1].left - b[i].left)) < .001;
    });
  });
  check(expanded > 0 && edge, "日文自动折行的非末行实际扩展到文本框右边");
  check(finalUnchanged && latinUnchanged && aligned.charSpacing === 25, "两端对齐保留末行、英文单词内部间距及用户字距");
  let cursorExact = true, offset = 0;
  aligned._textLines.forEach((line, row) => {
    line.forEach((_, column) => {
      // A soft-wrap boundary is also the previous line's end in Fabric.
      const index = column + 1, cursor = aligned.get2DCursorLocation(offset + index);
      const caret = aligned._getCursorBoundariesOffsets(offset + index, true);
      const expected = aligned.__charBounds[row][index].left - (index === line.length ? 1 : 0);
      cursorExact &&= cursor.lineIndex === row && cursor.charIndex === index && Math.abs(caret.left - expected) < .001;
    });
    offset += line.length + aligned.missingNewlineOffset(row);
  });
  check(cursorExact, "日文重排和两端对齐后每个字符的编辑索引与光标位置一致");

  const assets = new Assets(), surface = new StaticCanvas(undefined, { width: 560, height: 500, enableRetinaScaling: false, backgroundColor: "#ffffff" });
  const raster = async (object: Textbox) => {
    const blob = await renderDocument({ size: { width: 560, height: 500 }, objects: [(object as FabricObject).toObject(SERIALIZED_PROPS)], masks: [], adjustments: { ...DEFAULT_ADJUSTMENTS } }, assets, "final", "png");
    const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = 560; canvas.height = 500;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 560, 500); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, 560, 500).data;
  };
  try {
    const object = new ContentTextbox("この商品はとても軽量。持ち運びに便利です。", { ...options, left: 25, top: 25, textAlign: "justify-left", editorPurpose: "content", underline: true });
    surface.add(object); surface.renderAll();
    const preview = surface.getContext().getImageData(0, 0, 560, 500).data, final = await raster(object);
    const different = preview.reduce((count, value, index) => count + Number(value !== final[index]), 0);
    check(different === 0, `日文标点换行与两端对齐的编辑预览和成图逐像素一致（差异 ${different}）`);
    object.set("textAlign", "left"); object.initDimensions(); const left = await raster(object);
    check(left.some((value, index) => value !== final[index]), "日文两端对齐实际改变字形绘制位置，不只改变光标和控制框");
    surface.renderAll(); const leftPreview = surface.getContext().getImageData(0, 0, 560, 500).data;
    check(left.every((value, index) => value === leftPreview[index]), "退出两端对齐后预览与成图仍一致，不保留旧对齐的绘制状态");
    object.set({ textAlign: "justify-left", angle: 90, stroke: "#000000", strokeWidth: 1 }); object.initDimensions();
    const rotated = await raster(object), clone = await object.clone(SERIALIZED_PROPS), restored = await raster(clone);
    check(rotated.every((value, index) => value === restored[index]), "日文对齐、描边和旋转经序列化复制后成图一致");
  } finally { await surface.dispose(); assets.dispose(); }

  const { editor, state, click, dispose } = createEditor();
  const active = () => editor.canvas.getActiveObject() as Textbox;
  try {
    await editor.initialize(); editor.setTool("text"); await editor.updateText({ ...state().text!, fontFamily: JP_FONT_FAMILY, fontWeight: "400" }); await editor.addText({ x: 40, y: 40 });
    active().hiddenTextarea!.value = sample; active().hiddenTextarea!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    const id = active().editorId!; click(2, 2); await frame(); editor.selectLayer(id);
    const originalLines = JSON.stringify(active()._textLines);
    await editor.updateText({ ...state().text!, textAlign: "justify-left" });
    await editor.undo(); check(active().text === sample && active().textAlign === "left" && JSON.stringify(active()._textLines) === originalLines, "撤销日文对齐保留原文、折行和选择");
    await editor.undo(true); const justifiedLines = JSON.stringify(active()._textLines); await editor.duplicateSelected();
    check(active().textAlign === "justify-left" && active().text === sample && JSON.stringify(active()._textLines) === justifiedLines, "重做及复制保留日文自动折行与两端对齐");
  } finally { dispose(); }
}
