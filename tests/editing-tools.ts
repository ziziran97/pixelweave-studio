import { EditorController } from "../src/editor/EditorController";
import { ContentTextbox } from "../src/editor/ContentTextbox";
import { toBlob, validateJpeg } from "../src/editor/assets";
import { SERIALIZED_PROPS } from "../src/editor/model";
import type { EditorView } from "../src/types";
import type { EditorIntegration, ReplacementInput } from "../src/integration";
import { ActiveSelection, Ellipse, Path, Rect, Textbox } from "fabric";

export async function checkWorkspacePersistence(check: (condition: boolean, message: string) => void) {
  const { editor, state, click, drag, dispose } = createEditor();
  const clearSelectionFrame = () => {
    const object = editor.canvas.getActiveObject()!;
    editor.canvas.renderAll();
    const point = object.oCoords.mtr;
    const pixel = editor.canvas.lowerCanvasEl.getContext("2d")!.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data;
    return pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255 && object.borderColor === "#287dcc" &&
      object.cornerStrokeColor === "#287dcc" && !object.transparentCorners && object.borderOpacityWhenMoving === 1;
  };
  try {
    await editor.initialize();
    editor.setTool("rect"); drag(80, 80, 180, 140);
    const rectId = editor.canvas.getObjects().at(-1)!.editorId!;
    check(state().tool === "rect" && !state().selectedId && state().workspace === "draw", "矩形画完保持连续绘制，不选中新对象");
    editor.selectLayer(rectId);
    click(500, 400);
    const historyBefore = state().canRedo, revisionBefore = (editor as unknown as { revision: number }).revision;
    const colorBefore = editor.canvas.getObjects().find(object => object.editorId === rectId)!.fill;
    editor.updateShape({ color: "#ff0000", filled: false });
    check(!state().selectedId && state().workspace === "draw" && state().shapeKind === "rect" && state().tool === "select", "取消选择仍提供新矩形样式且不自动开始绘制");
    check(editor.canvas.getObjects().find(object => object.editorId === rectId)!.fill === colorBefore && (editor as unknown as { revision: number }).revision === revisionBefore && state().canRedo === historyBefore, "新图形样式不改已有对象，也不写入历史");
    const count = state().layers.length; click(450, 350);
    check(state().layers.length === count, "取消选择后点击画布不会误画新矩形");
    editor.activateDrawing(); drag(240, 80, 320, 140);
    const secondId = editor.canvas.getObjects().at(-1)!.editorId!; editor.selectLayer(secondId);
    check(!state().shape.filled && state().shape.color === "#ff0000", "再次点击绘制类型，新矩形采用预设样式");
    const view = [...editor.canvas.viewportTransform];
    editor.setTool("pan"); editor.setTool("select");
    check(state().selectedId === secondId && state().workspace === "draw" && editor.canvas.viewportTransform.every((n, i) => n === view[i]), "选择与平移切换保留工作区、对象和视野");
    editor.updateShape({ color: "#00ff00" });
    const request = state().propertiesRequest;
    await editor.undo();
    check(state().selectedId === secondId && state().shape.color === "#ff0000" && state().propertiesRequest === request, "撤销属性保留对象选择，不发起属性栏自动展开请求");
    await editor.undo(true);
    check(state().selectedId === secondId && state().shape.color === "#00ff00", "重做保持选择并回显恢复后的实际属性");
    const objects = [rectId, secondId].map(id => editor.canvas.getObjects().find(object => object.editorId === id)!);
    editor.canvas.setActiveObject(new ActiveSelection(objects, { canvas: editor.canvas }));
    const centers = objects.map(object => object.getCenterPoint());
    editor.canvas.fire("object:modified", { target: editor.canvas.getActiveObject()! });
    editor.updateLayer(rectId, { visible: false });
    check(state().selectedId === secondId && state().workspace === "draw", "多选中隐藏一层只移除该选择，剩余对象继续展示属性");
    await editor.undo();
    check(state().selectedId === secondId && objects.every((object, i) => editor.canvas.getObjects().find(item => item.editorId === object.editorId)!.getCenterPoint().distanceFrom(centers[i]) < .01), "撤销显隐保留仍选中的对象且不移动多选对象");
    editor.updateLayer(secondId, { locked: true });
    check(!state().selectedId && state().workspace === "draw" && state().shapeKind === "rect", "锁定当前图形后回到新绘制样式");
    editor.setTool("draw"); editor.setDrawSize(8); drag(80, 200, 180, 200);
    const brushId = state().layers.find(layer => layer.kind === "brush")!.id;
    editor.selectLayer(brushId);
    check(clearSelectionFrame(), "画笔旋转点实际渲染白色实心，选中边框及拖动状态保持清晰");
    check(Object.keys(editor.canvas.getActiveObject()!.controls).length === 9, "画笔保留八个缩放控制点及旋转控制点");
    for (const width of [15, 40, 70, 90]) editor.updateDrawing({ width }, false);
    editor.finishPropertyEdit();
    check(state().drawing?.width === 90, "连续粗细调整实时显示最终值");
    await editor.undo();
    check(state().selectedId === brushId && state().drawing?.width === 8, "连续粗细调整一次撤销回到拖动前，保留笔画选择");
    check(clearSelectionFrame(), "撤销恢复画笔后选中框仍保持统一样式");
    await editor.undo(true);
    check(state().selectedId === brushId && state().drawing?.width === 90, "一次重做恢复完整粗细调整");
    editor.updateDrawing({ width: 30 }, false); window.dispatchEvent(new Event("blur"));
    await editor.undo();
    check(state().drawing?.width === 90, "粗细预览时失焦也结束本次调整，撤销可恢复");
    editor.deleteSelected(); await editor.undo();
    check(state().workspace === "draw" && state().drawingTool === "draw" && !state().selectedId, "删除笔画及撤销删除均保留画笔工作区，不选择失效对象");
    editor.setTool("text"); await editor.addText({ x: 100, y: 250 });
    const textId = state().selectedId!;
    editor.setTool("pan"); editor.setTool("select"); click(500, 400);
    check(state().workspace === "text" && !!state().text && !state().selectedId, "文字经过选择和平移后，取消选择仍保留新文字样式");
    editor.selectLayer(textId); await editor.updateText({ ...state().text!, fontSize: 60 }); await editor.undo();
    check(state().selectedId === textId && state().workspace === "text", "撤销文字属性保留文字选择及工作区");
    check(clearSelectionFrame() && Object.keys(editor.canvas.getActiveObject()!.controls).sort().join() === "ml,mr,mtr", "文字撤销后旋转点仍为白底蓝边，保持左右调宽及旋转方式");
    const mixed = [textId, brushId].map(id => editor.canvas.getObjects().find(object => object.editorId === id)!);
    editor.canvas.setActiveObject(new ActiveSelection(mixed, { canvas: editor.canvas }));
    check(clearSelectionFrame(), "混合多选创建时立即使用统一外框和白色控制点");
    editor.setTool("pan");
    const mixedRequest = state().propertiesRequest;
    editor.updateLayer(textId, { visible: false });
    check(state().selectedId === brushId && state().workspace === "draw" && state().tool === "pan" && state().propertiesRequest === mixedRequest, "平移时混合多选减少到单选，属性跟随剩余对象但不改变模式或展开面板");
  } finally { dispose(); }
}

