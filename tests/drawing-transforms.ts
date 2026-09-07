import { ActiveSelection, Path, Rect } from "fabric";
import type { CanvasEvents, FabricObject } from "fabric";
import type { EditorIntegration, ReplacementInput } from "../src/integration";
import { createEditor, picture } from "./editing-tools";
import { shapeProperties } from "../src/editor/shape";

export async function checkDrawingTransforms(check: (value: boolean, message: string) => void) {
  let submitted!: ReplacementInput;
  const integration: EditorIntegration = {
    initialImage: await picture("#ffffff"), context: { taskId: "drawing-transforms", imageId: "white" },
    validateTexts: async () => ({ passed: true }),
    replace: async input => { submitted = input; return { status: "failed", message: "仅校验成图" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {},
  };
  const { editor, state, drag, confirm, dispose } = createEditor(integration);
  const scaling = (target: FabricObject) => editor.canvas.fire("object:scaling", { target } as CanvasEvents["object:scaling"]);
  const output = async () => {
    await confirm(() => editor.submitReplacement());
    const bitmap = await createImageBitmap(submitted.image), canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!; context.drawImage(bitmap, 0, 0); bitmap.close(); return context;
  };
  const liveCorner = () => {
    editor.canvas.renderAll(); const v = editor.canvas.viewportTransform;
    return editor.canvas.lowerCanvasEl.getContext("2d")!.getImageData(105 + v[4], 85 + v[5], 35, 35).data;
  };
  const equalPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance = 1) =>
    a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length < tolerance;
  try {
    await editor.initialize(); editor.zoomTo(1); editor.setTool("rect"); editor.updateShape({ color: "#ff0000", radius: 80 });
    drag(100, 80, 220, 160); let rect = editor.canvas.getObjects().at(-1) as Rect;
    const id = rect.editorId!;
    check(rect.editorRadius === 40 && rect.rx === 40 && rect.ry === 40 && state().shape.radius === 80,
      "新矩形完成时限制圆角至短边一半，不改写下一次绘制的圆角预设");
    editor.selectLayer(id); editor.updateShape({ radius: 500 });
    check(state().shapeRadiusMax === 40 && state().shape.radius === 40, "已有矩形按尺寸限制有效圆角，输入超限值不会留下无效行程");
    editor.updateShape({ radius: 20 });
    rect.set({ scaleX: .2, scaleY: .2 }); rect.setCoords(); scaling(rect);
    check(state().shape.radius === 8 && rect.editorRadius === 20, "缩小过程中圆角受当前尺寸限制，但保留本次拖动原始圆角");
    rect.set({ scaleX: 2, scaleY: 1.5 }); rect.setCoords(); scaling(rect);
    check(rect.rx * 2 === 20 && rect.ry * 1.5 === 20 && state().shape.radius === 20, "同一次拖动重新放大后恢复原圆角，非等比拉伸仍按图片像素显示");
    const preview = liveCorner();
    editor.canvas.fire("object:modified", { target: rect });
    check(equalPixels(preview, liveCorner()), "圆角矩形拉伸中的实际角部像素与松手后保持一致");
    check(rect.width === 240 && rect.height === 120 && rect.scaleX === 1 && rect.scaleY === 1 && state().shapeRadiusMax === 60,
      "拉伸完成保持尺寸位置，圆角上限随新尺寸更新");
    let rendered = await output();
    check(equalPixels(liveCorner(), rendered.getImageData(105, 85, 35, 35).data, 4), "圆角拉伸结果进入最终 JPG，与编辑画布一致");
    await editor.undo(); rect = editor.canvas.getActiveObject() as Rect;
    check(rect.width === 120 && rect.height === 80 && shapeProperties(rect).radius === 20, "整次拉伸可一步撤销并保留原圆角");
    await editor.undo(true); rect = editor.canvas.getActiveObject() as Rect;
    check(rect.width === 240 && rect.height === 120 && rect.rx === 20 && rect.ry === 20, "重做恢复尺寸和固定像素圆角");
    rect.set({ scaleX: .1, scaleY: .1 }); rect.setCoords(); scaling(rect);
    editor.canvas.fire("object:modified", { target: rect });
    check(rect.editorRadius === 6 && state().shape.radius === 6 && state().shapeRadiusMax === 6, "缩小后正式保存有效圆角，面板不保留超出尺寸的数值");
    await editor.undo(); rect = editor.canvas.getActiveObject() as Rect;
    await editor.duplicateSelected(); const copy = editor.canvas.getActiveObject() as Rect;
    check(copy.rx === 20 && copy.ry === 20 && copy.editorRadius === 20, "复制拉伸后的矩形保留实际圆角");
    editor.deleteSelected();

    editor.setTool("draw"); editor.setColor("#ff0000"); editor.setDrawSize(20); drag(100, 300, 200, 300);
    let path = editor.canvas.getObjects().at(-1) as Path; const pathId = path.editorId!; editor.selectLayer(pathId);
    path.set({ scaleX: 2, scaleY: 3 }); path.setCoords(); editor.canvas.fire("object:modified", { target: path });
    check(path.strokeUniform && state().drawing?.width === 20 && path.getBoundingRect().height < 21,
      "非等比拉伸笔画只改变笔迹范围，实际粗细仍为面板的 20px");
    rendered = await output();
    const center = path.getCenterPoint();
    const thickness = (context: CanvasRenderingContext2D) => {
      const pixels = context.getImageData(Math.round(center.x), Math.round(center.y) - 45, 1, 90).data;
      return Array.from({ length: 90 }, (_, y) => pixels[y * 4] > 200 && pixels[y * 4 + 1] < 80).filter(Boolean).length;
    };
    check(Math.abs(thickness(rendered) - 20) <= 1, "拉伸后的笔画在最终 JPG 中仍为约 20px，而非被放大的 60px");
    editor.updateDrawing({ width: 30 }); rendered = await output();
    check(Math.abs(thickness(rendered) - 30) <= 1, "拉伸后再次调整粗细，最终成图与输入的 30px 一致");
    await editor.undo(); path = editor.canvas.getActiveObject() as Path;
    check(path.strokeUniform && path.strokeWidth === 20 && path.scaleY === 3, "撤销粗细调整保留笔画拉伸和固定粗细规则");
    await editor.duplicateSelected(); const pathCopy = editor.canvas.getActiveObject() as Path;
    check(pathCopy.strokeUniform && pathCopy.strokeWidth === 20 && pathCopy.scaleY === 3, "复制笔画保持拉伸结果及实际粗细");
    editor.deleteSelected();

    rect = editor.canvas.getObjects().find(object => object.editorId === id) as Rect;
    path = editor.canvas.getObjects().find(object => object.editorId === pathId) as Path;
    const group = new ActiveSelection([rect, path], { canvas: editor.canvas }); editor.canvas.setActiveObject(group);
    group.set({ scaleX: 1.2, scaleY: .8 }); group.setCoords(); scaling(group);
    const scale = rect.getObjectScaling();
    check(Math.abs(rect.rx * scale.x - 20) < .001 && Math.abs(rect.ry * scale.y - 20) < .001,
      "多选一起拉伸时，矩形仍保持固定像素圆角");
    editor.canvas.fire("object:modified", { target: group }); editor.canvas.discardActiveObject(); editor.selectLayer(id);
    const releasedScale = rect.getObjectScaling();
    check(Math.abs(rect.rx * releasedScale.x - 20) < .001 && state().shape.radius === 20,
      "解除多选后圆角和属性回显保持一致");
  } finally { dispose(); }
}
