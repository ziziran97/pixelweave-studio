import { Rect } from "fabric";
import type { EditorIntegration, ReplacementInput } from "../src/integration";
import { createEditor, frame, picture } from "./editing-tools";
import { shapeProperties } from "../src/editor/shape";
import { SHAPE_LINE_STYLES, shapeLinePattern } from "../src/editor/shapeStyles";

export async function checkShapeStyles(check: (condition: boolean, message: string) => void) {
  let submitted!: ReplacementInput;
  const integration: EditorIntegration = {
    initialImage: await picture("#ffffff"), context: { taskId: "shape-styles", imageId: "white" },
    validateTexts: async () => ({ passed: true }),
    replace: async input => { submitted = input; return { status: "failed", message: "只检查图形导出" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {},
  };
  const { editor, state, click, drag, confirm, dispose } = createEditor(integration);
  const paint = async () => { await frame(); await frame(); };
  const exportPixels = async () => {
    await confirm(() => editor.submitReplacement());
    const bitmap = await createImageBitmap(submitted.image), canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return ctx;
  };
  try {
    await editor.initialize(); editor.zoomTo(1); editor.setTool("rect");
    const legacy = shapeProperties(new Rect({ editorLineStyle: "dashed" }));
    check(legacy.opacity === 100 && legacy.lineStyle === "dashed", "旧图形默认完全不透明，保留原虚线标识");
    editor.updateShape({ color: "#ff0000", opacity: 60 });
    check(!state().canUndo && !state().canSubmit, "仅设置新图形不透明度不改写文档或撤销历史");
    drag(40, 40, 280, 180);
    const id = editor.canvas.getObjects().at(-1)!.editorId!; editor.selectLayer(id);
    check(editor.canvas.getActiveObject()!.opacity === .6, "新矩形采用预设不透明度");
    editor.updateShape({ opacity: 30 }, false); editor.updateShape({ opacity: 50 }, false); editor.finishPropertyEdit();
    await editor.undo();
    check(state().selectedId === id && state().shape.opacity === 60, "不透明度连续预览一次撤销恢复整次调整及选择");
    await editor.undo(true);
    let output = await exportPixels();
    const center = output.getImageData(140, 100, 1, 1).data;
    check(center[0] > 245 && center[1] > 120 && center[1] < 136 && center[2] > 120 && center[2] < 136, "50% 红色图形与白色底图实际混合后进入 JPG");
    let picked = ""; await editor.startColorPick(color => { picked = color; }); click(140, 100);
    check(/^#ff(7f|80)(7f|80)$/i.test(picked), "取色读取半透明图形与下方内容混合后的实际颜色");
    editor.selectLayer(id); editor.updateShape({ filled: false, lineStyle: "dotted", lineWidth: 8, radius: 12 });
    await editor.duplicateSelected();
    const duplicateId = state().selectedId!;
    check(state().shape.opacity === 50 && state().shape.lineStyle === "dotted" && editor.canvas.getActiveObject()!.strokeLineCap === "round", "复制保留图形不透明度、圆点线及圆形端点");
    editor.deleteSelected(); await editor.undo(); editor.selectLayer(duplicateId);
    check(state().shape.opacity === 50 && state().shape.lineStyle === "dotted", "删除后撤销恢复完整图形样式");
    editor.deleteSelected(); editor.selectLayer(id);

    for (const style of SHAPE_LINE_STYLES) {
      editor.updateShape({ filled: false, lineStyle: style.id, lineWidth: 8, opacity: 100 }); await paint();
      output = await exportPixels();
      await paint();
      const object = editor.canvas.getActiveObject()!;
      const expected = shapeLinePattern(style.id, 8);
      check(JSON.stringify(object.strokeDashArray) === JSON.stringify(expected.dash) && object.strokeLineCap === expected.cap,
        `${style.label} 的线型与端点样式进入实际对象`);
      // Fabric can paint selection controls on the lower canvas. Compare content only.
      click(470, 300); await paint();
      const v = editor.canvas.viewportTransform;
      const live = editor.canvas.lowerCanvasEl.getContext("2d")!.getImageData(Math.round(v[4]) + 35, Math.round(v[5]) + 35, 260, 160).data;
      const exported = output.getImageData(35, 35, 260, 160).data;
      let difference = 0;
      for (let i = 0; i < live.length; i++) if (i % 4 !== 3) difference += Math.abs(live[i] - exported[i]);
      check(difference / (260 * 160 * 3) < 5, `${style.label} 的编辑预览与最终 JPG 一致`);
      const row = output.getImageData(60, 44, 200, 1).data;
      let runs = 0, wasRed = false;
      for (let i = 0; i < row.length; i += 4) {
        const red = row[i] > 180 && row[i + 1] < 100;
        if (red && !wasRed) runs++; wasRed = red;
      }
      check(style.id === "solid" ? runs === 1 : runs >= 2, `${style.label} 实际输出具有正确的连续或间隔线段`);
      editor.selectLayer(id);
    }
    editor.updateShape({ lineWidth: 12, lineStyle: "dotted", opacity: 40 });
    editor.setTool("circle"); drag(330, 60, 430, 120); editor.selectLayer(editor.canvas.getObjects().at(-1)!.editorId!);
    check(state().shape.opacity === 40 && state().shape.lineStyle === "dotted", "小椭圆沿用最近的圆点线和不透明度");
    output = await exportPixels();
    const small = output.getImageData(330, 60, 113, 73).data;
    check(small.some((value, i) => i % 4 === 1 && value < 200) && small.some((value, i) => i % 4 === 1 && value > 248), "粗圆点小椭圆仍包含着色部分与透出的空隙");
    editor.updateShape({ filled: true }); editor.updateShape({ filled: false });
    check(state().shape.opacity === 40 && state().shape.lineStyle === "dotted" && state().shape.lineWidth === 12, "实心与边框切换保留透明程度、线型和粗细");
    editor.updateShape({ opacity: 0 });
    const transparentId = state().selectedId!;
    check(editor.canvas.getActiveObject()!.visible && state().shape.opacity === 0, "0% 不透明度保持图层显示状态和编辑选择");
    output = await exportPixels();
    check(output.getImageData(330, 60, 113, 73).data.every((value, i) => i % 4 === 3 || value > 245), "0% 图形不留下可见成图内容");
    click(470, 300); editor.selectLayer(transparentId); editor.updateShape({ opacity: 100 });
    check(state().shape.opacity === 100 && state().selectedId === transparentId, "完全透明图形可以从图层列表选中并恢复不透明度");
  } finally { dispose(); }
}
