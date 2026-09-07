import { Rect } from "fabric";
import type { EditorIntegration, ReplacementInput } from "../src/integration";
import { createEditor, frame, picture } from "./editing-tools";

export async function checkDrawingRefinements(check: (condition: boolean, message: string) => void) {
  let submitted!: ReplacementInput;
  const integration: EditorIntegration = {
    initialImage: await picture("#ffffff"), context: { taskId: "drawing-aids", imageId: "white" },
    validateTexts: async () => ({ passed: true }),
    replace: async input => { submitted = input; return { status: "failed", message: "仅检查成图" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {},
  };
  const { editor, state, overlay, mouse, click, drag, confirm, dispose } = createEditor(integration);
  const paint = async () => { await frame(); await frame(); };
  const overlayHasPixels = () => overlay.getContext("2d")!.getImageData(0, 0, overlay.width, overlay.height).data.some((v, i) => i % 4 === 3 && v > 0);
  try {
    await editor.initialize(); editor.zoomTo(1); editor.setTool("rect"); editor.updateShape({ color: "#ffffff" });
    mouse("mousedown", 100, 100); mouse("mousemove", 200, 160); await paint();
    check(overlayHasPixels(), "白色矩形绘制过程中显示独立辅助轮廓");
    mouse("mouseup", 200, 160); await paint();
    check(!state().selectedId && state().tool === "rect" && !overlayHasPixels(), "完成图形后轮廓消失，保留连续绘制且不显示控制框");
    editor.selectLayer(editor.canvas.getObjects().at(-1)!.editorId!);
    check(editor.canvas.getActiveObject()!.borderColor === "#287dcc" && !editor.canvas.getActiveObject()!.transparentCorners, "图形选中控制框使用清晰的蓝线及不透明控制点");
    click(300, 250); await paint();
    check(!overlayHasPixels() && !state().selectedId, "取消选择后没有残留图形辅助轮廓");
    await editor.startColorPick(color => editor.setColor(color)); click(100, 120);
    check(state().color === "#ffffff", "图形边缘取色不包含辅助轮廓或控制框");
    await confirm(() => editor.submitReplacement());
    const bitmap = await createImageBitmap(submitted.image), output = document.createElement("canvas");
    output.width = bitmap.width; output.height = bitmap.height;
    const ctx = output.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const boundary = ctx.getImageData(96, 96, 108, 68).data;
    check(boundary.every((value, i) => i % 4 === 3 || value > 248), "最终 JPG 的白色图形边缘不包含辅助轮廓");

    const wheel = () => {
      const bounds = editor.canvas.upperCanvasEl.getBoundingClientRect();
      editor.canvas.upperCanvasEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true,
        clientX: bounds.left + 400, clientY: bounds.top + 300, deltaY: -120 }));
    };
    for (const tool of ["rect", "circle"] as const) {
      editor.zoomTo(1); editor.setTool(tool);
      mouse("mousedown", 100, 100); mouse("mousemove", 180, 150);
      const viewport = [...editor.canvas.viewportTransform];
      wheel();
      check(editor.canvas.viewportTransform.every((value, i) => value === viewport[i]), `${tool} 绘制途中滚轮不改变缩放或图片位置`);
      mouse("mouseup", 180, 150);
      check(editor.canvas.getObjects().at(-1)!.width === 80 && editor.canvas.getObjects().at(-1)!.height === 50, `${tool} 绘制途中误滚轮不改变最终图形尺寸`);
      wheel();
      check(state().zoom > 1, `${tool} 松手后立即恢复滚轮缩放`);
    }

    for (const zoom of [.25, 1, 4]) {
      editor.zoomTo(zoom); editor.setTool("rect");
      const before = state().layers.length;
      drag(150, 150, 150 + 1 / zoom, 150 + 1 / zoom);
      check(state().layers.length === before && state().tool === "rect", `${zoom * 100}% 缩放下轻微抖动不创建图形或退出绘制`);
      drag(150, 150, 150 + 16 / zoom, 150 + 1 / zoom);
      check(state().layers.length === before + 1, `${zoom * 100}% 缩放下明确拖出的细长矩形可创建`);
      editor.setTool("circle"); drag(150, 150, 150 + 1 / zoom, 150 + 16 / zoom);
      check(state().layers.length === before + 2, `${zoom * 100}% 缩放下明确拖出的细长椭圆可创建`);
      editor.setTool("rect"); drag(150, 150, 150 + 16 / zoom, 150);
      check(state().layers.length === before + 2, `${zoom * 100}% 缩放下零面积图形仍被过滤`);
    }

    editor.zoomTo(1); editor.setTool("rect");
    mouse("mousedown", 100, 100); mouse("mousemove", 180, 140); await paint();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    mouse("mouseup", 180, 140); await paint();
    check(!overlayHasPixels() && !state().unfinishedSelection, "取消正在绘制的图形后辅助轮廓立即清除");

    editor.setTool("draw"); editor.setDrawSize(1); editor.zoomTo(.25);
    // A hover event must target the canvas; document moves only apply during a gesture.
    const target = editor.canvas.upperCanvasEl, bounds = target.getBoundingClientRect(), v = editor.canvas.viewportTransform;
    target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: bounds.left + 250 * v[0] + v[4], clientY: bounds.top + 200 * v[3] + v[5] }));
    await paint();
    const cx = Math.round(250 * v[0] + v[4]), cy = Math.round(200 * v[3] + v[5]);
    check(overlay.getContext("2d")!.getImageData(cx + 4, cy - 1, 1, 2).data.some((value, i) => i % 4 === 3 && value > 0), "缩小后的细画笔光标显示小十字定位点");
    const beforeDot = state().layers.length; click(250, 200);
    const dot = editor.canvas.getObjects().find(object => object.editorRole === "drawing");
    check(state().layers.length === beforeDot + 1 && dot?.strokeWidth === 1, "细画笔点击仍创建圆点，定位点不改变真实粗细");
    for (const color of ["#ffffff", "#202124"]) {
      editor.setDrawSize(80); editor.setColor(color); await paint();
      const ring = overlay.getContext("2d")!.getImageData(cx - 15, cy - 15, 31, 31).data;
      let dark = false, light = false;
      for (let i = 0; i < ring.length; i += 4) {
        if (ring[i + 3] < 180) continue;
        dark ||= ring[i] < 100 && ring[i + 1] < 100 && ring[i + 2] < 100;
        light ||= ring[i] > 230 && ring[i + 1] > 230 && ring[i + 2] > 230;
      }
      check(dark && light, `${color} 粗画笔光标同时有深浅轮廓，适用于白底和深色底`);
      check(state().drawSize === 80, "光标轮廓增强不改变画笔实际粗细");
    }
    editor.setTool("rect"); await paint();
    check(!overlayHasPixels(), "离开画笔后小十字定位点清除");

    // Uncommitted previews must finish before a selection change or a lost window focus.
    drag(100, 100, 180, 160);
    const id = editor.canvas.getObjects().at(-1)!.editorId!; editor.selectLayer(id);
    editor.updateShape({ filled: false, lineWidth: 2 });
    editor.updateShape({ lineWidth: 8 }, false); editor.updateShape({ lineWidth: 14 }, false);
    window.dispatchEvent(new Event("blur"));
    await editor.undo();
    check(state().selectedId === id && state().shape.lineWidth === 2 && (editor.canvas.getActiveObject() as Rect).strokeWidth === 2, "边框连续调整失焦收尾，一次撤销恢复真实描边和选择");
  } finally { dispose(); }
}
