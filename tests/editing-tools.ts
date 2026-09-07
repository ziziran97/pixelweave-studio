import { EditorController } from "../src/editor/EditorController";
import { ContentTextbox } from "../src/editor/ContentTextbox";
import { toBlob, validateJpeg } from "../src/editor/assets";
import { SERIALIZED_PROPS } from "../src/editor/model";
import type { EditorView } from "../src/types";
import type { EditorIntegration, ReplacementInput } from "../src/integration";
import { Ellipse, Path, Rect, Textbox } from "fabric";

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
export function createEditor(integration?: EditorIntegration) {
  const host = document.createElement("div"); host.style.cssText = "position:relative;width:800px;height:600px";
  const canvas = document.createElement("canvas"), overlay = document.createElement("canvas");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none";
  host.append(canvas, overlay); document.body.append(host);
  let view!: EditorView;
  const editor = new EditorController(canvas, overlay, host, value => { view = value; }, integration);
  const mouse = (type: string, x: number, y: number, extra: MouseEventInit = {}) => {
    const bounds = editor.canvas.upperCanvasEl.getBoundingClientRect(), v = editor.canvas.viewportTransform;
    (type === "mousedown" ? editor.canvas.upperCanvasEl : document).dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === "mouseup" ? 0 : 1,
      clientX: bounds.left + x * v[0] + v[4], clientY: bounds.top + y * v[3] + v[5], ...extra,
    }));
  };
  return { editor, state: () => view, overlay, mouse,
    confirm: (run: () => Promise<void>, accepted = true) => {
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

    editor.setTool("text"); click(70, 120); await settle(() => editor.canvas.getActiveObject() instanceof Textbox && !state().busy);
    let text = editor.canvas.getActiveObject() as ContentTextbox;
    text.text = "商品文案\n第二行"; text.exitEditing(); text.initDimensions();
    await editor.updateText({ ...state().text!, fontSize: 24, fontStyle: "italic", background: true, backgroundColor: "#ffffff", backgroundPadding: 14, backgroundRadius: 6 });
    const textId = text.editorId!;
    check(text instanceof ContentTextbox && !text.controls.tl && !!text.controls.ml && !!text.controls.mtr,
      "文字左右控制点改宽度，保留旋转且不提供拉伸字号控制点");
    check(state().layers.some(layer => layer.name === "商品文案 第二行"), "文字图层名称跟随实际文案摘要");
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
    check(submitted.texts.some(value => value.id === textId && value.text === "商品文案\n第二行"), "提交包含完整新增文案及稳定对象标识");
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
