import { ActiveSelection, Textbox } from "fabric";
import { createEditor, picture, settle } from "./editing-tools";

async function checkContinueDrawing(check: (ok: boolean, message: string) => void) {
  const test = createEditor(), { editor, state } = test;
  const key = (value: string, extra: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra });
    editor.canvas.upperCanvasEl.dispatchEvent(event); return event.defaultPrevented;
  };
  const history = () => (editor as unknown as { history: { index: number } }).history.index;
  try {
    await editor.initialize();
    check(key("d") && state().tool === "draw" && state().workspace === "draw" && !state().canUndo && state().layers.length === 1,
      "首次按 D 默认进入画笔，不生成对象或历史");
    editor.activateDrawing("circle"); test.drag(60, 60, 140, 120);
    const ellipse = editor.canvas.getObjects().at(-1)!;
    editor.activateDrawing("rect"); test.drag(180, 60, 260, 140);
    const rect = editor.canvas.getObjects().at(-1)!;
    key("v"); editor.selectLayer(ellipse.editorId!);
    editor.updateShape({ color: "#ff0000", opacity: 65, lineWidth: 12, filled: false });
    editor.zoomTo(.7);
    const before = { history: history(), view: JSON.stringify(editor.canvas.viewportTransform),
      objects: editor.canvas.getObjects().map(object => ({ id: object.editorId, center: object.getCenterPoint() })) };
    check(key("D") && state().tool === "circle" && state().workspace === "draw" && !state().selectedId &&
      state().shape?.color === "#ff0000" && state().shape?.opacity === 65 && state().shape?.lineWidth === 12 && !state().shape?.filled,
      "画矩形后选中并修改椭圆，D沿用当前椭圆类型及新建样式，不恢复旧矩形");
    key("d"); key("d", { repeat: true }); key("h"); key("d");
    check(state().tool === "circle" && history() === before.history && JSON.stringify(editor.canvas.viewportTransform) === before.view &&
      editor.canvas.getObjects().length === before.objects.length && editor.canvas.getObjects().every((object, i) =>
        object.editorId === before.objects[i].id && object.getCenterPoint().distanceFrom(before.objects[i].center) < .001),
      "重复D及从H返回绘制不改对象、顺序、视野或历史");
    key("v"); editor.selectLayer(rect.editorId!); key("d");
    check(state().tool === "rect" && !state().selectedId, "选择矩形后D恢复矩形绘制，不固定为画笔或椭圆");
    editor.activateDrawing("draw"); editor.setDrawSize(17); editor.setColor("#123456"); test.drag(60, 200, 140, 220);
    const brush = editor.canvas.getObjects().at(-1)!;
    editor.selectLayer(brush.editorId!); key("d");
    check(state().tool === "draw" && state().drawSize === 17 && state().color === "#123456" && !state().selectedId,
      "D恢复画笔并保留现有颜色与粗细预设");
    editor.selectLayer(rect.editorId!);
    const count = state().layers.length; key("d", { ctrlKey: true });
    await settle(() => state().layers.length === count + 1 && !state().busy);
    check(state().tool === "select" && !!state().selectedId, "Ctrl+D继续创建并选中副本，不被D绘制快捷键占用");
    const pick = editor.startColorPick(() => {});
    check(!key("d"), "准备取色期间D不切换工具"); await pick;
    check(state().picking && !key("d") && state().tool === "select", "正在取色时D保留取色与当前对象");
    editor.cancelColorPick();
    const edit = editor.beginColorEdit("shape");
    check(!!edit && !key("d") && state().tool === "select", "自定义颜色面板打开时D不切换工具"); edit?.finish(false);
  } finally { test.dispose(); }
}

