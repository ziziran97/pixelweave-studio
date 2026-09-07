import { FabricObject, Rect, Textbox } from "fabric";
import { createTextValidator } from "../src/integration";
import { createEditor, picture } from "./editing-tools";
import { ContentTextbox } from "../src/editor/ContentTextbox";
import { applyTextProperties, DEFAULT_TEXT } from "../src/editor/text";
import { Assets } from "../src/editor/assets";
import { renderDocument } from "../src/editor/render";
import { SERIALIZED_PROPS } from "../src/editor/model";
import { DEFAULT_ADJUSTMENTS, type TextProperties } from "../src/types";

export async function checkTextOpacity(check: (value: boolean, message: string) => void) {
  let validations = 0;
  const { editor, state, click, confirm, dispose } = createEditor({
    initialImage: await picture(), context: { taskId: "opacity", imageId: "image" },
    validateTexts: createTextValidator(async text => { validations++; return text.includes("送料無料") ? ["送料無料"] : []; }),
    replace: async () => ({ status: "failed", message: "测试" }), confirmResult: async () => ({ status: "pending" }), onClose: () => {},
  });
  const active = () => editor.canvas.getActiveObject() as Textbox;
  try {
    await editor.initialize(); editor.setTool("text");
    check(state().text?.opacity === 100, "文字不透明度默认100%");
    editor.updateTextOpacity(40);
    check(state().text?.opacity === 40 && !state().dirty && !state().canUndo, "新文字不透明度预设不记历史");
    const below = "opacity-underlay";
    editor.canvas.add(new Rect({ left: 80, top: 80, width: 400, height: 220, fill: "#00ff00", editorId: below, editorPurpose: "content", editorRole: "shape" }));
    editor.setTool("text"); await editor.addText({ x: 150, y: 150 }); const id = active().editorId!;
    check(active().opacity === .4, "新增文字采用当前不透明度预设");
    editor.updateTextOpacity(100); editor.updateTextOpacity(80, false); editor.updateTextOpacity(60, false); editor.updateTextOpacity(35, false);
    check(active().opacity === .35 && !state().busy, "不透明度连续预览不触发字体加载或禁用面板");
    editor.finishPropertyEdit(); await editor.undo(); check(active().opacity === 1, "不透明度连续拖动一次撤销恢复全部调整");
    await editor.undo(true); check(active().opacity === .35, "不透明度重做恢复最终预览值");
    const colors = editor.beginColorEdit("fill")!; colors.preview("#ff0000"); colors.finish(false);
    check(active().opacity === .35, "共享颜色预览和取消保留文字不透明度");
    await editor.updateText({ ...state().text!, underline: true, background: true, strokeEnabled: true, shadowEnabled: true, shadowOffsetX: 4 });
    check(active().opacity === .35, "修改装饰背景和效果不重置不透明度");
    await editor.duplicateSelected(); const copy = active().editorId!;
    check(active().opacity === .35 && active().underline && active().editorTextBackground === true, "复制保留不透明度及其他文字属性");
    editor.updateTextOpacity(0);
    check(state().selectedId === copy && state().layers.find(layer => layer.id === copy)?.transparent === true, "0%文字保留选择与图层并标记完全透明");
    editor.deleteSelected(); editor.selectLayer(id); editor.updateTextOpacity(0);
    click(200, 170); check(state().selectedId === below, "完全透明的文字及背景不拦截下方图形点击");
    editor.selectLayer(id); editor.updateTextOpacity(100);
    check(active().opacity === 1 && !state().layers.find(layer => layer.id === id)?.transparent, "从图层选中可恢复文字显示并清除透明标记");
    await editor.undo(); check(active().opacity === 0, "撤销恢复透明文字且仍保留可编辑对象");
    active().text = "送料無料"; active().initDimensions(); editor.canvas.fire("object:modified", { target: active() });
    await confirm(() => editor.submitReplacement());
    check(validations === 1 && state().notice === "1 个文字图层的文案需修改。" && !!state().textError?.includes("送料無料") && state().problemObjectId === id, "完全透明的日文仍参加后端违禁词检测，命中后定位而非按语言拦截");
  } finally { dispose(); }

  const assets = new Assets();
  const pixels = async (text: Textbox) => {
    const blob = await renderDocument({ size: { width: 300, height: 180 }, objects: [(text as FabricObject).toObject(SERIALIZED_PROPS)], masks: [], adjustments: { ...DEFAULT_ADJUSTMENTS } }, assets, "final", "png");
    const image = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 180;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 300, 180); ctx.drawImage(image, 0, 0); image.close(); return ctx.getImageData(0, 0, 300, 180).data;
  };
  try {
    for (const [label, patch] of [
      ["文字和装饰", { fill: "#000000", underline: true, linethrough: true }],
      ["背景", { fill: "#ffffff", background: true, backgroundColor: "#000000", backgroundPadding: 16 }],
      ["描边", { fill: "#ffffff", strokeEnabled: true, stroke: "#000000", strokeWidth: 4 }],
      ["组合效果", { fill: "#000000", background: true, backgroundColor: "#9fa8b1", backgroundPadding: 16, strokeEnabled: true, stroke: "#ff0000", strokeWidth: 4, shadowEnabled: true, shadowColor: "#000000", shadowBlur: 8, shadowOffsetX: 14, shadowOffsetY: 14 }],
      ["阴影", { fill: "#ffffff", shadowEnabled: true, shadowColor: "#000000", shadowOffsetX: 14, shadowOffsetY: 14, shadowBlur: 0 }],
    ] as [string, Partial<TextProperties>][]) {
      const text = new ContentTextbox("MMMM", { left: 60, top: 60, width: 180, editorPurpose: "content" });
      applyTextProperties(text, { ...DEFAULT_TEXT, fontSize: 36, ...patch });
      const full = await pixels(text); text.set("opacity", .5); const half = await pixels(text);
      let dark = 0, faded = 0;
      for (let i = 0; i < full.length; i += 4) if (full[i] < 200) { dark++; if (half[i] > full[i] + 10 && half[i] < 255) faded++; }
      check(dark > 10 && faded / dark > .95, `${label}在最终成图中随不透明度一起变淡`);
      check(full.every((value, index) => Math.abs(half[index] - (index % 4 === 3 ? 255 : (value + 255) / 2)) <= 2), `${label}在50%时整体合成一次，重叠处不改变原样式`);
      const clone = await text.clone(SERIALIZED_PROPS), copied = await pixels(clone);
      check(half.every((v, i) => v === copied[i]), `${label}半透明成图经序列化复制后像素一致`);
      text.set("opacity", 0); const transparent = await pixels(text);
      check(transparent.every(value => value === 255), `0%时${label}均不进入最终成图`);
    }
    for (const [angle, scale, left, top] of [[0, 1.4, -30, 80], [37, .8, 60, 60], [90, 1, 220, 20], [270, 1, 80, 150]]) {
      const text = new ContentTextbox("Áfy\nWords", { left, top, width: 120, angle, scaleX: scale, scaleY: scale, editorPurpose: "content" });
      applyTextProperties(text, { ...DEFAULT_TEXT, fontSize: 32, fontStyle: "italic", fill: "#000000", background: true, backgroundColor: "#a4b5c6", backgroundPadding: 45, underline: true, strokeEnabled: true, stroke: "#e34432", shadowEnabled: true, shadowBlur: 8, shadowOffsetX: -12, shadowOffsetY: 14 });
      const full = await pixels(text); text.set("opacity", .5); const half = await pixels(text);
      check(full.every((value, index) => Math.abs(half[index] - (index % 4 === 3 ? 255 : (value + 255) / 2)) <= 2), `${angle}度旋转及${scale}倍缩放下，整体透明度保持样式且背景阴影不被额外裁切`);
    }
  } finally { assets.dispose(); }
}
