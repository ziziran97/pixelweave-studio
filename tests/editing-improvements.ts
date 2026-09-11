import { StaticCanvas, Textbox } from "fabric";
import { createEditor, frame, picture, pixelAt, settle } from "./editing-tools";
import type { ReplacementInput } from "../src/integration";
import { Assets } from "../src/editor/assets";
import type { DocumentSnapshot } from "../src/types";
import { renderDocument } from "../src/editor/render";

export async function checkEditingImprovements(check: (value: boolean, message: string) => void) {
  let saves = 0, checks = 0, submitted: ReplacementInput | undefined;
  const test = createEditor({ initialImage: await picture("#123456"), context: { taskId: "preview", imageId: "image" },
    validateTexts: async () => { checks++; return { passed: true }; },
    replace: async input => { saves++; submitted = input; return { status: "failed", message: "测试回执" }; },
    confirmResult: async () => ({ status: "pending" }), onClose: () => {} });
  const { editor, state, drag, dispose } = test;
  const toBlob = StaticCanvas.prototype.toBlob;
  try {
    await editor.initialize(); editor.setTool("rect"); editor.setColor("#00ff00"); drag(20, 20, 80, 80);
    const visible = state().layers.find(layer => layer.purpose === "content")!.id;
    editor.updateLayer(visible, { locked: true }); editor.setColor("#ff0000"); drag(100, 20, 160, 80);
    editor.updateLayer(state().layers.find(layer => layer.purpose === "content" && layer.id !== visible)!.id, { visible: false });
    editor.setTool("erase"); test.click(130, 50);
    let release!: () => void, reached = false, renders = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    StaticCanvas.prototype.toBlob = async function(options) { renders++; const blob = await toBlob.call(this, options); reached = true; if (renders === 1) await gate; return blob; };
    const cancelled = editor.submitReplacement(), oldId = state().confirmation!.id;
    await settle(() => reached);
    editor.answerConfirmation(oldId, true); await frame();
    check(state().confirmation?.id === oldId && saves === 0 && checks === 0, "成图准备期间不接受确认，不检测或保存");
    editor.answerConfirmation(oldId, false); await cancelled;
    const next = editor.submitReplacement();
    await settle(() => state().confirmation?.preview?.status === "ready");
    const current = state().confirmation!, url = current.preview!.url!;
    release(); await frame(); await frame();
    check(state().confirmation?.id === current.id && state().confirmation?.preview?.url === url, "取消后晚到的成图不会覆盖新一轮确认");
    const blob = await fetch(url).then(response => response.blob());
    const visiblePixel = await pixelAt(blob, 50, 50), hiddenPixel = await pixelAt(blob, 130, 50);
    check(visiblePixel[1] > 245 && visiblePixel[0] < 10 && hiddenPixel[0] < 30 && hiddenPixel[2] > 70,
      "消除工作区的成图预览包含可见锁定图层，排除隐藏图层及选区辅助");
    editor.answerConfirmation(current.id, true); await next;
    check(saves === 1 && renders === 2 && !!submitted && new Uint8Array(await submitted.image.arrayBuffer()).join() === new Uint8Array(await blob.arrayBuffer()).join(),
      "确认后实际提交与看到的 JPG 字节一致，不再次合成");
    const before = JSON.stringify(editor.canvas.toJSON());
    StaticCanvas.prototype.toBlob = async () => { throw new Error("模拟导出失败"); };
    const retry = editor.submitReplacement();
    await settle(() => state().confirmation?.preview?.status === "error");
    const id = state().confirmation!.id;
    editor.answerConfirmation(id, true); await frame();
    check(state().confirmation?.id === id && saves === 1 && JSON.stringify(editor.canvas.toJSON()) === before, "生成失败保留草稿并阻止提交");
    StaticCanvas.prototype.toBlob = toBlob;
    await editor.retryReplacementPreview(id);
    check(state().confirmation?.preview?.status === "ready", "成图失败可在原确认中重新生成");
    editor.answerConfirmation(id, false); await retry;
  } finally { StaticCanvas.prototype.toBlob = toBlob; dispose(); }

  await checkCancelledPreviewImageLoad(check);

  const textTest = createEditor();
  try {
    const { editor, state, confirm } = textTest;
    const active = () => editor.canvas.getActiveObject() as Textbox;
    await editor.openImage(await picture("#ffffff", 2400, 1600), "大图", false); editor.setTool("text");
    check(state().text?.fontSize === 80, "大图的新文字样式按图片短边设置字号");
    await editor.addText({ x: 80, y: 80 }); const first = active(), width = first.width;
    editor.setTool("select"); editor.zoomTo(2); editor.canvas.discardActiveObject(); await editor.addText();
    check(active().fontSize === 80 && width > 900 && first.fontSize === 80 && first.width === width, "大图初始框宽随图片适配，缩放不改字号及已有文字框宽");
    const transform = editor.canvas.viewportTransform, entry = active().getBoundingRect();
    check(entry.left * transform[0] + transform[4] >= -1 && entry.left * transform[0] + transform[4] < editor.canvas.width && entry.top * transform[3] + transform[5] >= -1,
      "放大后新增框宽沿用可见范围约束，输入位置仍可见");
    editor.setTool("select");
    const small = new File([await picture("#ffffff", 400, 300)], "small.jpg");
    await confirm(() => editor.uploadReplacement(small));
    editor.setTool("text"); await editor.addText({ x: 10, y: 10 });
    check(active().fontSize === 15 && active().width < width, "上传小图后仅系统默认字号及框宽按新图适配");
    await editor.updateText({ ...state().text!, fontSize: 57 }, true); editor.setTool("select");
    const large = new File([await picture("#ffffff", 1800, 1200)], "large.jpg");
    await confirm(() => editor.uploadReplacement(large));
    editor.setTool("text"); await editor.addText({ x: 20, y: 20 });
    check(active().fontSize === 57, "手动字号在上传与新增后继续保留");
    await editor.undo(); await editor.undo(true);
    const restored = editor.canvas.getObjects().find(object => object instanceof Textbox)!; editor.selectLayer(restored.editorId!);
    await editor.addText({ x: 80, y: 80 });
    check(active().fontSize === 57, "历史恢复后的已有文字样式仍可继承");
  } finally { textTest.dispose(); }
}

