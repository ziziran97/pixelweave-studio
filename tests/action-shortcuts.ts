import { ActiveSelection, Textbox } from "fabric";
import { editorConfig } from "../src/config";
import type { DocumentSnapshot } from "../src/types";
import { createEditor, frame, picture, settle } from "./editing-tools";

export async function checkActionShortcuts(check: (ok: boolean, message: string) => void) {
  const fixture = createEditor(), { editor, state, drag, click, mouse } = fixture;
  const target = editor.canvas.upperCanvasEl, container = editor.canvas.wrapperEl.parentElement!;
  const key = (key: string, extra: KeyboardEventInit = {}, node: EventTarget = target, type = "keydown") => {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...extra });
    node.dispatchEvent(event); return event.defaultPrevented;
  };
  const probe = editor as unknown as { snapshot: () => DocumentSnapshot; history: { index: number }; revision: number };
  const documentState = () => JSON.stringify({ snapshot: probe.snapshot(), history: probe.history.index, revision: probe.revision });
  const viewport = () => JSON.stringify(editor.canvas.viewportTransform);
  const originalFetch = window.fetch, originalUrl = editorConfig.eraseApiUrl;
  let requests = 0, respond: (() => void) | undefined;
  const blocked = (label: string, node: EventTarget = target) => {
    const before = documentState(), view = viewport(), count = requests, points = state().lassoPoints, compare = state().compareOriginal, operation = state().maskOperation;
    check(["f", "1", "c", "x"].every(value => !key(value, {}, node)) && !key("Enter", { ctrlKey: true }, node) && !key("Enter", { metaKey: true }, node) &&
      documentState() === before && viewport() === view && state().lassoPoints === points && state().compareOriginal === compare && state().maskOperation === operation && requests === count,
      `${label}：查看、增减选区与开始消除快捷键不改变草稿或发起请求`);
  };
  try {
    editorConfig.eraseApiUrl = "/__action_shortcuts__";
    const output = await picture("#008844");
    window.fetch = async (url, options) => {
      if (url !== editorConfig.eraseApiUrl) return originalFetch(url, options);
      requests++;
      return new Promise<Response>(resolve => { respond = () => resolve(new Response(output)); });
    };
    blocked("初始图片未就绪");
    await editor.openImage(await picture(), "查看与消除快捷键", false);
    check(!key("Enter", { ctrlKey: true }) && !state().task && !state().canUndo, "无选区时组合键不发起请求或产生历史");
    editor.setTool("erase");
    check(!key("x") && state().maskOperation === "add" && !state().canUndo, "没有选区时 X 不进入减去模式");
    editor.setEraseMode("rect"); drag(30, 30, 120, 100);
    editor.setBrushSize(87); editor.setMaskOperation("subtract");
    editor.setTool("rect"); drag(180, 120, 260, 190); drag(290, 140, 350, 200);
    const objects = editor.canvas.getObjects().filter(object => object.editorPurpose === "content");
    editor.setTool("select"); editor.canvas.setActiveObject(new ActiveSelection(objects, { canvas: editor.canvas }));
    editor.fit(); const fitted = viewport();
    for (const tool of ["select", "pan", "erase", "draw", "rect", "circle", "text", "adjust"] as const) {
      editor.setTool(tool); editor.zoomTo(2.5);
      const before = documentState(), selected = editor.canvas.getActiveObjects().map(object => object.editorId).join(), properties = state().propertiesRequest, workspace = state().workspace;
      check(key("F") && viewport() === fitted && documentState() === before && state().tool === tool &&
        editor.canvas.getActiveObjects().map(object => object.editorId).join() === selected && state().workspace === workspace && state().propertiesRequest === properties &&
        state().brushSize === 87 && state().maskOperation === "subtract", `${tool}：F 与适配按钮一致，保留选择、工具、消除设置、完整选区和历史`);
      check(!state().task && (tool === "erase" || !key("Enter", { ctrlKey: true })), `${tool}：开始消除快捷键仅限消除笔模式`);
      editor.zoomTo(2.5); editor.zoomTo(1); const actual = viewport(); editor.zoomTo(2.5);
      check(key("1") && state().zoom === 1 && viewport() === actual && documentState() === before && state().propertiesRequest === properties && state().tool === tool,
        `${tool}：1 与 100% 按钮采用相同中心，保留草稿、工具与面板状态`);
      const editingView = viewport();
      check(key("c", { code: "KeyC" }) && state().compareOriginal, `${tool}：按住 C 可查看初始原图`);
      key("c", { code: "KeyC" }, target, "keyup");
      check(!state().compareOriginal && viewport() === editingView && documentState() === before && state().tool === tool &&
        editor.canvas.getActiveObjects().map(object => object.editorId).join() === selected && state().propertiesRequest === properties,
        `${tool}：松开 C 完整恢复视野、选择、草稿和工具`);
      if (tool !== "erase") check(!key("x") && state().maskOperation === "subtract", `${tool}：X 不修改消除选区模式`);
    }
    editor.setTool("erase"); editor.zoomTo(2);
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) {
      const before = viewport();
      check(!key("f", extra) && viewport() === before, "F 忽略组合键、长按重复和输入法组词");
      const operation = state().maskOperation;
      check(["1", "c", "x"].every(value => !key(value, extra)) && viewport() === before && !state().compareOriginal && state().maskOperation === operation,
        "1／C／X 忽略组合键、长按重复和输入法组词");
    }
    for (const extra of [{ altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) {
      check(!key("Enter", { ctrlKey: true, ...extra }) && !state().task, "开始消除不响应额外修饰键、长按重复或输入法组词");
    }
    for (const kind of ["input", "textarea", "select", "editable", "menu", "listbox", "combobox", "slider"]) {
      const control = document.createElement(["input", "textarea", "select"].includes(kind) ? kind : "div");
      if (kind === "editable") control.contentEditable = "true"; else control.setAttribute("role", kind);
      container.append(control); blocked(kind, control); control.remove();
    }
    const outside = document.createElement("button"); document.body.append(outside);
    blocked("编辑器外", outside); outside.remove();
    const modal = document.createElement("dialog"); document.body.append(modal); modal.showModal();
    blocked("另一个弹窗打开"); modal.close(); modal.remove();
    editor.setCompare(true); blocked("原图对比"); editor.setCompare(false);
    editor.setTool("adjust"); editor.setAdjustments({ ...state().adjustments, brightness: 12 }, true);
    editor.setCompareAdjustments(true); blocked("调色前对比"); editor.setCompareAdjustments(false);
    editor.setTool("erase"); editor.setMaskHidden(true); blocked("临时隐藏选区"); editor.setMaskHidden(false);
    key(" ", { code: "Space" }); blocked("空格临时平移"); key(" ", { code: "Space" }, target, "keyup");
    const picking = editor.startColorPick(() => {}); blocked("准备取色"); await picking;
    blocked("取色中"); editor.cancelColorPick();
    const color = editor.beginColorEdit("overlay"); check(!!color, "创建自定义颜色草稿"); blocked("自定义颜色面板"); color?.finish(false);
    for (const tool of ["erase", "draw", "rect", "circle", "pan"] as const) {
      editor.setTool(tool); mouse("mousedown", 30, 30); mouse("mousemove", 70, 60);
      blocked(`${tool} 手势尚未松手`); mouse("mouseup", 70, 60);
    }
    editor.setTool("text"); await editor.addText({ x: 130, y: 140 });
    const text = editor.canvas.getActiveObject() as Textbox;
    blocked("正在编辑文字", text.hiddenTextarea!); blocked("文字仍在编辑时收到画布按键"); text.exitEditing();
    editor.setTool("erase"); editor.setMaskOperation("add"); editor.setEraseMode("lasso");
    click(25, 25); click(90, 25); click(90, 90); blocked("已有选区且新套索尚未闭合");
    const masks = state().masks;
    check(key("Enter") && !state().unfinishedSelection && state().masks === masks + 1 && !state().task, "单独 Enter 仍只闭合套索，不开始消除");
    const closing = editor.requestClose(); blocked("确认关闭编辑");
    editor.answerConfirmation(state().confirmation!.id, false); await closing;

    for (const mode of ["brush", "rect", "freehand", "lasso"] as const) {
      editor.setEraseMode(mode); editor.setMaskOperation("add");
      const before = documentState(), view = viewport(), properties = state().propertiesRequest;
      check(key("x") && state().maskOperation === "subtract" && !key("x", { repeat: true }) && state().maskOperation === "subtract", `${mode}：X 切到减去，长按不反复切换`);
      check(key("x") && state().maskOperation === "add" && documentState() === before && viewport() === view && state().propertiesRequest === properties && state().eraseMode === mode,
        `${mode}：再次 X 返回添加，方式、选区、视野与历史保持`);
    }
    const editingView = viewport(), beforeCompare = documentState();
    const releaseTarget = document.createElement("dialog"); document.body.append(releaseTarget);
    releaseTarget.addEventListener("keyup", event => event.stopPropagation());
    try {
      key("c", { code: "KeyC" });
      key("x", {}, target, "keyup"); key("c", { code: "KeyC", repeat: true });
      check(state().compareOriginal && viewport() === editingView, "C 长按重复与无关松键不覆盖查看起点或提前结束");
      releaseTarget.showModal();
      check(!state().compareOriginal, "C 查看期间焦点进入弹窗立即恢复编辑");
      releaseTarget.close(); key("c", { code: "KeyC" });
      check(!key("C", { code: "KeyC", shiftKey: true }, releaseTarget, "keyup") && !state().compareOriginal, "C 在编辑器外被拦截冒泡、修饰键改变时仍正常松键，不抢占目标按键");
      key("c"); window.dispatchEvent(new Event("blur"));
      check(!state().compareOriginal && !key("c", { repeat: true }), "窗口失焦恢复编辑，残留 C 重复事件不重启对比");
      key("c");
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      try { document.dispatchEvent(new Event("visibilitychange")); }
      finally { delete (document as unknown as { hidden?: boolean }).hidden; }
      check(!state().compareOriginal && viewport() === editingView && documentState() === beforeCompare, "页面隐藏结束 C 对比，恢复完整视野且不改历史");
      const input = document.createElement("input"); container.append(input);
      key("c"); input.focus();
      check(!state().compareOriginal, "C 查看期间转到数字或文字输入区域恢复编辑"); input.remove();
      key("c"); releaseTarget.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      check(!state().compareOriginal, "C 查看期间点击编辑器外恢复编辑");
      editor.setCompare(true); key("c"); key("c", {}, target, "keyup");
      check(state().compareOriginal, "按钮已持有对比时 C 不接管，松 C 不结束按钮查看"); editor.setCompare(false);
    } finally { releaseTarget.close(); releaseTarget.remove(); }
    editor.selectLayer(text.editorId!);
    check(key("c", { ctrlKey: true }) && !state().compareOriginal && !!state().canPasteLayer, "Ctrl+C 仍复制所选图层，不进入原图对比");
    check(key("c", { metaKey: true }) && !state().compareOriginal, "Command+C 仍保留图层复制");
    editor.setTool("erase");

    // The host may itself be a dialog; only another modal blocks editor shortcuts.
    const hostDialog = document.createElement("dialog"); document.body.append(hostDialog); hostDialog.append(container); hostDialog.showModal();
    try {
      editor.zoomTo(2);
      check(key("f") && viewport() === fitted, "宿主弹窗承载编辑器时 F 可以适配");
      check(key("1") && state().zoom === 1 && key("c") && state().compareOriginal, "宿主弹窗内 1／C 仍只作用于当前编辑器");
      key("c", {}, target, "keyup"); key("f");
      const before = documentState(), beforeSnapshot = JSON.stringify(probe.snapshot()), history = probe.history.index;
      check(key("Enter", { ctrlKey: true }) && state().task, "宿主弹窗内 Ctrl+Enter 发起消除");
      blocked("请求准备中"); await settle(() => requests === 1); blocked("等待服务返回");
      respond!(); await settle(() => !!state().pending && !state().task);
      blocked("结果待采用");
      check(requests === 1 && documentState() === before, "快捷键只请求一次，预览前后不自动采用或改写草稿");
      editor.discardResult();
      key("h"); drag(100, 100, 130, 130); editor.zoomTo(2); key("f"); key("e");
      check(key("Enter", { metaKey: true }) && state().task, "放弃后 H 查看、F 适配、E 返回，可用 Command+Enter 再次消除");
      await settle(() => requests === 2); respond!(); await settle(() => !!state().pending && !state().task);
      await editor.acceptResult();
      check(!state().pending && state().canUndo, "明确采用后才更新底图，并允许撤销");
      await editor.undo();
      check(JSON.stringify(probe.snapshot()) === beforeSnapshot && probe.history.index === history, "撤销采用恢复消除前的底图、选区、调色和独立图层");
    } finally { hostDialog.close(); document.body.append(container); hostDialog.remove(); }
    const upload = new File([await picture("#008844", 800, 500)], "uploaded.jpg", { type: "image/jpeg" });
    await fixture.confirm(() => editor.uploadReplacement(upload));
    editor.zoomTo(2); const uploaded = documentState(), uploadedView = viewport();
    check(key("c") && state().compareOriginal, "上传换图后 C 仍进入初始原图对比");
    await frame(); await frame();
    const originalPixel = fixture.overlay.getContext("2d")!.getImageData(400, 300, 1, 1).data;
    check(Math.abs(originalPixel[0] - 18) < 5 && Math.abs(originalPixel[1] - 52) < 5 && Math.abs(originalPixel[2] - 86) < 5, "上传后 C 实际显示初始底图像素，不显示上传图或最近消除结果");
    key("c", {}, target, "keyup");
    check(documentState() === uploaded && viewport() === uploadedView && probe.snapshot().source === "upload", "松 C 返回上传后的草稿及视野，不还原或替换底图");
  } finally { respond?.(); fixture.dispose(); window.fetch = originalFetch; editorConfig.eraseApiUrl = originalUrl; }
}
