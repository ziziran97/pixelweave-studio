import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { fetchImageBlob } from "../src/lib/imageLoading";
import { EditorController } from "../src/editor/EditorController";
import type { EditorIntegration } from "../src/integration";
import { editorConfig } from "../src/config";
import { checkLargeImages } from "./large-images";
import { checkImageFileLimits } from "./image-file-limits";
import { frame, picture, settle } from "./editing-tools";
import "../src/styles.css";

const reports: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
  reports.push(`PASS ${message}`); document.getElementById("results")!.textContent = reports.join("\n") + "\n运行中…";
};
document.getElementById("results")!.style.cssText = "position:fixed;bottom:0;left:0;max-height:120px;overflow:auto;background:white;z-index:100";
const host = document.getElementById("test-root")!, root = createRoot(host);
const originalFetch = window.fetch, originalInitialize = EditorController.prototype.initialize;
const originalLocation = location.href, originalDefaultImage = editorConfig.defaultImageUrl;
const paint = async () => { await frame(); await frame(); };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const integration = (initialImage: string | Blob): EditorIntegration => ({ initialImage, context: { taskId: "load-check", imageId: "test" },
  validateTexts: async () => ({ passed: true }), replace: async () => ({ status: "pending" }), confirmResult: async () => ({ status: "pending" }), onClose: () => {} });
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === label);
const checkUnavailableZoom = (label: string) => {
  const controls = ["缩小", "放大", "100% 查看", "适配画布"].map(name => button(name));
  check(controls.every(control => control?.disabled) && host.querySelector('[aria-label="当前缩放比例"]')?.textContent === "—",
    `${label}时缩放按钮禁用且不显示占位比例`);
  const before = JSON.stringify(engine.canvas.viewportTransform);
  controls.forEach(control => control?.click());
  check(JSON.stringify(engine.canvas.viewportTransform) === before, `${label}时点击缩放按钮不改变空画布视野`);
};
let engine!: EditorController;
const held = deferred<Response>();
let requests = 0;
try {
  const normal = await picture("#408080", 1464, 600);
  EditorController.prototype.initialize = function () { engine = this; return originalInitialize.call(this); };
  let fallbackRequests = 0, saved = 0;
  const missingImageHost = integration("");
  missingImageHost.replace = async () => { saved++; return { status: "pending" }; };
  window.history.replaceState(null, "", "?image=/__unexpected_query_image__");
  editorConfig.defaultImageUrl = "/__unexpected_default_image__";
  window.fetch = async (input, init) => {
    if (String(input).startsWith("/__unexpected_")) { fallbackRequests++; return new Response(normal); }
    return originalFetch(input, init);
  };
  for (const [label, image] of [["缺失", undefined], ["null", null], ["空字符串", ""], ["空白字符串", " \t\n "], ["空文件", new Blob()]] as const) {
    const previous = engine;
    const source = { ...missingImageHost, initialImage: image as unknown as string | Blob };
    root.render(createElement(App, { integration: source, preview: true }));
    await settle(() => engine !== previous); await paint();
    check(!!button("重新加载图片") && host.textContent!.includes("未获取到待编辑图片"), `宿主初始图片${label}时明确提示缺图并保留重试入口`);
    check(!host.querySelector(".document-size") && !host.querySelector(".layer-thumb img") &&
      !!button("文字")?.disabled && !!button("替换图片")?.disabled && !!button("上传本地图片")?.disabled,
      `宿主初始图片${label}时不以占位图进入编辑或替换`);
    checkUnavailableZoom(`宿主初始图片${label}`);
    await engine.submitReplacement();
    check(fallbackRequests === 0 && saved === 0, "宿主缺图不回退页面参数或环境默认图，也不调用保存");
    button("重新加载图片")!.click(); await paint();
    check(host.textContent!.includes("未获取到待编辑图片") && !!button("替换图片")?.disabled, "缺图期间重复重试仍保持阻止编辑的状态");
    source.initialImage = normal;
    button("重新加载图片")!.click(); await settle(() => !button("消除笔")?.disabled); await paint();
    check(host.querySelector(".document-size")?.textContent === "1464 × 600 px" && !!button("撤销")?.disabled && fallbackRequests === 0,
      "宿主补充有效图片后重试打开真实图片，不新增历史或借用其他图片来源");
    button("100% 查看")!.click(); await paint();
    check(!button("100% 查看")?.disabled && !button("适配画布")?.disabled && host.querySelector('[aria-label="当前缩放比例"]')?.textContent === "100%",
      "补图成功后恢复缩放按钮和真实比例，100% 查看正常生效");
  }
  window.history.replaceState(null, "", originalLocation); editorConfig.defaultImageUrl = originalDefaultImage;
  window.fetch = async (input, init) => {
    if (String(input) === "/__initial_load__") {
      requests++;
      return requests === 1 ? held.promise : new Response(normal);
    }
    return originalFetch(input, init);
  };
  root.render(createElement(App, { integration: integration("/__initial_load__") }));
  await settle(() => requests === 1); await paint();
  check(!host.querySelector(".document-size") && !!button("消除笔")?.disabled && host.textContent!.includes("正在载入图片"), "初始图片下载期间不显示预设尺寸，编辑入口保持禁用");
  checkUnavailableZoom("初始图片下载期间");
  await engine.initialize();
  check(requests === 1, "加载期间重复初始化不重复下载");
  held.resolve(new Response(null, { status: 503 }));
  await settle(() => !!button("重新加载图片"));
  check(!host.querySelector(".document-size") && host.textContent!.includes("图片加载失败"), "初始加载失败显示原因和重试入口，不显示假尺寸");
  checkUnavailableZoom("初始图片加载失败");
  button("重新加载图片")!.click();
  await settle(() => !button("消除笔")?.disabled); await paint();
  check(requests === 2 && host.querySelector(".document-size")?.textContent === "1464 × 600 px" && !button("重新加载图片"), "用户重试成功后显示真实尺寸，移除错误入口");
  check(button("消除笔")?.getAttribute("aria-pressed") === "true" && !!button("撤销")?.disabled, "重试成功仍进入消除笔，不产生编辑历史");
  const upload = button("上传本地图片")!;
  check(document.getElementById(upload.getAttribute("aria-describedby")!)?.textContent?.includes("不超过 25MB") === true, "上传入口提示文件大小与图片尺寸限制");
  const files = new DataTransfer(); files.items.add(new File([new Uint8Array(25 * 1024 * 1024 + 1)], "oversized.png", { type: "image/png" }));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!; input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true })); await paint();
  check(host.textContent!.includes("图片不能超过 25MB，请压缩后重新上传") && host.querySelector(".document-size")?.textContent === "1464 × 600 px" && !upload.disabled,
    "实际上传入口超限显示清晰提示，保留原图尺寸且允许重新上传");

  const oldResponse = deferred<Response>();
  let oldSignal: AbortSignal | null | undefined, oldStarted = false;
  window.fetch = async (input, init) => {
    if (String(input) === "/__obsolete_initial__") { oldStarted = true; oldSignal = init?.signal; return oldResponse.promise; }
    return originalFetch(input, init);
  };
  root.render(createElement(App, { integration: integration("/__obsolete_initial__") }));
  await settle(() => oldStarted);
  root.render(createElement(App, { integration: integration(normal) }));
  await settle(() => !button("消除笔")?.disabled && host.querySelector(".document-size")?.textContent === "1464 × 600 px");
  check(!!oldSignal?.aborted, "切换宿主图片时中止上一轮初始下载");
  oldResponse.resolve(new Response(await picture("#ff0000", 1280, 800))); await paint();
  check(host.querySelector(".document-size")?.textContent === "1464 × 600 px", "忽略取消的迟到响应也不能覆盖新文档尺寸");

  root.render(createElement(App, { integration: integration(await picture("#123456", 5001, 32)) }));
  await settle(() => !!button("重新加载图片"));
  check(!host.querySelector(".document-size") && host.textContent!.includes("宽、高均不能超过 5000 px"), "宿主超限图片拒绝进入编辑并显示 5000 px 限制");
  root.render(null); await paint();

  let timedOutSignal: AbortSignal | null | undefined, bodyStarted = false;
  window.fetch = async (_, init) => {
    timedOutSignal = init?.signal;
    return new Response(new ReadableStream({ start() { bodyStarted = true; } }));
  };
  let timeout = "";
  try { await fetchImageBlob("/__stalled_body__", { timeoutMs: 30 }); } catch (error) { timeout = (error as Error).message; }
  check(bodyStarted && timeout.includes("加载超时") && !!timedOutSignal?.aborted, "超时覆盖已经响应但图片内容未下载完的请求");
  const ignored = deferred<Response>(), abort = new AbortController();
  window.fetch = async () => ignored.promise;
  const cancel = fetchImageBlob("/__ignores_abort__", { signal: abort.signal });
  abort.abort(); let cancelled = false;
  try { await cancel; } catch (error) { cancelled = error instanceof DOMException && error.name === "AbortError"; }
  ignored.resolve(new Response(normal));
  check(cancelled, "请求忽略取消时，前端仍及时结束等待并隔离迟到图片");
  let failures = 0;
  window.fetch = async () => { failures++; return new Response(null, { status: 404 }); };
  try { await fetchImageBlob("/__missing_image__"); } catch { /* Expected. */ }
  await paint(); check(failures === 1, "图片下载失败不自动重复请求");
  window.fetch = originalFetch;
  await checkImageFileLimits(check);
  await checkLargeImages(check);
  reports.push("全部检查通过");
} catch (error) { reports.push(`FAIL ${(error as Error).message}\n${(error as Error).stack ?? ""}`); }
finally {
  held.resolve(new Response(null, { status: 499 })); root.unmount();
  window.history.replaceState(null, "", originalLocation); editorConfig.defaultImageUrl = originalDefaultImage;
  window.fetch = originalFetch; EditorController.prototype.initialize = originalInitialize;
  document.getElementById("results")!.textContent = reports.join("\n");
}