export async function pixelAt(blob: Blob, x: number, y: number) {
  const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d")!; context.drawImage(bitmap, 0, 0); bitmap.close();
  return [...context.getImageData(x, y, 1, 1).data];
}
export const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
export async function settle(ready: () => boolean) {
  for (let i = 0; i < 120; i++) { if (ready()) return; await frame(); }
  throw new Error("等待编辑状态超时");
}
export function createEditor(integration?: EditorIntegration, preview = false) {
  const host = document.createElement("div"); host.style.cssText = "position:relative;width:800px;height:600px";
  const canvas = document.createElement("canvas"), overlay = document.createElement("canvas");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none";
  host.append(canvas, overlay); document.body.append(host);
  let view!: EditorView;
  const editor = new EditorController(canvas, overlay, host, value => { view = value; }, integration, preview);
  const mouse = (type: string, x: number, y: number, extra: MouseEventInit = {}) => {
    const bounds = editor.canvas.upperCanvasEl.getBoundingClientRect(), v = editor.canvas.viewportTransform;
    (type === "mousedown" ? editor.canvas.upperCanvasEl : document).dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === "mouseup" ? 0 : 1,
      clientX: bounds.left + x * v[0] + v[4], clientY: bounds.top + y * v[3] + v[5], ...extra,
    }));
  };
  return { editor, state: () => view, overlay, mouse,
    confirm: <T>(run: () => Promise<T>, accepted = true) => {
      const done = run();
      if (view.confirmation) editor.answerConfirmation(view.confirmation.id, accepted);
      return done;
    },
    click: (x: number, y: number) => { mouse("mousedown", x, y); mouse("mouseup", x, y); },
    drag: (x: number, y: number, endX: number, endY: number, shiftKey = false) => {
      mouse("mousedown", x, y, { shiftKey }); mouse("mousemove", endX, endY, { shiftKey }); mouse("mouseup", endX, endY, { shiftKey });
    },
    dispose: () => { editor.dispose(); host.remove(); },
  };
}
export async function picture(color = "#123456", width = 512, height = 384, format = "image/jpeg") {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
  return toBlob(canvas, format, 1);
}

