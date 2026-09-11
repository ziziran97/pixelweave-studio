import { Point, Textbox } from "fabric";
import { createEditor } from "./editing-tools";

export async function checkLayerShortcuts(check: (ok: boolean, message: string) => void) {
  const test = createEditor(), { editor, state } = test;
  const container = editor.canvas.wrapperEl.parentElement!;
  container.style.cssText = "position:fixed;left:0;top:0;width:800px;height:600px";
  const keys = (key: string, extra: KeyboardEventInit = {}, target: EventTarget = editor.canvas.upperCanvasEl) => {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); return event.defaultPrevented;
  };
  const internals = editor as unknown as { history: { index: number }; revision: number };
  const order = () => editor.canvas.getObjects().map(object => object.editorId).join();
  const content = () => editor.canvas.getObjects().filter(object => object.editorPurpose === "content");
  const chosen = () => editor.canvas.getActiveObjects().map(object => object.editorId).sort().join();
  try {
    await editor.initialize(); editor.setTool("select");
    check(keys("a") && !state().selectionCount && !state().canUndo, "无可编辑图层时全选不选底图，也不产生历史");
    for (let i = 0; i < 5; i++) { editor.setTool("rect"); test.drag(60 + i * 100, 80, 120 + i * 100, 140); }
    const [a, b, c, hidden, locked] = content();
    editor.updateLayer(hidden.editorId!, { visible: false }); editor.updateLayer(locked.editorId!, { locked: true });
    b.set({ opacity: 0 }); b.setCoords(); editor.canvas.fire("object:modified", { target: b });
    editor.zoomTo(4); editor.canvas.relativePan(new Point(500, 200));
    editor.selectLayer(a.editorId!);
    const before = { order: order(), history: internals.history.index, revision: internals.revision,
      view: JSON.stringify(editor.canvas.viewportTransform), requests: state().propertiesRequest, workspace: state().workspace,
      centers: [a, b, c].map(object => object.getCenterPoint()) };
    check(keys("a") && state().selectionCount === 3 && [a, b, c].every(object => editor.canvas.getActiveObjects().includes(object)),
      "Ctrl+A包含视野外和完全透明图层，排除底图、隐藏和锁定图层");
    const all = editor.canvas.getActiveObject(); keys("A"); keys("a", { repeat: true }); keys("a", { ctrlKey: false, metaKey: true });
    check(editor.canvas.getActiveObject() === all && order() === before.order && internals.history.index === before.history &&
      internals.revision === before.revision && JSON.stringify(editor.canvas.viewportTransform) === before.view &&
      state().propertiesRequest === before.requests && state().workspace === before.workspace &&
      [a, b, c].every((object, i) => object.getCenterPoint().distanceFrom(before.centers[i]) < .001),
      "重复全选及Command兼容不改对象、视野、历史、工作区或面板展开请求");
    for (const key of ["ArrowUp", "ArrowDown"]) for (const shiftKey of [false, true]) {
      keys(key, { shiftKey }); check(order() === before.order && state().selectionCount === 3, "多选时层级快捷键不排序或拆开选择");
    }
    editor.selectLayer(a.editorId!);
    const firstOrder = order(), firstHistory = internals.history.index;
    keys("ArrowUp");
    check(content()[1] === a && state().selectedId === a.editorId && internals.history.index === firstHistory + 1,
      "Ctrl+↑只上移一层，保留选择并记一步历史");
    await editor.undo(); check(order() === firstOrder && state().selectedId === a.editorId, "快捷键排序可一步撤销，恢复顺序及选择");
    await editor.undo(true); check(content()[1].editorId === a.editorId, "重做恢复快捷键排序");
    keys("ArrowDown"); check(content()[0].editorId === a.editorId, "Ctrl+↓下移一层");
    const edgeHistory = internals.history.index; keys("ArrowDown"); keys("ArrowDown", { shiftKey: true });
    check(internals.history.index === edgeHistory && editor.canvas.getObjects()[0].editorPurpose === "base", "已在最下层时按下移或置底不增加历史，底图仍在最下方");
    keys("ArrowUp", { shiftKey: true }); check(content().at(-1)!.editorId === a.editorId, "Ctrl+Shift+↑置于全部新增图层上方");
    const topHistory = internals.history.index; keys("ArrowUp"); keys("ArrowUp", { shiftKey: true });
    check(internals.history.index === topHistory, "已在最上层时按上移或置顶不增加历史");
    keys("ArrowDown", { shiftKey: true, ctrlKey: false, metaKey: true });
    check(content()[0].editorId === a.editorId && editor.canvas.getObjects()[0].editorPurpose === "base", "Command+Shift+↓置底但始终在底图上方");
    const repeatedOrder = order(); keys("ArrowUp", { repeat: true });
    check(order() === repeatedOrder, "长按层级快捷键不连续移动多层");
    const currentA = () => editor.canvas.getObjects().find(object => object.editorId === a.editorId)!;
    const center = currentA().getCenterPoint();
    keys("ArrowUp", { ctrlKey: false });
    editor.canvas.upperCanvasEl.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp", bubbles: true }));
    keys("ArrowDown", { ctrlKey: false, shiftKey: true });
    editor.canvas.upperCanvasEl.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown", bubbles: true }));
    check(currentA().getCenterPoint().y === center.y + 9 && order() === repeatedOrder, "普通方向键仍微调1px，Shift方向键微调10px，不改变层级");
    const preservedOrder = order(), preservedSelection = chosen();
    for (const extra of [{ altKey: true }, { isComposing: true }]) {
      check(!keys("a", extra) && !keys("ArrowUp", extra) && order() === preservedOrder && chosen() === preservedSelection,
        "Alt组合及输入法组词不执行全选或排序");
    }
    check(!keys("a", { shiftKey: true }) && !keys("l"), "Ctrl+Shift+A及Ctrl+L不绑定图层操作");
    for (const kind of ["input", "textarea", "select", "editable", "menu", "listbox", "combobox", "slider"]) {
      const control = document.createElement(["input", "textarea", "select"].includes(kind) ? kind : "div");
      if (kind === "editable") control.contentEditable = "true"; else control.setAttribute("role", kind);
      container.append(control);
      check(!keys("a", {}, control) && !keys("ArrowUp", {}, control) && order() === preservedOrder && chosen() === preservedSelection,
        `${kind}保留原按键用途，不全选或排序背景图层`); control.remove();
    }
    const outside = document.createElement("button"); document.body.append(outside);
    check(!keys("a", {}, outside) && !keys("ArrowUp", {}, outside), "宿主区域的组合键不操作编辑器图层"); outside.remove();
    const modal = document.createElement("dialog"); document.body.append(modal); modal.showModal();
    check(!keys("a") && !keys("ArrowUp") && chosen() === preservedSelection, "独立弹窗打开时阻止背景全选及排序"); modal.close(); modal.remove();
    const hostDialog = document.createElement("dialog"); document.body.append(hostDialog); hostDialog.append(container); hostDialog.showModal();
    check(keys("a") && state().selectionCount === 3, "编辑器被宿主弹窗承载时仍能全选");
    hostDialog.close(); document.body.append(container); hostDialog.remove(); editor.canvas.calcOffset();
    editor.selectLayer(a.editorId!); editor.setCompare(true);
    check(!keys("a") && !keys("ArrowUp") && state().compareOriginal, "原图对比期间不执行图层全选或排序"); editor.setCompare(false);
    editor.setTool("pan"); check(!keys("a") && !keys("ArrowUp"), "平移模式不执行图层全选或排序");
    editor.setTool("select"); keys(" ", { ctrlKey: false, code: "Space" });
    check(!keys("a") && !keys("ArrowUp"), "空格临时平移时不执行图层全选或排序");
    editor.canvas.upperCanvasEl.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
    for (const tool of ["draw", "rect", "circle", "erase", "adjust"] as const) {
      editor.setTool(tool); check(!keys("a") && !keys("ArrowUp") && state().tool === tool, `${tool}工作模式不被全选或排序组合键打断`);
    }
    editor.setTool("select"); editor.selectLayer(a.editorId!);
    test.mouse("mousedown", 90, 110); test.mouse("mousemove", 100, 110);
    check(!keys("a") && !keys("ArrowUp"), "未完成画布手势时不执行全选及排序"); test.mouse("mouseup", 100, 110);
    editor.setTool("text"); await editor.addText({ x: 300, y: 200 }); const text = editor.canvas.getActiveObject() as Textbox;
    check(!keys("ArrowUp", {}, text.hiddenTextarea!) && text.isEditing && state().selectionCount === 1, "文字输入Ctrl+方向键不排序图层");
    keys("a", {}, text.hiddenTextarea!);
    check(text.isEditing && state().selectedId === text.editorId && state().selectionCount === 1, "文字输入Ctrl+A只操作文字，不全选图层");
    text.exitEditing(); editor.setTool("select"); keys("a", { ctrlKey: false, metaKey: true });
    check(state().selectionCount === 4, "结束文字输入后Command+A可全选文字与图形");
    editor.deleteSelected(); await editor.undo(); keys("a");
    check(state().selectionCount === 4, "全选删除及撤销后仍可再次使用全选快捷键");
  } finally { test.dispose(); }
}