export async function checkModeShortcuts(check: (ok: boolean, message: string) => void) {
  await checkContinueDrawing(check);
  for (const tool of ["rect", "circle", "draw"] as const) {
    const test = createEditor(), { editor, state } = test;
    try {
      await editor.initialize(); editor.setTool(tool);
      if (tool !== "draw") {
        test.click(40, 40);
        check(!state().notice.includes("按 V"), `${tool} 误点击不消耗首次绘制提醒`);
      }
      test.mouse("mousedown", 40, 40); test.mouse("mousemove", 80, 80);
      editor.canvas.upperCanvasEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      test.mouse("mouseup", 80, 80); test.drag(50, 50, 150, 100);
      check(state().tool === tool && !state().selectedId && state().noticePresentation === "transient" && state().notice.includes("按 V"),
        `${tool} 首次有效绘制显示提醒，取消不消耗提醒且保持连续绘制`);
      const noticeId = state().noticeId; test.drag(170, 60, 240, 120);
      check(state().noticeId === noticeId, `${tool} 连续绘制不重置提醒计时`);
      editor.activateDrawing(tool === "rect" ? "draw" : "rect");
      const switchedId = state().noticeId; test.drag(60, 140, 160, 180);
      check(state().noticeId === switchedId && state().noticePresentation === "quiet", "切换绘制类型共用已展示的提醒记录");
      await editor.undo(); await editor.undo(true); editor.activateDrawing(); test.drag(220, 140, 280, 180);
      check(!state().notice.includes("按 V"), "撤销重做不重新触发绘制提醒");
    } finally { test.dispose(); }
  }
  const test = createEditor(), { editor, state } = test;
  const keys = (key: string, extra: KeyboardEventInit = {}, target: EventTarget = editor.canvas.upperCanvasEl, type = "keydown") => {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); return event.defaultPrevented;
  };
  const history = () => (editor as unknown as { history: { index: number } }).history.index;
  try {
    await editor.initialize(); editor.setTool("rect"); test.drag(50, 50, 150, 100);
    const firstId = editor.canvas.getObjects().at(-1)!.editorId!, afterDrawing = history();
    check(keys("v") && state().tool === "select" && !state().selectedId && state().workspace === "draw", "V 退出连续绘制且不自动选择最后一个图层");
    editor.selectLayer(firstId); editor.zoomTo(.6);
    const view = JSON.stringify(editor.canvas.viewportTransform), requests = state().propertiesRequest;
    keys("h"); keys("V");
    check(state().selectedId === firstId && state().tool === "select" && state().workspace === "draw" &&
      JSON.stringify(editor.canvas.viewportTransform) === view && state().propertiesRequest === requests && history() === afterDrawing,
      "H／V 保持所选对象、工作区、视野、面板请求和历史，Caps Lock 下仍可使用");
    editor.activateDrawing("circle"); test.drag(180, 60, 240, 120);
    const selected = editor.canvas.getObjects().filter(object => object.editorPurpose === "content");
    editor.setTool("select"); editor.canvas.setActiveObject(new ActiveSelection(selected, { canvas: editor.canvas }));
    const centers = selected.map(object => object.getCenterPoint()); keys("h"); keys("v");
    check(state().selectionCount === 2 && selected.every((object, i) => object.getCenterPoint().distanceFrom(centers[i]) < .001), "多选切换模式不丢失成员或改变位置");
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) {
      check(!keys("h", extra) && state().tool === "select", "组合键、输入法组词及长按重复不触发模式切换");
      if (!("ctrlKey" in extra) && !("metaKey" in extra)) check(!keys("d", extra) && state().tool === "select", "D不响应其他组合键、输入法组词或长按重复");
    }
    const container = editor.canvas.wrapperEl.parentElement!;
    for (const kind of ["input", "textarea", "select", "editable", "menu", "listbox", "combobox", "slider"]) {
      const control = document.createElement(["input", "textarea", "select"].includes(kind) ? kind : "div");
      if (kind === "editable") control.contentEditable = "true"; else control.setAttribute("role", kind);
      container.append(control);
      check(!keys("h", {}, control) && !keys("d", {}, control) && state().tool === "select", `${kind} 输入及控件按键不切换背景画布`); control.remove();
    }
    const outside = document.createElement("button"); document.body.append(outside);
    check(!keys("h", {}, outside) && !keys("d", {}, outside) && state().tool === "select", "宿主区域的按键不触发编辑器快捷键"); outside.remove();
    const modal = document.createElement("dialog"); document.body.append(modal); modal.showModal();
    check(!keys("h") && !keys("d") && state().tool === "select", "打开弹窗后画布快捷键也被隔离"); modal.close(); modal.remove();
    const hostDialog = document.createElement("dialog"); document.body.append(hostDialog); hostDialog.append(container); hostDialog.showModal();
    check(keys("h") && state().tool === "pan", "编辑器置于宿主原生弹窗内时，H 仍能切换平移");
    check(keys("v") && state().tool === "select", "宿主弹窗内 V 可返回选择，外层容器不误判为操作阻挡");
    check(keys("d") && state().tool === "circle", "宿主弹窗承载编辑器时D可以继续绘制"); keys("v");
    hostDialog.close(); document.body.append(container); hostDialog.remove(); editor.canvas.calcOffset();
    const hostModal = document.createElement("div"); hostModal.setAttribute("role", "dialog"); hostModal.setAttribute("aria-modal", "true");
    document.body.append(hostModal); hostModal.append(container);
    check(keys("h") && state().tool === "pan", "宿主使用 ARIA 弹窗承载编辑器时快捷键也可用"); keys("v");
    document.body.append(container); hostModal.remove(); editor.canvas.calcOffset();
    editor.setCompare(true);
    check(!keys("h") && !keys("d") && state().tool === "select" && state().compareOriginal, "按住原图对比期间不切换模式"); editor.setCompare(false);
    editor.activateDrawing("draw"); keys(" ", { code: "Space" }); keys("v");
    check(!keys("d"), "空格临时平移时D不改变工具或展开请求");
    test.drag(160, 200, 180, 220); keys(" ", { code: "Space" }, editor.canvas.upperCanvasEl, "keyup");
    check(state().tool === "draw" && editor.canvas.isDrawingMode, "空格临时平移时忽略 V，松开后恢复画笔");
    for (const tool of ["draw", "rect", "circle"] as const) {
      editor.activateDrawing(tool); const count = state().layers.length;
      test.mouse("mousedown", 60, 60); test.mouse("mousemove", 130, 100);
      check(!keys("v") && !keys("h") && !keys("d") && state().tool === tool, `${tool} 拖动中不被快捷键打断`);
      test.mouse("mouseup", 130, 100);
      check(state().layers.length === count + 1 && keys("v") && state().tool === "select", "松手保存完整绘制后可立即按 V 切回选择");
    }
    editor.setTool("text"); await editor.addText({ x: 120, y: 120 }); const text = editor.canvas.getActiveObject() as Textbox;
    check(!keys("h", {}, text.hiddenTextarea!) && !keys("d", {}, text.hiddenTextarea!) && text.isEditing && state().tool === "text", "文字输入 H／D 不退出编辑或切换工具");
    check(!keys("v") && text.isEditing, "文字仍在编辑时，画布上的 V 也不结束输入"); text.exitEditing();
    keys("h"); check(state().tool === "pan", "结束文字输入后 H 恢复可用");
    editor.setTool("erase"); editor.setEraseMode("lasso"); test.click(30, 30);
    check(!keys("v") && !keys("d") && state().unfinishedSelection && state().tool === "erase", "未闭合套索不会被 V／D 取消");
    keys("Escape"); editor.setEraseMode("rect"); test.drag(30, 30, 80, 80); keys("h"); keys("v");
    check(state().hasMask && state().workspace === "erase" && state().tool === "select", "已完成消除选区在 H／V 切换后保留");
    editor.setTool("erase"); const closing = editor.requestClose();
    check(!keys("h") && !keys("d") && state().tool === "erase" && !!state().confirmation, "关闭确认期间不切换模式");
    editor.answerConfirmation(state().confirmation!.id, false); await closing;
    const upload = new File([await picture()], "mode.jpg", { type: "image/jpeg" });
    await test.confirm(() => editor.uploadReplacement(upload)); editor.activateDrawing("rect"); test.drag(40, 40, 100, 100);
    check(!state().notice.includes("按 V"), "上传新图不重复首次绘制提醒");
  } finally { test.dispose(); }
  const failure = createEditor();
  try {
    await failure.editor.initialize(); failure.editor.setTool("rect");
    await failure.editor.uploadReplacement(new File(["invalid"], "broken.jpg", { type: "image/jpeg" }));
    const notice = failure.state().notice; failure.drag(40, 40, 100, 100);
    check(failure.state().notice === notice && failure.state().noticePresentation === "persistent", "绘制提醒不覆盖持续错误或待处理事项");
  } finally { failure.dispose(); }
}
