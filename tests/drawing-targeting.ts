import { createEditor } from "./editing-tools";

export async function checkDrawingTargeting(check: (condition: boolean, message: string) => void) {
  const { editor, state, click, drag, dispose } = createEditor();
  try {
    await editor.initialize(); editor.zoomTo(1);
    editor.setTool("rect"); drag(130, 130, 170, 170);
    const inner = editor.canvas.getObjects().at(-1)!.editorId!;
    for (const tool of ["rect", "circle"] as const) {
      editor.setTool(tool); editor.updateShape({ filled: false, lineWidth: 2, lineStyle: "solid", opacity: 100 });
      drag(80, 80, 240, 240);
      const outer = editor.canvas.getObjects().at(-1)!.editorId!; editor.selectLayer(outer);
      click(150, 150);
      check(state().selectedId === inner, `${tool} 选中时点击空心内部也能选择下方图形`);
      click(470, 330); click(160, 81);
      check(state().selectedId === outer, `${tool} 的细边线可直接点选`);
      for (const zoom of [.25, 1, 4]) {
        editor.zoomTo(zoom);
        // Keep the tested edge on screen even at 400%, as a user would by panning.
        editor.canvas.setViewportTransform([zoom, 0, 0, zoom, 400 - 160 * zoom, 300 - 80 * zoom]);
        click(470, 330); click(160, 80 - 2 / zoom);
        check(state().selectedId === outer, `${tool} 在 ${zoom * 100}% 缩放下边线外侧两屏幕像素仍可选中`);
      }
      editor.zoomTo(1);
      editor.updateShape({ opacity: 0 });
      check(state().layers.find(layer => layer.id === outer)?.transparent === true && state().selectedId === outer,
        `${tool} 调至完全透明后保留当前选择并标记图层状态`);
      click(150, 150);
      check(state().selectedId === inner, `${tool} 完全透明时不拦截下方对象`);
      editor.selectLayer(outer); editor.updateShape({ opacity: 100 });
      check(!state().layers.find(layer => layer.id === outer)?.transparent, `${tool} 从图层选中后可恢复可见，透明标记同步消失`);
      await editor.undo(); click(150, 150);
      check(state().selectedId === inner, `${tool} 撤销恢复 0% 后仍允许点击下方内容`);
      await editor.undo(true); editor.selectLayer(outer);
      await editor.duplicateSelected();
      const copy = state().selectedId!;
      click(150, 150);
      check(state().selectedId === inner, `${tool} 复制和重做后的空心区域继续穿透`);
      editor.selectLayer(copy); editor.deleteSelected(); editor.selectLayer(outer);
      const object = editor.canvas.getActiveObject()!;
      object.set({ angle: 30, scaleX: 1.2, scaleY: .8 }); object.setCoords();
      editor.canvas.fire("object:modified", { target: object });
      const corners = object.getCoords();
      const topCenter = corners[0].add(corners[1]).scalarMultiply(.5);
      click(470, 330); click(topCenter.x, topCenter.y);
      check(state().selectedId === outer, `${tool} 旋转和非等比缩放后的实际边线仍可选中`);
      editor.deleteSelected();
    }
    editor.selectLayer(inner); editor.updateShape({ opacity: 0 }); click(150, 150);
    check(!state().selectedId, "完全透明的实心图形也不在画布上拦截点击");
    editor.selectLayer(inner); editor.updateShape({ opacity: 50 }); click(470, 330); click(150, 150);
    check(state().selectedId === inner, "半透明实心图形仍可通过内部区域选择");
  } finally { dispose(); }
}
