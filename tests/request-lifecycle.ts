import { EditorController } from "../src/editor/EditorController";
import { toBlob } from "../src/editor/assets";
import { editorConfig } from "../src/config";
import type { EditorView } from "../src/types";
import { pngHeader } from "./mask-png-checks";

// Fixed images and manually released responses exercise races without a backend.
// The fake transport deliberately ignores abort so late results reach the controller.
export async function checkRequestLifecycle(check: (condition: boolean, message: string) => void) {
  const host = document.createElement("div"), element = document.createElement("canvas"), overlay = document.createElement("canvas");
  host.style.cssText = "position:relative;width:800px;height:600px";
  host.append(element, overlay); document.body.append(host);
  let view: EditorView;
  const editor = new EditorController(element, overlay, host, value => { view = value; });
  const state = () => view;
  const originalFetch = window.fetch, originalUrl = editorConfig.eraseApiUrl;
  type Request = { response: Promise<Response>; respond: (response: Response) => void; reject: (error: Error) => void; notify: () => void; signal?: AbortSignal | null };
  const queue: Request[] = [], all: Request[] = [], executions: Promise<void>[] = [];
  const start = async () => {
    let respond!: Request["respond"], reject!: Request["reject"], notify!: Request["notify"];
    const response = new Promise<Response>((resolve, fail) => { respond = resolve; reject = fail; });
    const started = new Promise<void>(resolve => { notify = resolve; });
    const request: Request = { response, respond, reject, notify }; queue.push(request); all.push(request);
    const done = editor.executeErase(); executions.push(done);
    await Promise.race([started, done.then(() => { throw new Error(`测试请求未发出：${state().notice}`); })]);
    if (all.length === 1) check(state().eraseStage === "waiting" && !!state().eraseStageStartedAt && state().notice.includes("正在等待消除结果"),
      "请求实际发出后进入服务等待阶段并开始计时");
    return { request, done };
  };
  const picture = async (color: string, width = 128, height = 96) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
    return toBlob(canvas);
  };
  const select = () => {
    editor.setEraseMode("brush"); editor.setBrushSize(20);
    const canvas = editor.canvas.upperCanvasEl, bounds = canvas.getBoundingClientRect(), v = editor.canvas.viewportTransform;
    for (const type of ["mousedown", "mouseup"]) (type === "mousedown" ? canvas : document).dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === "mousedown" ? 1 : 0,
      clientX: bounds.left + 40 * v[0] + v[4], clientY: bounds.top + 40 * v[3] + v[5],
    }));
  };
  const content = () => JSON.stringify({ scene: editor.canvas.toObject(["editorAssetId", "editorId"]),
    size: state().size, masks: state().masks, hasMask: state().hasMask, mode: state().eraseMode, brushSize: state().brushSize });
  try {
    editorConfig.eraseApiUrl = "/__request_lifecycle__";
    window.fetch = async (input, init) => {
      if (input !== editorConfig.eraseApiUrl) return originalFetch(input, init);
      const request = queue.shift();
      if (!request) throw new Error("出现未预期的重复请求");
      const form = init?.body as FormData;
      const metadata = JSON.parse(String(form.get("metadata")));
      check(form.get("image") instanceof Blob && form.get("mask") instanceof Blob &&
        !form.has("prompt") && !form.has("regions") && metadata.mode === "erase" && metadata.target === "base",
        "消除请求仅提交底图、选区及消除元数据");
      check((form.get("image") as Blob).type === "image/jpeg" && (form.get("mask") as Blob).type === "image/png" &&
        !new Headers(init?.headers).has("Authorization") && metadata.documentId && Number.isInteger(metadata.revision) &&
        metadata.coordinateSystem === "0-1000" && metadata.bboxOrder === "ymin,xmin,ymax,xmax",
        "消除请求保留 JPEG、PNG 和坐标字段，不携带能力服务鉴权");
      const header = await pngHeader(form.get("mask") as Blob);
      const image = await createImageBitmap(form.get("image") as Blob);
      try {
        check(header.bitDepth === 8 && header.colorType === 0 && !header.chunks.includes("tRNS") &&
          header.width === image.width && header.height === image.height && image.width === metadata.width && image.height === metadata.height &&
          (form.get("mask") as File).name === "mask.png",
          "实际 multipart 的 mask.png 为 8-bit 单通道，尺寸与 JPEG 和 metadata 一致");
      } finally { image.close(); }
      request.signal = init?.signal; request.notify(); return request.response;
    };
    const source = await picture("#123456"), result = await picture("#008844"), replacement = await picture("#884422", 160, 120);
    await editor.openImage(source, "请求检查", false); select();
    const before = content();
    for (const scenario of ["重试等待中", "重试结果已返回", "旧请求失败"] as const) {
      const old = await start(); editor.cancelTask();
      check(!!old.request.signal?.aborted && !state().task && !state().pending && content() === before,
        `${scenario}：取消立即解除等待，图片和选区保留`);
      const retry = await start();
      const finishOld = async () => {
        old.request.respond(scenario === "旧请求失败" ? new Response(null, { status: 503 }) : new Response(source));
        await old.done;
      };
      if (scenario === "重试等待中") {
        await finishOld();
        check(state().task && !state().pending && content() === before, "旧成功结果晚返回，不解除新请求的等待状态");
      }
      retry.request.respond(new Response(result)); await retry.done;
      const pending = state().pending, notice = state().notice;
      check(!!pending && !state().task && content() === before, `${scenario}：重试结果等待采用，不直接覆盖图片`);
      if (scenario !== "重试等待中") {
        await finishOld();
        check(state().pending === pending && state().notice === notice && content() === before,
          `${scenario}：旧返回不替换新结果，也不覆盖当前提示`);
      }
      editor.discardResult();
      check(!state().pending && content() === before, `${scenario}：放弃结果后原选区可继续使用`);
    }

    const switching = await start();
    await editor.openImage(replacement, "新图片", false); select();
    const switched = content();
    check(!!switching.request.signal?.aborted && !state().task && state().size.width === 160 && state().hasMask,
      "请求期间换图会取消旧请求，新图片可正常选区");
    switching.request.respond(new Response(result)); await switching.done;
    check(!state().pending && !state().task && content() === switched, "换图后旧结果晚返回，不覆盖新图片或清除新选区");

    await editor.openImage(source, "异常结果检查", false); select();
    const unchanged = content();
    const errors = [
      ["结构化错误", Response.json({ detail: { code: "INVALID_MASK_FORMAT" } }, { status: 422 }), "选区数据无效，请重新选择"],
      ["非 JSON 错误", new Response("<html>private error</html>", { status: 500 }), "消除请求失败，请稍后重试"],
      ["网络异常", new TypeError("Failed to fetch"), "无法连接消除服务，请稍后重试"],
    ] as const;
    for (const [label, response, message] of errors) {
      const attempt = await start(), count = all.length;
      if (response instanceof Error) attempt.request.reject(response); else attempt.request.respond(response);
      await attempt.done;
      check(state().notice.includes(message) && !state().task && !state().pending && content() === unchanged && all.length === count,
        `${label}显示中文提示，保留图片和选区且不自动重试`);
    }
    const cancelled = await start(); editor.cancelTask();
    cancelled.request.reject(new DOMException("Aborted", "AbortError")); await cancelled.done;
    check(state().notice === "已取消等待，图片和选区已保留" && !state().task && !state().pending && content() === unchanged,
      "用户取消的 AbortError 不改为失败提示，图片和选区保留");
    const invalid = [
      ["尺寸不符", new Response(replacement), "消除结果尺寸与当前图片不一致"],
      ["非图片内容", new Response("invalid", { headers: { "content-type": "text/plain" } }), "消除服务返回的图片无效"],
      ["损坏图片", new Response("invalid", { headers: { "content-type": "image/png" } }), "消除结果图片无法读取"],
      ["JSON 缺少图片", new Response("{}", { headers: { "content-type": "application/json" } }), "消除服务返回的图片无效"],
    ] as const;
    for (const [label, response, message] of invalid) {
      const attempt = await start(); attempt.request.respond(response); await attempt.done;
      check(!state().task && !state().pending && state().noticePresentation === "persistent" && state().notice.includes(message) && content() === unchanged,
        `${label}被拒绝，退出等待且保留图片和选区`);
      const retry = await start(); retry.request.respond(new Response(result)); await retry.done;
      check(!!state().pending && !state().task && content() === unchanged, `${label}后可用原选区成功重试`);
      editor.discardResult();
    }
    const latePreview = await start();
    const closing = editor.requestClose(), confirmation = state().confirmation!;
    check(confirmation.kind === "close" && state().task, "消除等待中关闭先确认，未立即取消请求");
    latePreview.request.respond(new Response(result)); await latePreview.done;
    check(!!state().pending && state().confirmation?.id === confirmation.id && content() === unchanged, "确认期间消除结果返回仍保留当前确认和编辑内容");
    editor.answerConfirmation(confirmation.id, false); await closing;
    check(!!state().pending && !state().closed && !state().confirmation, "取消关闭保留晚返回的消除结果");
    editor.discardResult();
    const adoption = await start(); adoption.request.respond(new Response(result)); await adoption.done;
    const pending = state().pending!, requestCount = all.length;
    const loader = editor as unknown as { loadSnapshot: (...args: unknown[]) => Promise<void> };
    const originalLoad = loader.loadSnapshot;
    try {
      loader.loadSnapshot = async () => { throw new Error("测试图片载入失败"); };
      await editor.acceptResult();
      check(!!state().pending?.acceptError && state().pending?.assetId === pending.assetId && !state().busy && content() === unchanged,
        "采用失败保留已有结果、图片和选区，并提供弹窗错误状态");
      await editor.acceptResult();
      check(!!state().pending?.acceptError && !state().busy && all.length === requestCount, "采用再次失败仍保留结果，不重新发起消除请求");
    } finally { loader.loadSnapshot = originalLoad; }
    await editor.acceptResult();
    check(!state().pending && !state().hasMask && !state().busy && all.length === requestCount, "采用重试成功后清空选区，始终使用已有消除结果");
  } finally {
    editor.cancelTask();
    for (const request of all) request.respond(new Response(null, { status: 503 }));
    await Promise.allSettled(executions);
    window.fetch = originalFetch; editorConfig.eraseApiUrl = originalUrl;
    editor.dispose(); host.remove();
  }
}
