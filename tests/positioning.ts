import { ActiveSelection, Point, Textbox } from "fabric";
import { createEditor, picture, pixelAt } from "./editing-tools";
import type { EditorIntegration, ReplacementInput } from "../src/integration";

export async function checkPositioning(check: (value: boolean, message: string) => void) {
  let submitted: ReplacementInput | undefined;
  const integration: EditorIntegration = {
    initialImage: await picture(), context: { taskId: "position", imageId: "position" },
    validateTexts: async () => ({ passed: true }),
    replace: async input => { submitted = input; return { status: "failed", message: "测试结束，保留草稿" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {},
  };
  const test = createEditor(integration), { editor, state } = test;
  const keys = (key: string, extra: KeyboardEventInit = {}, target: EventTarget = editor.canvas.upperCanvasEl, type = "keydown") => {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); return event.defaultPrevented;
  };
  const press = (key: string, extra: KeyboardEventInit = {}) => { keys(key, extra); keys(key, extra, editor.canvas.upperCanvasEl, "keyup"); };
  const history = () => (editor as unknown as { history: { index: number } }).history.index;
  const object = (id: string) => editor.canvas.getObjects().find(item => item.editorId === id)!;
  const near = (a: number, b: number) => Math.abs(a - b) < .01;
  try {
    await editor.initialize();
    check(!state().canCenterSelection, "没有选中新增对象时不能居中");
    editor.setTool("rect"); test.drag(20, 30, 100, 90);
    const rectId = editor.canvas.getObjects().at(-1)!.editorId!;
    editor.selectLayer(rectId); editor.updateShape({ color: "#ff0000", radius: 8 });
    object(rectId).set({ angle: 31 }); editor.canvas.fire("object:modified", { target: object(rectId) });
    const start = object(rectId).getCenterPoint(), originalHistory = history();
    const geometry = () => { const r = object(rectId); return [r.width, r.height, r.scaleX, r.scaleY, r.angle, r.strokeWidth, r.editorRadius, r.opacity].join(); };
    const beforeGeometry = geometry(), order = editor.canvas.getObjects().map(item => item.editorId).join();
    editor.zoomTo(.37); editor.canvas.relativePan(new Point(67, -32));
    const viewport = JSON.stringify(editor.canvas.viewportTransform), request = state().propertiesRequest;
    editor.centerSelection("horizontal");
    check(near(object(rectId).getCenterPoint().x, 256) && near(object(rectId).getCenterPoint().y, start.y), "旋转矩形按当前图片水平居中，只改变横向位置");
    editor.centerSelection("vertical");
    check(near(object(rectId).getCenterPoint().y, 192) && geometry() === beforeGeometry, "垂直居中保持对象尺寸、角度、圆角和样式");
    check(JSON.stringify(editor.canvas.viewportTransform) === viewport && state().selectedId === rectId && state().propertiesRequest === request && order === editor.canvas.getObjects().map(item => item.editorId).join(), "居中保留画布视野、选择、面板请求和图层顺序");
    editor.centerSelection("horizontal"); editor.centerSelection("vertical");
    check(history() === originalHistory + 2, "两个方向居中各记一步，重复居中不新增历史");
    await editor.undo();
    check(near(object(rectId).getCenterPoint().x, 256) && near(object(rectId).getCenterPoint().y, start.y) && state().selectedId === rectId, "撤销垂直居中只恢复纵向位置并保留选择");
    await editor.undo(true);
    await test.confirm(() => editor.submitReplacement());
    const pixel = await pixelAt(submitted!.image, 256, 192);
    check(submitted!.width === 512 && submitted!.height === 384 && pixel[0] > 240 && pixel[1] < 15, "居中位置进入实际 JPG 成图且图片尺寸保持不变");

    const beforeNudge = object(rectId).getCenterPoint(), nudgeHistory = history();
    check(keys("ArrowRight"), "画布方向键由位置微调处理并阻止默认滚动");
    keys("ArrowRight", { repeat: true }); keys("ArrowRight", { repeat: true });
    check(near(object(rectId).getCenterPoint().x, beforeNudge.x + 3) && history() === nudgeHistory, "低缩放下长按实时移动图片像素，松键前不拆成多步历史");
    keys("ArrowRight", {}, editor.canvas.upperCanvasEl, "keyup");
    check(history() === nudgeHistory + 1, "一次方向键长按只产生一步历史");
    await editor.undo();
    check(object(rectId).getCenterPoint().distanceFrom(beforeNudge) < .01 && state().selectedId === rectId, "一次撤销恢复整次微调和选择");
    await editor.undo(true); editor.zoomTo(4);
    const fast = object(rectId).getCenterPoint(); press("ArrowDown", { shiftKey: true });
    check(near(object(rectId).getCenterPoint().y, fast.y + 10), "高缩放下 Shift＋方向键仍准确移动 10 个图片像素");

    const blurStart = object(rectId).getCenterPoint(), blurHistory = history();
    keys("ArrowLeft"); keys("ArrowLeft", { repeat: true }); window.dispatchEvent(new Event("blur"));
    check(history() === blurHistory + 1, "窗口失焦收尾位置微调");
    keys("ArrowLeft", { repeat: true });
    check(near(object(rectId).getCenterPoint().x, blurStart.x - 2), "失焦后残留按键重复事件不继续移动");
    keys("ArrowLeft", {}, editor.canvas.upperCanvasEl, "keyup");
    await editor.undo(); check(object(rectId).getCenterPoint().distanceFrom(blurStart) < .01, "失焦收尾后一步撤销恢复位置");
    keys("ArrowUp"); const focused = object(rectId).getCenterPoint();
    const input = document.createElement("input"); document.body.append(input); input.focus();
    keys("ArrowUp", { repeat: true }, input); input.remove();
    check(object(rectId).getCenterPoint().distanceFrom(focused) < .01, "焦点进入输入框后停止长按，不改变对象");
    await editor.undo();
    check(object(rectId).getCenterPoint().distanceFrom(blurStart) < .01, "焦点切换前的移动单独记入撤销");

    const protectedStart = object(rectId).getCenterPoint(), protectedHistory = history();
    for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) press("ArrowRight", extra);
    for (const tag of ["input", "select", "textarea", "button"]) {
      const control = document.createElement(tag); editor.canvas.upperCanvasEl.parentElement!.append(control);
      check(!keys("ArrowRight", {}, control), `${tag} 的方向键不被对象移动接管`); control.remove();
    }
    check(object(rectId).getCenterPoint().distanceFrom(protectedStart) < .01 && history() === protectedHistory, "组合快捷键和输入法不移动对象或新增历史");
    editor.setTool("pan"); editor.centerSelection("horizontal"); press("ArrowRight");
    check(!state().canCenterSelection && object(rectId).getCenterPoint().distanceFrom(protectedStart) < .01, "平移模式保留选择但禁止居中和微调");
    editor.setTool("select"); keys(" ", { code: "Space" }); press("ArrowRight"); keys(" ", { code: "Space" }, editor.canvas.upperCanvasEl, "keyup");
    check(object(rectId).getCenterPoint().distanceFrom(protectedStart) < .01, "按住空格临时平移不移动所选对象");
    editor.setCompare(true); editor.centerSelection("horizontal"); press("ArrowRight"); editor.setCompare(false);
    check(object(rectId).getCenterPoint().distanceFrom(protectedStart) < .01, "查看初始原图时禁止位置修改");
    const close = editor.requestClose(); press("ArrowRight"); editor.centerSelection("horizontal");
    editor.answerConfirmation(state().confirmation!.id, false); await close;
    check(object(rectId).getCenterPoint().distanceFrom(protectedStart) < .01, "确认弹窗期间禁止位置修改，取消后保留草稿");

    editor.setTool("circle"); test.drag(120, 30, 170, 70);
    const ellipseId = editor.canvas.getObjects().at(-1)!.editorId!;
    editor.selectLayer(ellipseId); editor.centerSelection("horizontal");
    check(near(object(ellipseId).getCenterPoint().x, 256), "椭圆支持相对图片居中");
    editor.setTool("select"); editor.canvas.setActiveObject(new ActiveSelection([object(rectId), object(ellipseId)], { canvas: editor.canvas }));
    const group = editor.canvas.getActiveObject()!;
    group.set({ angle: 17, scaleX: 1.15, scaleY: .9 }); group.setCoords();
    editor.canvas.fire("object:modified", { target: group });
    const centers = [rectId, ellipseId].map(id => object(id).getCenterPoint());
    editor.centerSelection("vertical");
    check(!state().canCenterSelection && [rectId, ellipseId].every((id, i) => object(id).getCenterPoint().distanceFrom(centers[i]) < .01), "多选不执行单个对象居中");
    press("ArrowLeft", { shiftKey: true });
    check([rectId, ellipseId].every((id, i) => near(object(id).getCenterPoint().x, centers[i].x - 10) && near(object(id).getCenterPoint().y, centers[i].y)), "旋转缩放后的多选整体微调，保持对象之间的相对位置");
    await editor.undo();
    check(state().selectionCount === 2 && [rectId, ellipseId].every((id, i) => object(id).getCenterPoint().distanceFrom(centers[i]) < .01), "多选微调一步撤销恢复全部对象及选择");
    press("ArrowDown"); editor.canvas.discardActiveObject();
    check([rectId, ellipseId].every((id, i) => near(object(id).getCenterPoint().y, centers[i].y + 1)), "解除多选后对象不跳位");
    editor.selectLayer(rectId); keys("ArrowRight"); editor.selectLayer(ellipseId);
    const switched = object(ellipseId).getCenterPoint(); keys("ArrowRight", { repeat: true });
    check(object(ellipseId).getCenterPoint().distanceFrom(switched) < .01, "按住方向键切换对象后，残留重复事件不移动新对象");
    keys("ArrowRight", {}, editor.canvas.upperCanvasEl, "keyup");
    editor.updateLayer(ellipseId, { locked: true }); const locked = object(ellipseId).getCenterPoint();
    editor.centerSelection("horizontal"); press("ArrowRight");
    check(!state().canCenterSelection && object(ellipseId).getCenterPoint().distanceFrom(locked) < .01, "锁定图层不能居中或微调");
    editor.selectLayer(rectId); editor.updateShape({ opacity: 0 }); const transparent = object(rectId).getCenterPoint();
    press("ArrowRight"); check(near(object(rectId).getCenterPoint().x, transparent.x + 1), "从图层选中的完全透明对象仍可调整位置");
    editor.updateLayer(rectId, { visible: false }); const hidden = object(rectId).getCenterPoint(); press("ArrowRight");
    check(object(rectId).getCenterPoint().distanceFrom(hidden) < .01, "隐藏图层不参与位置调整");

    editor.zoomTo(1); editor.setTool("draw"); editor.setDrawSize(13); test.drag(30, 130, 110, 160);
    const brushId = editor.canvas.getObjects().at(-1)!.editorId!; editor.selectLayer(brushId);
    editor.centerSelection("vertical");
    check(near(object(brushId).getCenterPoint().y, 192) && object(brushId).strokeWidth === 13, "画笔居中不改变粗细");
    editor.setTool("text"); await editor.addText({ x: 80, y: 250 });
    const textId = state().selectedId!, text = object(textId) as Textbox, textStart = text.getCenterPoint();
    keys("ArrowRight");
    check(text.isEditing && text.getCenterPoint().distanceFrom(textStart) < .01, "文字输入期间方向键不移动文字框");
    editor.centerSelection("horizontal");
    check(!text.isEditing && near(text.getCenterPoint().x, 256) && text.text === "Your text", "显式居中结束文字输入并保留文案");
    const textBeforeCopy = text.getCenterPoint();
    await editor.duplicateSelected(); const copyId = state().selectedId!;
    editor.centerSelection("vertical"); press("ArrowLeft");
    check(near(object(copyId).getCenterPoint().y, 192) && object(textId).getCenterPoint().distanceFrom(textBeforeCopy) < .01, "复制后的文字可独立居中和微调");
    editor.updateLayer(copyId, { visible: false }); editor.selectLayer(textId); editor.editSelectedText();
    text.set("text", " "); editor.centerSelection("vertical");
    check(!object(textId) && !state().selectedId, "空文字结束编辑删除后，居中不误移其他图层");
    await editor.undo(); check((object(textId) as Textbox).text === "Your text", "空文字删除仍一步撤销恢复原文案");

    const uploaded = new File([await picture("#123456", 300, 200)], "position.jpg", { type: "image/jpeg" });
    await test.confirm(() => editor.uploadReplacement(uploaded));
    editor.setTool("rect"); test.drag(10, 10, 50, 50);
    const uploadedRect = editor.canvas.getObjects().at(-1)!; editor.selectLayer(uploadedRect.editorId!);
    editor.centerSelection("horizontal"); editor.centerSelection("vertical");
    check(near(uploadedRect.getCenterPoint().x, 150) && near(uploadedRect.getCenterPoint().y, 100), "上传后按新图片尺寸居中，不沿用初始图片尺寸");
  } finally { test.dispose(); }
}
