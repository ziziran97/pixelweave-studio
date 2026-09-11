import { StaticCanvas } from "fabric";
import { prepareUploadedImage } from "../src/editor/assets";
import { editorConfig } from "../src/config";
import { readEraseTelemetry, clearEraseTelemetry } from "../src/telemetry";
import { createEditor, picture } from "./editing-tools";

export async function checkImageFileLimits(check: (ok: boolean, message: string) => void) {
  const limit = 25 * 1024 * 1024;
  const jpeg = await picture("#204060", 128, 96), png = await picture("#406020", 128, 96, "image/png");
  const padded = (blob: Blob, size: number) => new File([blob, new Uint8Array(size - blob.size)], "size-check", { type: blob.type });
  const oversized = padded(jpeg, limit + 1);
  for (const [label, blob] of [["JPG", jpeg], ["PNG", png]] as const) {
    const file = padded(blob, limit + 1);
    file.slice = () => { throw new Error("不应读取超限文件"); };
    let message = "";
    try { await prepareUploadedImage(file); } catch (error) { message = (error as Error).message; }
    check(message === "图片不能超过 25MB，请压缩后重新上传", `${label} 超过 25MB 一字节时，在读取与解码前拒绝`);
    const accepted = await prepareUploadedImage(padded(blob, limit));
    check(accepted.width === 128 && accepted.height === 96 && (label === "PNG" ? accepted.converted : accepted.jpeg.size === limit), `${label} 恰好 25MB 可正常载入，保留原有转换规则`);
  }

  const fixture = createEditor(), { editor, state } = fixture;
  const originalFetch = window.fetch, originalUrl = editorConfig.eraseApiUrl;
  const originalCanvasBlob = HTMLCanvasElement.prototype.toBlob, originalExport = StaticCanvas.prototype.toBlob;
  let requests = 0;
  try {
    await editor.openImage(jpeg, "大小校验检查", false);
    editor.setTool("rect"); fixture.drag(30, 30, 65, 55);
    editor.setTool("select"); editor.selectLayer(editor.canvas.getObjects().at(-1)!.editorId!);
    editor.zoomTo(.75);
    const internal = editor as unknown as { snapshot(): unknown; history: { index: number } };
    const snapshot = JSON.stringify(internal.snapshot()), selectedId = state().selectedId, history = internal.history.index;
    const viewport = JSON.stringify(editor.canvas.viewportTransform);
    let done = false;
    const upload = editor.uploadReplacement(oversized).then(() => { done = true; });
    const confirmation = state().confirmation, hadConfirmation = !!confirmation;
    if (confirmation) editor.answerConfirmation(confirmation.id, false);
    await upload;
    check(done && !hadConfirmation && state().notice.includes("图片不能超过 25MB"), "超限上传先提示大小，不弹出放弃已有编辑的确认框");
    check(JSON.stringify(internal.snapshot()) === snapshot && state().selectedId === selectedId && internal.history.index === history && JSON.stringify(editor.canvas.viewportTransform) === viewport && !state().busy,
      "超限上传保留底图、图层、选择、历史和视野，并恢复可编辑状态");

    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type === "image/jpeg") callback(oversized);
      else originalCanvasBlob.call(this, callback, type, quality);
    };
    await fixture.confirm(() => editor.uploadReplacement(new File([png], "valid.png", { type: "image/png" })));
    check(state().notice.includes("PNG 转换后的图片超过 25MB") && JSON.stringify(internal.snapshot()) === snapshot && !state().busy,
      "原 PNG 合规但转换结果超过 25MB 时，显示具体原因并保留旧草稿");
    HTMLCanvasElement.prototype.toBlob = originalCanvasBlob;

    editorConfig.eraseApiUrl = "/__file_limit_erase__";
    window.fetch = async (input, init) => {
      if (String(input) !== editorConfig.eraseApiUrl) return originalFetch(input, init);
      requests++; return new Response(jpeg);
    };
    editor.setEraseMode("rect"); fixture.drag(5, 5, 20, 20);
    const eraseSnapshot = JSON.stringify(internal.snapshot());
    clearEraseTelemetry();
    StaticCanvas.prototype.toBlob = async () => oversized;
    await editor.executeErase();
    check(requests === 0 && !state().pending && !state().task && state().hasMask && state().notice.includes("当前消除图片超过 25MB") && JSON.stringify(internal.snapshot()) === eraseSnapshot,
      "实际生成的消除图片超限时不请求服务，保留图片、独立图层与选区");
    const events = readEraseTelemetry();
    check(events.some(event => event.name === "erase_preparation_failed") && !events.some(event => event.name === "erase_request_started"),
      "生成文件超限归为准备失败，不计为已发送消除请求");
    StaticCanvas.prototype.toBlob = originalExport;
    await editor.executeErase();
    check(Number(requests) === 1 && !!state().pending && !state().task, "超限失败解除后可使用保留选区重新消除，正常结果仍先预览");
  } finally {
    HTMLCanvasElement.prototype.toBlob = originalCanvasBlob; StaticCanvas.prototype.toBlob = originalExport;
    window.fetch = originalFetch; editorConfig.eraseApiUrl = originalUrl; fixture.dispose();
  }
}
