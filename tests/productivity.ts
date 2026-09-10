import { ActiveSelection, Point, Textbox } from "fabric";
import { prepareUploadedImage, toBlob } from "../src/editor/assets";
import { createEditor, picture, pixelAt } from "./editing-tools";
import { textProperties } from "../src/editor/text";

export async function checkProductivity(check: (ok: boolean, message: string) => void) {
  const source = document.createElement("canvas"); source.width = 80; source.height = 60;
  const ctx = source.getContext("2d")!; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, 30, 60);
  const png = await toBlob(source), uploaded = await prepareUploadedImage(new File([png], "renamed.jpeg", { type: "image/jpeg" }));
  const white = await pixelAt(uploaded.jpeg, 65, 30), red = await pixelAt(uploaded.jpeg, 10, 30);
  check(uploaded.converted && uploaded.width === 80 && uploaded.height === 60 && uploaded.jpeg.type === "image/jpeg", "实际PNG即使扩展名是JPEG也会在上传时转成同尺寸JPG");
  check(white.slice(0, 3).every(value => value > 250) && white[3] === 255 && red[0] > 245 && red[1] < 10, "PNG透明区域铺白底，已有内容保留");
  const jpeg = await picture("#123456", 96, 64), originalBytes = new Uint8Array(await jpeg.arrayBuffer());
  const kept = await prepareUploadedImage(new File([jpeg], "mislabeled.png", { type: "application/octet-stream" }));
  const keptBytes = new Uint8Array(await kept.jpeg.arrayBuffer());
  check(!kept.converted && keptBytes.length === originalBytes.length && keptBytes.every((byte, i) => byte === originalBytes[i]), "实际JPEG忽略错误扩展名和MIME标签，不重复压缩或改写原始字节");
  for (const bad of [new Blob(["GIF89a"]), new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]), new Blob([new Uint8Array([255, 216, 255, 0])])]) {
    let failed = false; try { await prepareUploadedImage(bad); } catch { failed = true; }
    check(failed, "不支持或损坏的图片明确拒绝，不伪造成功转换");
  }

  const test = createEditor(), { editor, state } = test;
  // Keep pointer coordinates stable while the visible test report grows.
  editor.canvas.wrapperEl.parentElement!.style.cssText = "position:fixed;left:0;top:0;width:800px;height:600px";
  editor.canvas.calcOffset();
  const active = () => editor.canvas.getActiveObject() as Textbox;
  try {
    await editor.initialize(); editor.setTool("text");
    let edit = editor.beginNumberEdit()!;
    editor.updateTextNumber("fontSize", 60); edit.finish();
    edit = editor.beginNumberEdit()!; editor.updateTextNumber("fontSize", 120); edit.cancel();
    check(state().text!.fontSize === 60 && !state().canUndo, "新建样式连续数值修改取消到本轮起点，不产生文档历史");
    await editor.addText({ x: 100, y: 100 }); active().exitEditing();
    const firstId = active().editorId!;
    const original = textProperties(active()), originalWidth = active().width;
    const internal = editor as unknown as { history: { index: number }; snapshot(): unknown };
    const history = internal.history.index;
    edit = editor.beginNumberEdit()!;
    for (const size of [80, 105, 150]) editor.updateTextNumber("fontSize", size);
    check(active().fontSize === 150 && state().text!.fontSize === 150 && !state().busy, "字号连续输入同步改变画布和面板，不触发字体等待");
    edit.cancel();
    check(active().fontSize === original.fontSize && active().width === originalWidth && internal.history.index === history, "Esc还原字号及文本框宽度，不新增历史");
    edit = editor.beginNumberEdit()!;
    editor.updateTextNumber("fontSize", 100); editor.updateTextNumber("fontSize", 130); edit.finish();
    await editor.undo(); check(active().fontSize === 60, "一轮连续输入只需一次撤销");
    await editor.undo(true); check(active().fontSize === 130, "重做恢复最终数值及对象选择");
    editor.updateTextNumber("charSpacing", 3); editor.finishPropertyEdit();
    edit = editor.beginNumberEdit()!; editor.updateTextNumber("fontSize", 80); edit.finish();
    check(Math.abs(active().charSpacing * active().fontSize / 1000 - 3) < .001, "实时字号调整保留字距的图片像素值");
    await editor.addText({ x: 300, y: 100 }); active().exitEditing(); const secondId = active().editorId!;
    editor.selectLayer(firstId); edit = editor.beginNumberEdit()!; editor.updateTextNumber("fontSize", 90);
    editor.selectLayer(secondId); const secondSize = active().fontSize;
    edit.cancel();
    check(!edit.active() && active().fontSize === secondSize && (editor.canvas.getObjects().find(item => item.editorId === firstId) as Textbox).fontSize === 90,
      "切换图层保留原对象预览，过期取消不能改动新对象");
    await editor.undo();
    check((editor.canvas.getObjects().find(item => item.editorId === firstId) as Textbox).fontSize === 80 && state().selectedId === secondId,
      "切换图层前数值调整已独立收尾，撤销不影响新选择");

    editor.selectLayer(firstId); editor.copySelected(); const copied = textProperties(active()), copiedText = active().text;
    const beforeCopyHistory = internal.history.index; editor.copySelected();
    check(internal.history.index === beforeCopyHistory && state().canPasteLayer === true, "复制仅保存本次编辑内的图层快照，不产生撤销记录");
    editor.selectLayer(secondId); await editor.updateText({ ...state().text!, fill: "#ee2200" });
    await editor.duplicateSelected(); await editor.pasteLayer();
    const pasteId = active().editorId!;
    check(active().text === copiedText && active().fill === copied.fill && active().fontSize === copied.fontSize && pasteId !== firstId,
      "切换并修改其他图层或使用Ctrl+D，不覆盖Ctrl+C记录的内容和样式");
    const pasted = active(), count = state().layers.length;
    await editor.pasteLayer();
    check(state().layers.length === count + 1 && active().editorId !== pasteId && active().left === pasted.left + 20 && active().top === pasted.top + 20,
      "可重复粘贴，每个副本独立并错开放置");
    await editor.undo(); check(state().layers.length === count, "每次粘贴可独立撤销");
    const both = [firstId, secondId].map(id => editor.canvas.getObjects().find(item => item.editorId === id)!);
    editor.canvas.setActiveObject(new ActiveSelection(both, { canvas: editor.canvas }));
    const multiCount = state().layers.length; editor.copySelected(); await editor.duplicateSelected();
    check(state().selectionCount === 2 && state().layers.length === multiCount, "多选不误复制其中一层，也不拆开已有多选");
    check(editor.contextSelectionAt(undefined, firstId)?.length === 2 && !editor.contextSelectionAt(undefined, pasteId),
      "右键当前多选成员保留整组选中，右键未选图层不切换目标");
    editor.setTool("pan"); check(!editor.contextSelectionAt(), "平移期间不打开图层菜单");
    editor.setTool("select");
    editor.selectLayer(firstId); editor.editSelectedText();
    check(!editor.contextSelectionAt(), "文字输入期间不打开对象菜单，保留文字编辑操作");
    const keyboardCopy = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
    const keyboardPaste = new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true });
    active().hiddenTextarea!.dispatchEvent(keyboardCopy); active().hiddenTextarea!.dispatchEvent(keyboardPaste);
    check(!keyboardCopy.defaultPrevented && !keyboardPaste.defaultPrevented && state().layers.length === multiCount, "文字输入时Ctrl+C/V保留文本剪贴板操作，不创建图层");
    active().exitEditing();

    for (const [corner, oppositeX, oppositeY, angle] of [
      ["br", "left", "top", 0], ["tl", "right", "bottom", 37], ["tr", "left", "bottom", 90], ["bl", "right", "top", 270],
    ] as const) {
      editor.selectLayer(firstId); const object = active();
      object.set({ fontSize: 40, charSpacing: 0, width: 180, angle, left: 180, top: 160 }); object.initDimensions(); object.setCoords();
      editor.canvas.fire("object:modified", { target: object }); editor.canvas.renderAll();
      const before = { size: object.fontSize, width: object.width, scaleX: object.scaleX, scaleY: object.scaleY };
      const anchor = object.getPositionByOrigin(oppositeX, oppositeY);
      const v = editor.canvas.viewportTransform, control = object.oCoords[corner];
      const start = new Point((control.x - v[4]) / v[0], (control.y - v[5]) / v[3]);
      const end = anchor.add(start.subtract(anchor).scalarMultiply(1.4));
      test.mouse("mousedown", start.x, start.y);
      test.mouse("mousemove", end.x, end.y); test.mouse("mouseup", end.x, end.y);
      check(object.fontSize > before.size && object.scaleX === before.scaleX && object.scaleY === before.scaleY &&
        Math.abs(object.width / before.width - object.fontSize / before.size) < .001,
        `${angle}度文字的${corner}角同步改变实际字号和框宽，不拉伸字形`);
      check(object.getPositionByOrigin(oppositeX, oppositeY).distanceFrom(anchor) < .02, `${corner}缩放固定对角位置`);
      await editor.undo(); check(active().fontSize === before.size && active().angle === angle, "四角一次拖动只记一步撤销，保留原旋转角度");
      await editor.undo(true); check(Object.keys(active().controls).sort().join() === "bl,br,ml,mr,mtr,tl,tr", "历史恢复保留四角、左右调宽和旋转共七个控制点");
    }
    editor.selectLayer(firstId); const object = active();
    object.set({ left: 50, top: 50, angle: 0, fontSize: 40, width: 200 }); object.initDimensions(); object.setCoords(); editor.canvas.renderAll();
    const v = editor.canvas.viewportTransform, point = object.oCoords.mr, start = { x: (point.x - v[4]) / v[0], y: (point.y - v[5]) / v[3] };
    test.drag(start.x, start.y, start.x + 80, start.y);
    check(object.fontSize === 40 && object.width > 250, "左右中点仍只调整框宽，保持字号和自动换行语义");
    for (const [size, factor, limit] of [[480, 2, 500], [10, .2, 8]]) {
      object.set({ left: 30, top: 30, angle: 0, fontSize: size, width: size * 5 }); object.initDimensions();
      editor.zoomTo(size > 400 ? .15 : 4); object.setCoords(); editor.canvas.renderAll();
      const v = editor.canvas.viewportTransform, point = object.oCoords.br;
      const start = new Point((point.x - v[4]) / v[0], (point.y - v[5]) / v[3]), anchor = object.getPositionByOrigin("left", "top");
      const end = anchor.add(start.subtract(anchor).scalarMultiply(factor));
      test.drag(start.x, start.y, end.x, end.y);
      check(object.fontSize === limit && object.scaleX === 1 && object.scaleY === 1, `四角拖动遵守${limit}px字号边界`);
    }
    editor.copySelected();
    await test.confirm(() => editor.uploadReplacement(new File([png], "new.png", { type: "image/png" })));
    check(!state().canPasteLayer && state().size.width === 80 && state().layers.length === 1, "PNG成功上传使用新尺寸并清空旧图层复制记录");
  } finally { test.dispose(); }
}
