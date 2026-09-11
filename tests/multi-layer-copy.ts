import { ActiveSelection, Ellipse, FabricObject, Textbox } from "fabric";
import { createEditor, settle } from "./editing-tools";
import { makeSurface } from "../src/editor/render";
import type { Assets } from "../src/editor/assets";
import type { DocumentSnapshot } from "../src/types";

export async function checkMultiLayerCopy(check: (ok: boolean, message: string) => void) {
  const test = createEditor(), { editor, state } = test;
  editor.canvas.wrapperEl.parentElement!.style.cssText = "position:fixed;left:0;top:0;width:800px;height:600px";
  const internal = editor as unknown as { history: { index: number }; snapshot(): DocumentSnapshot; assets: Assets };
  const content = () => editor.canvas.getObjects().filter(object => object.editorPurpose === "content");
  const keys = (key: string, extra: KeyboardEventInit = {}, target: EventTarget = editor.canvas.upperCanvasEl) => {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); return event;
  };
  const matrices = (objects: FabricObject[]) => objects.map(object => [...object.calcTransformMatrix()]);
  const sameMatrices = (objects: FabricObject[], expected: number[][], offset = 0) => objects.every((object, i) =>
    object.calcTransformMatrix().every((value, j) => Math.abs(value - expected[i][j] - (j > 3 ? offset : 0)) < .02));
  let disposed = false;
  try {
    await editor.initialize();
    editor.setTool("rect"); editor.updateShape({ color: "#ff3300", filled: true, opacity: 70, radius: 12 }); test.drag(120, 160, 240, 250);
    editor.setTool("circle"); editor.updateShape({ color: "#33bb00", filled: false, lineWidth: 9, opacity: 85 }); test.drag(290, 160, 400, 230);
    editor.setTool("draw"); editor.setColor("#0044ee"); editor.setDrawSize(14); test.drag(200, 310, 340, 320);
    await editor.addText({ x: 440, y: 210 });
    const text = editor.canvas.getActiveObject() as Textbox; text.exitEditing();
    text.set({ text: "Batch", fontSize: 42, width: 140, underline: true, opacity: .8 }); text.initDimensions();
    editor.canvas.fire("object:modified", { target: text });
    const originals = content(), ids = originals.map(object => object.editorId!);
    // Select in reverse order, then transform the temporary selection as a whole.
    editor.selectLayer(ids[3]); for (const id of ids.slice(0, 3).reverse()) editor.selectLayer(id, true);
    let group = editor.canvas.getActiveObject() as ActiveSelection;
    group.set({ angle: 27, scaleX: 1.2, scaleY: .85, left: group.left + 32, top: group.top + 18 }); group.setCoords();
    editor.canvas.fire("object:modified", { target: group });
    const transformed = matrices(originals), selectionHistory = internal.history.index;
    editor.selectLayer(ids[2], true); editor.selectLayer(ids[2], true);
    group = editor.canvas.getActiveObject() as ActiveSelection;
    check(sameMatrices(originals, transformed) && internal.history.index === selectionHistory && state().selectionCount === 4,
      "已经整体移动旋转和缩放后，列表移出再加入图层不改变任何对象的实际位置或变换");
    const beforeMatrices = matrices(originals), source = internal.snapshot(), beforeHistory = internal.history.index;
    const beforeView = JSON.stringify(editor.canvas.viewportTransform), workspace = state().workspace, requests = state().propertiesRequest;
    check(keys("c").defaultPrevented && !!state().canPasteLayer && internal.history.index === beforeHistory && editor.canvas.getActiveObject() === group && sameMatrices(originals, beforeMatrices),
      "多选Ctrl+C只记录快照，不改选择、位置和历史");
    await editor.pasteLayer();
    const copies = content().slice(-4), firstPasteIds = copies.map(object => object.editorId!);
    check(content().length === 8 && copies.every((object, i) => object.type === originals[i].type && !ids.includes(object.editorId!)) &&
      content().slice(0, 4).every((object, i) => object === originals[i]), "反向选择仍按原层级复制文字、画笔和图形，原图层顺序不变");
    check(sameMatrices(copies, beforeMatrices, 20) && sameMatrices(originals, beforeMatrices), "多选移动旋转和非等比缩放后，副本按图片像素整体错开20px，原图不跳动");
    check(state().selectionCount === 4 && copies.every(object => editor.canvas.getActiveObjects().includes(object)) &&
      state().workspace === workspace && state().propertiesRequest === requests && JSON.stringify(editor.canvas.viewportTransform) === beforeView,
      "新副本整批选中，保留工作区、属性栏状态和画布视野");
    check(internal.history.index === beforeHistory + 1 && !internal.snapshot().objects.some(object => object.type.toLowerCase() === "activeselection"),
      "一次整批粘贴只记一步历史，副本仍是独立图层");

    // Compare the actual final render of only the copied batch with its source shifted by 20px.
    const sourceOnly = { ...source, objects: source.objects.filter(object => ids.includes(object.editorId!)) };
    const copiedOnly = { ...internal.snapshot(), objects: internal.snapshot().objects.filter(object => firstPasteIds.includes(object.editorId!)) };
    const surfaces = await Promise.all([makeSurface(sourceOnly, internal.assets), makeSurface(copiedOnly, internal.assets)]);
    try {
      surfaces.forEach(surface => surface.renderAll());
      const a = surfaces[0].getContext().getImageData(0, 0, source.size.width, source.size.height).data;
      const b = surfaces[1].getContext().getImageData(0, 0, source.size.width, source.size.height).data;
      let different = 0, colored = 0;
      for (let y = 0; y < source.size.height - 20; y++) for (let x = 0; x < source.size.width - 20; x++) {
        const from = (y * source.size.width + x) * 4, to = ((y + 20) * source.size.width + x + 20) * 4;
        if (a[from] < 240 || a[from + 1] < 240 || a[from + 2] < 240) colored++;
        if ([0, 1, 2].some(channel => Math.abs(a[from + channel] - b[to + channel]) > 12)) different++;
      }
      check(colored > 1000 && different < colored * .01, "实际成图保留整批副本的颜色、不透明度、线条、文字及层级，偏移后像素一致");
    } finally { await Promise.all(surfaces.map(surface => surface.dispose())); }
    await editor.undo(); check(content().length === 4 && sameMatrices(content(), beforeMatrices), "一步撤销移除整批副本，原图层变换保留");
    await editor.undo(true); check(content().length === 8 && sameMatrices(content().slice(-4), beforeMatrices, 20), "一步重做恢复整批独立副本及实际位置");
    editor.selectLayer(ids[0]); editor.updateShape({ color: "#123456" }); await editor.duplicateSelected();
    await editor.pasteLayer();
    check(state().selectionCount === 4 && sameMatrices(content().slice(-4), beforeMatrices, 40) && content().at(-4)!.fill === "#ff3300",
      "修改原对象和单层Ctrl+D不覆盖整批复制记录，重复粘贴继续错开20px");
    const duplicateFrom = matrices(content().slice(-4)), duplicateHistory = internal.history.index;
    keys("d"); await settle(() => !state().busy);
    check(state().selectionCount === 4 && sameMatrices(content().slice(-4), duplicateFrom, 20) && internal.history.index === duplicateHistory + 1,
      "多选Ctrl+D直接复制当前整批选择并只记一步历史");
    const repeatCount = content().length; keys("d", { repeat: true }); keys("v", { repeat: true });
    check(content().length === repeatCount && !state().busy, "长按复制快捷键不重复生成整批图层");
    await editor.pasteLayer(); check(sameMatrices(content().slice(-4), beforeMatrices, 60), "多选Ctrl+D也不覆盖原复制记录及粘贴偏移");

    const failCount = content().length, failHistory = internal.history.index, failSelected = editor.canvas.getActiveObject();
    const loadEllipse = Ellipse.fromObject;
    Ellipse.fromObject = async () => { throw new Error("测试图层恢复失败"); };
    try { await editor.pasteLayer(); } finally { Ellipse.fromObject = loadEllipse; }
    check(content().length === failCount && internal.history.index === failHistory && editor.canvas.getActiveObject() === failSelected &&
      !state().busy && !!state().canPasteLayer && state().notice.includes("未创建副本"), "批次内一个图层加载失败时不留下部分副本，保留草稿、选择、历史及重试条件");
    await editor.pasteLayer(); check(sameMatrices(content().slice(-4), beforeMatrices, 80), "复制失败不消耗错开偏移，重试仍复制完整批次");

    editor.setTool("pan"); const blockedCount = content().length;
    keys("c"); keys("d"); keys("v");
    check(!state().canPasteLayer && content().length === blockedCount && !state().busy, "平移期间不复制或粘贴图层");
    editor.setTool("select");
    const external = document.createElement("button"); document.body.append(external);
    check(!keys("d", {}, external).defaultPrevented && content().length === blockedCount, "编辑器外Ctrl+D不创建图层或拦截宿主按键"); external.remove();
    editor.selectLayer(ids[3]); editor.editSelectedText();
    const input = (editor.canvas.getActiveObject() as Textbox).hiddenTextarea!;
    check(["c", "v", "d"].every(key => !keys(key, {}, input).defaultPrevented) && content().length === blockedCount, "文字输入保留原生文本复制粘贴，不生成图层");
    (editor.canvas.getActiveObject() as Textbox).exitEditing();

    editor.selectLayer(ids[0]); editor.updateShape({ opacity: 0 }); editor.selectLayer(ids[3], true);
    editor.updateLayer(ids[1], { visible: false }); editor.updateLayer(ids[2], { locked: true });
    for (const id of [ids[1], ids[2], editor.canvas.getObjects()[0].editorId!]) editor.selectLayer(id, true);
    const transparentCount = content().length; editor.copySelected(); await editor.pasteLayer();
    check(content().length === transparentCount + 2 && state().selectionCount === 2 && content().at(-2)!.opacity === 0 &&
      state().layers.some(layer => layer.id === content().at(-2)!.editorId && layer.transparent),
      "多选复制包含完全透明的可编辑图层，排除底图、隐藏和锁定层，副本仍可从列表恢复");
    editor.updateLayer(ids[1], { visible: true }); editor.selectLayer(ids[1]); editor.selectLayer(ids[0], true); editor.copySelected();

    // Hold one restored object until the editor has closed, then ensure late results are discarded.
    let release!: () => void, entered = false, lateObject: Ellipse | undefined, cleaned = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Ellipse.fromObject = (async (...args: Parameters<typeof loadEllipse>) => {
      lateObject = await loadEllipse.apply(Ellipse, args) as Ellipse;
      const dispose = lateObject.dispose.bind(lateObject); lateObject.dispose = () => { cleaned = true; dispose(); };
      entered = true; await gate; return lateObject;
    }) as typeof Ellipse.fromObject;
    try {
      const pending = editor.pasteLayer(); await settle(() => entered);
      test.dispose(); disposed = true; release(); await pending;
      check(cleaned, "关闭编辑后迟到的整批副本被清理，不回写旧草稿");
    } finally { release?.(); Ellipse.fromObject = loadEllipse; }
  } finally { if (!disposed) test.dispose(); }
}