async function checkCancelledPreviewImageLoad(check: (value: boolean, message: string) => void) {
  for (const mode of ["切图", "上传"] as const) for (const phase of ["入库", "解码"] as const) {
    const initialImage = await picture(), nextImage = await picture("#ffffff", 160, 120);
    const test = createEditor({ initialImage, context: { taskId: "preview-image-load", imageId: "image" },
      validateTexts: async () => ({ passed: true }), replace: async () => ({ status: "failed", message: "不保存" }),
      confirmResult: async () => ({ status: "pending" }), onClose: () => {} });
    const { editor, state, confirm } = test;
    const probe = editor as unknown as { processingAssets: Map<string, Set<string>>; assets: Assets; snapshot: () => DocumentSnapshot };
    const toBlob = StaticCanvas.prototype.toBlob, loadFromJSON = StaticCanvas.prototype.loadFromJSON, addAsset = Assets.prototype.add;
    let releasePreview!: () => void, releaseLoad!: () => void, previewWaiting = false, imageWaiting = false;
    const previewGate = new Promise<void>(resolve => { releasePreview = resolve; });
    const imageGate = new Promise<void>(resolve => { releaseLoad = resolve; });
    const operations: Promise<unknown>[] = [];
    let imageAssetId = "";
    try {
      await editor.initialize(); editor.setTool("rect"); test.drag(20, 20, 80, 80);
      StaticCanvas.prototype.toBlob = async function(options) {
        const blob = await toBlob.call(this, options); previewWaiting = true; await previewGate; return blob;
      };
      const submission = editor.submitReplacement(); operations.push(submission);
      await settle(() => previewWaiting);
      const oldPins = [...probe.processingAssets.keys()];
      editor.answerConfirmation(state().confirmation!.id, false); await submission;
      StaticCanvas.prototype.toBlob = toBlob;
      // Finish the old preview while the new asset is entering the store or decoding.
      Assets.prototype.add = async function(...args) {
        const asset = await addAsset.apply(this, args);
        if (phase === "入库" && this === probe.assets && asset.width === 160 && asset.height === 120) {
          imageAssetId = asset.id; imageWaiting = true; await imageGate;
        }
        return asset;
      };
      StaticCanvas.prototype.loadFromJSON = async function(...args) {
        if (phase === "解码" && this.width === 160 && this.height === 120) {
          const data = args[0] as { objects: Array<{ editorAssetId?: string }> };
          imageAssetId = data.objects.find(object => object.editorAssetId)!.editorAssetId!;
          imageWaiting = true; await imageGate;
        }
        await loadFromJSON.apply(this, args); return this;
      };
      const loading = confirm(async () => {
        if (mode === "切图") await editor.openImage(nextImage, "新图片");
        else await editor.uploadReplacement(new File([nextImage], "new.jpg"));
      });
      operations.push(loading); await settle(() => imageWaiting);
      releasePreview(); await settle(() => oldPins.every(pin => !probe.processingAssets.has(pin)));
      check(probe.assets.cost(imageAssetId) > 0, `${mode}（${phase}）：取消的替换预览完成清理时，不回收正在载入的新图`);
      releaseLoad(); await loading;
      check(state().size.width === 160 && state().size.height === 120 && state().layers.length === 1 && !state().busy,
        `${mode}（${phase}）：旧预览晚到后，新图仍完整载入且清除旧内容`);
      const pixel = await pixelAt(await renderDocument(probe.snapshot(), probe.assets, "final"), 40, 40);
      check(pixel.slice(0, 3).every(value => value > 245) && probe.processingAssets.size === 0,
        `${mode}（${phase}）：新图可正常成图，结束后释放临时资源引用`);
    } finally {
      if (state().confirmation) editor.answerConfirmation(state().confirmation!.id, false);
      releasePreview(); releaseLoad(); await Promise.allSettled(operations);
      StaticCanvas.prototype.toBlob = toBlob; StaticCanvas.prototype.loadFromJSON = loadFromJSON; Assets.prototype.add = addAsset; test.dispose();
    }
  }
}