export async function checkTextWorkspace(check: (condition: boolean, message: string) => void) {
  const { editor, state, click, dispose } = createEditor();
  try {
    await editor.initialize(); editor.setTool("text"); click(50, 50); click(120, 120);
    check(state().tool === "text" && state().layers.length === 1 && !state().dirty, "文字工作区点击画布只选择，不自动新增文字");
    await editor.updateText({ ...state().text!, fontSize: 48, fill: "#ff0000" });
    check(!state().dirty && !state().canUndo, "新文字样式不修改文档或产生撤销历史");
    const firstAdd = editor.addText(); const duplicateAdd = editor.addText(); await Promise.all([firstAdd, duplicateAdd]);
    const first = editor.canvas.getActiveObject() as Textbox;
    check(state().layers.length === 2 && first.isEditing && first.fontSize === 48 && first.fill === "#ff0000", "显式添加一次创建一段文字并直接输入，采用预设样式且阻止处理中重复添加");
    await editor.addText();
    check(state().layers.length === 2 && editor.canvas.getActiveObject() === first && first.isEditing, "创建完成后短时间误连点不重复添加，仍可输入当前文字");
    await new Promise(resolve => setTimeout(resolve, 370));
    await editor.addText();
    const staggered = editor.canvas.getActiveObject() as Textbox;
    const before = first.getCenterPoint(), after = staggered.getCenterPoint();
    check(state().layers.length === 3 && after.x > before.x && after.y > before.y && staggered.isEditing, "正常再次点击可新增，文字向右下错开并立即输入");
    staggered.exitEditing(); editor.deleteSelected();
    editor.selectLayer(first.editorId!);
    click(4, 4);
    check(!first.isEditing && !state().selectedId && state().tool === "text" && !!state().text, "取消文字选择后仍提供新文字样式");
    await editor.updateText({ ...state().text!, fontSize: 64, fill: "#0000ff" });
    check(first.fontSize === 48 && first.fill === "#ff0000", "未选择时调整新文字样式不改写已有文字");
    editor.zoomTo(4); await editor.addText();
    const second = editor.canvas.getActiveObject() as Textbox;
    const center = second.getCenterPoint().transform(editor.canvas.viewportTransform);
    check(second.fontSize === 64 && second.fill === "#0000ff" && center.x > 0 && center.x < editor.canvas.width && center.y > 0 && center.y < editor.canvas.height, "放大后新文字采用新样式并落在当前可见图片区域");
    second.exitEditing(); editor.selectLayer(first.editorId!);
    check(state().tool === "text" && state().text?.fontSize === 48, "选中旧文字时回显旧文字的实际属性");
    await editor.updateText({ ...state().text!, fontSize: 52 });
    check(Number(first.fontSize) === 52 && second.fontSize === 64, "修改选中文字不会影响其他文字");
    editor.updateLayer(first.editorId!, { locked: true });
    await editor.updateText({ ...state().text!, fontSize: 30 });
    check(Number(first.fontSize) === 52 && !!first.editorLocked && !state().selectedId, "锁定移除文字选择后，修改新文字样式不会改写锁定图层");
    editor.selectLayer(second.editorId!); editor.deleteSelected(); await editor.undo();
    check(state().layers.some(layer => layer.id === second.editorId), "新增文字仍支持删除和撤销恢复");
  } finally { dispose(); }
}

