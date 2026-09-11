import { createEditor, frame, settle } from "./editing-tools";

export async function checkKeyboardScope(check: (ok: boolean, message: string) => void) {
  const test = createEditor(), { editor, state } = test;
  const viewport = editor.canvas.wrapperEl.parentElement!;
  viewport.tabIndex = -1;
  const outside = document.createElement("button"); outside.textContent = "宿主操作"; document.body.append(outside);
  const keys = (key: string, extra: KeyboardEventInit = {}, target: EventTarget = editor.canvas.upperCanvasEl, type = "keydown") => {
    const event = new KeyboardEvent(type, { key, code: key === " " ? "Space" : key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); return event.defaultPrevented;
  };
  const fingerprint = () => JSON.stringify({ objects: editor.canvas.toObject(), selection: state().layers.filter(layer => layer.selected).map(layer => layer.id),
    tool: state().tool, workspace: state().workspace, zoom: state().zoom, masks: state().masks,
    history: (editor as unknown as { history: { index: number } }).history.index, confirmation: state().confirmation, closed: state().closed });
  const externalKeys: [string, KeyboardEventInit][] = [["Delete", {}], ["Backspace", {}], ["z", { ctrlKey: true }],
    ["z", { metaKey: true, shiftKey: true }], ["y", { ctrlKey: true }], ["Escape", {}], [" ", {}], ["ArrowRight", {}], ["d", {}], ["a", { ctrlKey: true }]];
  const unchanged = async (target: EventTarget, label: string) => {
    const before = fingerprint();
    for (const [key, extra] of externalKeys) {
      check(!keys(key, extra, target), `${label}的 ${extra.ctrlKey || extra.metaKey ? "组合" : ""}${key === " " ? "空格" : key} 不被编辑器拦截`);
      keys(key, extra, target, "keyup");
    }
    await frame();
    check(fingerprint() === before, `${label}不删除、撤销、移动图层或触发编辑器关闭`);
  };
  try {
    await editor.initialize(); editor.setTool("rect"); test.drag(40, 40, 120, 100); test.drag(180, 40, 260, 100);
    const selectedId = state().layers.find(layer => layer.purpose === "content")!.id;
    editor.selectLayer(selectedId);
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); outside.focus();
    await unchanged(outside, "宿主按钮");
    outside.blur(); await unchanged(document.body, "点击编辑器外空白后");

    viewport.focus(); outside.focus(); outside.blur();
    await unchanged(document.body, "键盘焦点离开编辑器后");

    for (const kind of ["native", "aria"] as const) {
      const modal = document.createElement(kind === "native" ? "dialog" : "div");
      if (kind === "aria") { modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); }
      modal.textContent = "宿主弹窗"; document.body.append(modal);
      if (modal instanceof HTMLDialogElement) modal.showModal();
      try { await unchanged(editor.canvas.upperCanvasEl, kind === "native" ? "宿主原生弹窗打开时" : "宿主 ARIA 弹窗打开时"); }
      finally { if (modal instanceof HTMLDialogElement) modal.close(); modal.remove(); }
    }

    for (const kind of ["native", "aria"] as const) {
      const host = document.createElement(kind === "native" ? "dialog" : "div");
      if (kind === "aria") { host.setAttribute("role", "dialog"); host.setAttribute("aria-modal", "true"); }
      document.body.append(host); host.append(viewport);
      if (host instanceof HTMLDialogElement) host.showModal();
      try {
        const x = editor.canvas.getActiveObject()!.getCenterPoint().x;
        check(keys("ArrowRight") && editor.canvas.getActiveObject()!.getCenterPoint().x === x + 1,
          `${kind} 宿主弹窗承载编辑器时方向键仍按图片像素微调`);
        keys("ArrowRight", {}, outside, "keyup"); keys("ArrowLeft"); keys("ArrowLeft", {}, outside, "keyup");
        check(editor.canvas.getActiveObject()!.getCenterPoint().x === x, "宿主弹窗中的微调在外部松键后仍正常收尾");
        check(keys("Delete") && state().layers.length === 2, `${kind} 宿主弹窗承载编辑器时删除仍可用`);
        check(keys("z", { ctrlKey: true }), "编辑器内 Ctrl+Z 仍执行撤销");
        await settle(() => !state().busy);
        check(state().layers.length === 3 && state().layers.some(layer => layer.id === selectedId), "撤销恢复被删图层及原标识");
        editor.selectLayer(selectedId);
      } finally {
        if (host instanceof HTMLDialogElement) host.close(); document.body.append(viewport); host.remove(); editor.canvas.calcOffset();
      }
    }

    const input = document.createElement("input"); viewport.append(input); input.focus();
    await unchanged(input, "编辑器内输入框"); input.remove();
    viewport.focus(); viewport.blur();
    check(keys("Delete", {}, document.body) && state().layers.length === 2, "画布持有焦点时 body 回退事件仍可删除当前图层");
    keys("z", { ctrlKey: true }); await settle(() => !state().busy);
    keys("y", { ctrlKey: true }); await settle(() => !state().busy);
    check(state().layers.length === 2, "编辑器内 Ctrl+Y 保留重做功能");
    keys("z", { ctrlKey: true }); await settle(() => !state().busy);
    keys("z", { ctrlKey: true, shiftKey: true }); await settle(() => !state().busy);
    check(state().layers.length === 2, "编辑器内 Ctrl+Shift+Z 保留重做功能");
    keys("z", { ctrlKey: true }); await settle(() => !state().busy); editor.selectLayer(selectedId);

    const hiddenModal = document.createElement("div"); hiddenModal.setAttribute("role", "dialog"); hiddenModal.setAttribute("aria-modal", "true");
    hiddenModal.hidden = true; document.body.append(hiddenModal);
    try {
      await editor.startColorPick(() => {});
      check(state().picking && document.activeElement === viewport, "开始取色将键盘焦点交回画布");
      check(!keys("Escape", {}, outside) && state().picking, "宿主区域 Esc 不取消编辑器取色");
      check(keys("Escape", {}, viewport) && !state().picking && !state().confirmation, "隐藏颜色面板不阻挡画布 Esc 取消取色");
    } finally { hiddenModal.remove(); }

    const other = createEditor();
    try {
      await other.editor.initialize(); other.editor.setTool("rect"); other.drag(30, 30, 100, 90);
      other.editor.selectLayer(other.state().layers.find(layer => layer.purpose === "content")!.id);
      check(keys("Delete", {}, other.editor.canvas.upperCanvasEl) && other.state().layers.length === 1 && state().layers.length === 3,
        "同页两个编辑器只删除收到按键的那个编辑器中的图层");
    } finally { other.dispose(); }

    editor.setTool("rect");
    const view = JSON.stringify(editor.canvas.viewportTransform);
    check(keys(" "), "编辑器内空格仍可临时平移"); test.drag(70, 150, 90, 170);
    keys(" ", {}, outside, "keyup");
    check(JSON.stringify(editor.canvas.viewportTransform) !== view, "临时平移实际改变查看位置");
    const count = state().layers.length; test.drag(60, 160, 130, 210);
    check(state().layers.length === count + 1, "在编辑器外松开空格仍收尾平移，返回可继续绘制");
    check(keys("Escape") && state().confirmation?.kind === "close", "编辑器内 Esc 保留关闭确认");
    editor.answerConfirmation(state().confirmation!.id, false); await frame();
    viewport.focus(); viewport.blur();
    await test.confirm(() => editor.requestClose());
    check(state().closed, "确认关闭后结束编辑会话");
    await unchanged(document.body, "编辑会话关闭后");
  } finally { outside.remove(); test.dispose(); }
}
