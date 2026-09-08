export function dataUrlToBlob(dataUrl: string) {
  const comma = dataUrl.indexOf(","), meta = dataUrl.slice(0, comma), payload = dataUrl.slice(comma + 1);
  if (comma < 0 || !meta.includes(";base64")) throw new Error("图片数据必须是 base64 Data URL");
  const mime = meta.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const bytes = atob(payload.replace(/\s/g, ""));
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) result[i] = bytes.charCodeAt(i);
  return new Blob([result], { type: mime });
}

async function resolveJsonImage(payload: unknown, apiUrl: string, signal: AbortSignal) {
  if (!payload || typeof payload !== "object") throw new Error("接口 JSON 中没有图片");
  const data = payload as Record<string, unknown>;
  const nested = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : {};
  const candidate = [data.url, data.imageUrl, data.resultUrl, data.image, data.base64,
    nested.url, nested.imageUrl, nested.resultUrl, nested.image, nested.base64]
    .find(value => typeof value === "string" && value.trim()) as string | undefined;
  if (!candidate) throw new Error("接口 JSON 中没有可识别的图片字段");
  const value = candidate.trim();
  if (value.startsWith("data:")) return dataUrlToBlob(value);
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 200) return dataUrlToBlob(`data:image/png;base64,${value}`);
  const url = new URL(value, new URL(apiUrl, location.href));
  if (!/^https?:$/.test(url.protocol)) throw new Error("接口结果图片 URL 协议不受支持");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(await responseError(response));
  return response.blob();
}

export type EraseRequest = {
  apiUrl: string; image: Blob; mask: Blob;
  width: number; height: number;
  documentId: string; revision: number; signal: AbortSignal;
};

const errorMessages = {
  size: "图片过大，请调整后重试",
  mask: "选区数据无效，请重新选择",
  busy: "服务繁忙，请稍后重试",
  unavailable: "消除服务暂不可用，请稍后重试",
  network: "无法连接消除服务，请稍后重试",
  unknown: "消除请求失败，请稍后重试",
};

// Business-backend aliases belong here; never display raw backend messages or HTML.
const errorCodes = new Map<string, string>([
  ...["FILE_TOO_LARGE", "IMAGE_TOO_LARGE", "MASK_TOO_LARGE", "IMAGE_TOO_MANY_PIXELS", "PIXEL_LIMIT_EXCEEDED", "IMAGE_DIMENSIONS_EXCEEDED", "PAYLOAD_TOO_LARGE"]
    .map(code => [code, errorMessages.size] as const),
  ...["INVALID_MASK_FORMAT", "INVALID_MASK_SIZE", "MASK_SIZE_MISMATCH", "IMAGE_MASK_SIZE_MISMATCH", "UNSUPPORTED_MASK_TYPE", "INVALID_MASK", "EMPTY_MASK", "INVALID_SELECTION"]
    .map(code => [code, errorMessages.mask] as const),
  ...["SERVICE_BUSY", "QUEUE_FULL", "QUEUE_LIMIT_EXCEEDED", "TASK_QUEUE_MAXED", "RATE_LIMIT_EXCEEDED", "LAMA_INPAINT_BUSY", "LAMA_INPAINT_QUEUE_TIMEOUT"]
    .map(code => [code, errorMessages.busy] as const),
  ...["SERVICE_NOT_READY", "MODEL_NOT_READY", "SERVICE_UNAVAILABLE", "LAMA_INPAINT_DISABLED", "LAMA_INPAINT_LOADING", "LAMA_INPAINT_INITIALIZATION_FAILED"]
    .map(code => [code, errorMessages.unavailable] as const),
  ["LAMA_CREDENTIALS_MISSING", "请先填写本地消除服务账号和密钥，再重启生产测试服务"],
  ["LAMA_CONFIG_INVALID", "消除服务本地配置无效，请检查配置后重启服务"],
  ["LAMA_CONNECTION_FAILED", errorMessages.network],
]);

function structuredError(payload: unknown, depth = 0): string | undefined {
  if (!payload || typeof payload !== "object" || depth > 6) return;
  const data = payload as Record<string, unknown>;
  // Prefer the specific nested error over a generic outer business code.
  for (const key of ["detail", "error", "data"]) {
    const message = structuredError(data[key], depth + 1);
    if (message) return message;
  }
  for (const value of [data.code, data.errorCode]) {
    if (typeof value === "string") {
      const message = errorCodes.get(value.trim().toUpperCase());
      if (message) return message;
    }
  }
}

async function responseError(response: Response) {
  // Some proxies mislabel JSON. A broken/HTML error body must not hide the HTTP error.
  try {
    const message = structuredError(await response.json());
    if (message) return message;
  } catch { /* Fall back to status without exposing the response body. */ }
  if (response.status === 413) return errorMessages.size;
  if (response.status === 401) return "消除服务鉴权失败，请检查本地账号和密钥";
  if (response.status === 429) return errorMessages.busy;
  if ([502, 503, 504].includes(response.status)) return errorMessages.unavailable;
  return errorMessages.unknown;
}

/** Frontend -> business backend. Ability-service credentials are managed by that backend. */
async function requestErase(input: EraseRequest) {
  const form = new FormData();
  form.append("image", input.image, "image.jpg");
  form.append("mask", input.mask, "mask.png");
  form.append("metadata", JSON.stringify({ schemaVersion: 1, mode: "erase", target: "base",
    width: input.width, height: input.height, documentId: input.documentId, revision: input.revision,
    coordinateSystem: "0-1000", bboxOrder: "ymin,xmin,ymax,xmax" }));
  const response = await fetch(input.apiUrl, { method: "POST", body: form, signal: input.signal });
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const result = isJson
    ? await resolveJsonImage(await response.json(), input.apiUrl, input.signal) : await response.blob();
  if (!result.type.startsWith("image/")) throw new Error("接口没有返回有效图片");
  return result;
}

export async function callEraseApi(input: EraseRequest) {
  try {
    input.signal.throwIfAborted();
    const result = await requestErase(input);
    input.signal.throwIfAborted();
    return result;
  } catch (error) {
    // Keep cancellation distinct, including aborts while consuming a response body.
    input.signal.throwIfAborted();
    if (error instanceof TypeError) throw new Error(errorMessages.network);
    if (error instanceof SyntaxError) throw new Error("消除服务返回的数据无效，请稍后重试");
    throw error;
  }
}