export async function checkEditingTools(check: (condition: boolean, message: string) => void) {
  const source = await picture(); let submitted!: ReplacementInput;
  const integration: EditorIntegration = {
    initialImage: source, context: { taskId: "test-task", imageId: "test-image" },
    validateTexts: async () => ({ passed: true }),
    replace: async input => { submitted = input; return { status: "failed", message: "测试回执：仅检查成图，不保存" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {},
  };
  const { editor, state, mouse, click, drag, dispose, confirm } = createEditor(integration);
  const snapshot = () => JSON.stringify(editor.canvas.toObject(SERIALIZED_PROPS));
  try {
    await editor.initialize();
    check(!state().canSubmit && state().ready, "初始未修改图片不能提交替换");
    editor.activateDrawing();
    check(state().tool === "draw", "首次进入绘制默认使用画笔");
    editor.setEraseMode("brush"); drag(40, 40, 70, 40);
    check(state().hasMask && !state().canSubmit, "只画消除选区不算成图修改");
    editor.resetEraseSelection();
    editor.setTool("rect"); drag(30, 30, 90, 60, true);
    editor.selectLayer(editor.canvas.getObjects().at(-1)!.editorId!);
    let rectangle = editor.canvas.getActiveObject() as Rect;
    check(rectangle instanceof Rect && rectangle.width === rectangle.height && rectangle.fill === "#2574d8" && rectangle.strokeWidth === 0,
      "矩形默认实心，Shift 绘制正方形");
    const rectangleId = rectangle.editorId!;
    const geometry = JSON.stringify([rectangle.left, rectangle.top, rectangle.width, rectangle.height, rectangle.angle]);
    editor.updateShape({ filled: false, lineStyle: "dashed", lineWidth: 4, radius: 8, color: "#ff0000" });
    check(rectangle.fill === null && rectangle.stroke === "#ff0000" && rectangle.strokeDashArray?.[0] === 16 && rectangle.rx === 8,
      "空心矩形的颜色、虚线、粗细及圆角生效");
    editor.updateShape({ filled: true }); editor.updateShape({ filled: false });
    check(state().shape.lineWidth === 4 && state().shape.lineStyle === "dashed" && geometry === JSON.stringify([rectangle.left, rectangle.top, rectangle.width, rectangle.height, rectangle.angle]),
      "填充切换保留边框设置和几何位置");
    await editor.undo(); editor.selectLayer(rectangleId);
    check(state().shape.filled, "撤销可恢复矩形填充样式");
    editor.setTool("circle"); drag(200, 20, 245, 80, true);
    editor.selectLayer(editor.canvas.getObjects().at(-1)!.editorId!);
    const ellipse = editor.canvas.getActiveObject() as Ellipse;
    check(ellipse instanceof Ellipse && ellipse.rx === ellipse.ry && ellipse.editorColor === "#ff0000", "椭圆支持 Shift 正圆并沿用最近形状设置");
    const beforeSwitch = snapshot();
    editor.activateDrawing("rect");
    check(state().tool === "rect" && !state().selectedId && snapshot() === beforeSwitch,
      "切换绘制类型只取消选中，不转换或修改已有形状");
    editor.setTool("pan"); editor.activateDrawing();
    check(state().tool === "rect", "从其他工具返回绘制，记住本次最后使用的类型");
    editor.activateDrawing("draw");
    check(state().color === "#ff0000", "画笔沿用最近设置的形状颜色");
    editor.setColor("#00ff00"); editor.activateDrawing("circle");
    check(state().shape.color === "#00ff00", "形状沿用最近设置的画笔颜色");
    editor.setTool("draw"); editor.setColor("#00ff00"); editor.setDrawSize(12);
    drag(40, 300, 160, 300);
    const path = editor.canvas.getObjects().find(object => object instanceof Path) as Path;
    check(!!path && path.strokeWidth === 12 && state().layers.some(layer => layer.name === "画笔 1"), "画笔一笔一个独立图层，名称自动编号");
    editor.selectLayer(path.editorId!); editor.updateDrawing({ color: "#ff00ff", width: 20 });
    check(path.stroke === "#ff00ff" && path.strokeWidth === 20, "已画笔迹可修改粗细和颜色");
    editor.setTool("draw"); mouse("mousedown", 250, 300); mouse("mousemove", 280, 310);
    mouse("mousemove", 330, 310, { shiftKey: true }); mouse("mousemove", 360, 290, { shiftKey: true }); mouse("mouseup", 380, 280, { shiftKey: true });
    check(editor.canvas.getObjects().filter(object => object instanceof Path).length === 2, "自由绘制切换 Shift 直线仍保存为一笔");
    const pathCount = state().layers.length;
    editor.setTool("draw"); mouse("mousedown", 50, 330); mouse("mousemove", 80, 330);
    window.dispatchEvent(new Event("blur")); mouse("mouseup", 100, 330);
    check(state().layers.length === pathCount, "画笔失焦取消未完成笔迹，迟到松手不补画");

    editor.setTool("text"); await editor.addText({ x: 70, y: 120 }); await settle(() => editor.canvas.getActiveObject() instanceof Textbox && !state().busy);
    let text = editor.canvas.getActiveObject() as ContentTextbox;
    text.text = "Product copy\nSecond line"; text.exitEditing(); text.initDimensions();
    await editor.updateText({ ...state().text!, fontSize: 24, fontStyle: "italic", background: true, backgroundColor: "#ffffff", backgroundPadding: 14, backgroundRadius: 6 });
    const textId = text.editorId!;
    check(text instanceof ContentTextbox && !text.controls.tl && !!text.controls.ml && !!text.controls.mtr,
      "文字左右控制点改宽度，保留旋转且不提供拉伸字号控制点");
    check(state().layers.some(layer => layer.name === "Product copy Second line"), "文字图层名称跟随实际文案摘要");
    const width = text.width, height = text.height;
    await editor.duplicateSelected();
    const duplicate = editor.canvas.getActiveObject() as Textbox;
    check(duplicate.editorTextPadding === 14 && duplicate.editorTextRadius === 6 && !!duplicate.editorTextBackground && duplicate.text === text.text,
      "复制文字保留背景、留白、圆角和内容");
    editor.deleteSelected(); editor.selectLayer(textId);
    await editor.updateText({ ...state().text!, backgroundPadding: 28 }); await editor.undo(); editor.selectLayer(textId);
    text = editor.canvas.getActiveObject() as ContentTextbox;
    check(text.editorTextPadding === 14 && text.width === width && text.height === height, "撤销恢复文字背景且保留排版尺寸");
    editor.setTool("select");
    await confirm(() => editor.submitReplacement());
    const background = await pixelAt(submitted.image, 63, 115);
    check(background.slice(0, 3).every(value => value > 245), "文字四周背景留白实际进入最终 JPG，未被缓存裁切");
    check(submitted.texts.some(value => value.id === textId && value.text === "Product copy\nSecond line"), "提交包含完整新增文案及稳定对象标识");
    editor.updateLayer(textId, { visible: false }); await confirm(() => editor.submitReplacement());
    check(submitted.texts.some(value => value.id === textId), "隐藏新增文字仍参与完整文案校验");
    const hiddenPixel = await pixelAt(submitted.image, 63, 115);
    check(hiddenPixel[0] < 30 && hiddenPixel[1] > 40 && hiddenPixel[2] > 70, "隐藏文字及其背景均不进入最终成图");
    editor.setTool("draw"); editor.zoomTo(.8);
    await editor.startColorPick(color => editor.setColor(color)); click(450, 350);
    check(!state().picking && state().tool === "draw" && /^#1[0123456789abcdef]3[0123456789abcdef]5[0123456789abcdef]$/.test(state().color), "缩放后取色使用图片坐标，并返回画笔");
    const beforeCompare = snapshot(), sameSizeViewport = [...editor.canvas.viewportTransform];
    editor.setCompare(true);
    check(state().compareOriginal && editor.canvas.viewportTransform.every((value, i) => value === sameSizeViewport[i]), "同尺寸原图沿用当前缩放和位置，不自动适配");
    editor.setCompare(true); editor.setCompare(false); editor.setCompare(false);
    check(!state().compareOriginal && snapshot() === beforeCompare && editor.canvas.viewportTransform.every((value, i) => value === sameSizeViewport[i]), "重复开始或结束对比不覆盖工作视图和编辑内容");

    const before = snapshot(), initialLayerCount = state().layers.length;
    const png = await picture("#00ff00", 200, 150, "image/png");
    for (const file of [new File([png], "伪装.jpg"), new File([source], "错误.png"), new File([new Uint8Array([255,216,255,0])], "损坏.jpeg")]) {
      await confirm(() => editor.uploadReplacement(file));
      check(snapshot() === before && state().layers.length === initialLayerCount, `${file.name}被拒绝且完整保留草稿`);
    }
    const changed = await picture("#eeddcc", 220, 160);
    const cancelledUpload = editor.uploadReplacement(new File([changed], "取消.jpg"));
    check(state().confirmation?.kind === "upload", "上传已编辑图片时请求页面内确认");
    editor.answerConfirmation(state().confirmation!.id, false); await cancelledUpload;
    check(snapshot() === before, "取消放弃草稿后保持当前编辑");
    await confirm(() => editor.uploadReplacement(new File([changed], "新图.JPEG", { type: "application/octet-stream" })));
    check(state().size.width === 220 && state().size.height === 160 && state().layers.length === 1 && state().canSubmit,
      "合法 JPEG 按实际编码载入，保留自身尺寸且可直接替换");
    check(state().notice === "图片已载入，可继续编辑；点击「替换图片」后保存到任务。", "上传成功明确提示还需提交到任务");
    const uploadViewport = [...editor.canvas.viewportTransform]; editor.setCompare(true);
    check(state().compareOriginal && state().size.width === 220, "上传后对比初始不改写当前草稿尺寸");
    editor.setCompare(false);
    check(editor.canvas.viewportTransform.every((value, i) => value === uploadViewport[i]), "初始对比结束恢复上传图查看位置");
    editor.zoomTo(.8);
    const editingViewport = [...editor.canvas.viewportTransform], selected = editor.canvas.getActiveObject();
    editor.setCompare(true); editor.zoomTo(state().zoom);
    const compareZoom = state().zoom, viewport = editor.canvas.upperCanvasEl.parentElement!.parentElement!;
    viewport.style.width = "1000px";
    await settle(() => editor.canvas.width === 1000);
    check(state().zoom === compareZoom, "调整面板空间保持对比图片的缩放比例");
    editor.setCompare(false);
    check(editor.canvas.viewportTransform.every((value, i) => value === editingViewport[i] + (i === 4 ? 100 : 0)) && editor.canvas.getActiveObject() === selected,
      "对比期间画布变宽后恢复相同图片中心及选中对象");
    await confirm(() => editor.submitReplacement());
    check(submitted.source === "upload" && submitted.texts.length === 0 && submitted.width === 220, "上传来源及清空后的文案正确提交，目标图片身份保留");
    await confirm(() => editor.resetOriginal());
    check(state().size.width === 512 && !state().canSubmit, "还原初始回到进入时图片，并清除上传来源");
    await editor.undo(); await confirm(() => editor.submitReplacement());
    check(submitted.source === "upload" && submitted.width === 220, "撤销还原恢复上传图和来源");
    const jpeg = await validateJpeg(submitted.image);
    check(jpeg.width === 220 && jpeg.height === 160, "最终输出通过 JPEG 实际编码及解码校验");
  } finally { dispose(); }
}
