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
  if (!response.ok) throw new Error(`读取结果图片失败：HTTP ${response.status}`);
  return response.blob();
}

export type EraseRequest = {
  apiUrl: string; image: Blob; mask: Blob;
  width: number; height: number;
  documentId: string; revision: number; signal: AbortSignal;
};

/** Proposed v1 adapter. Configuring a URL does not establish backend compatibility. */
export async function callEraseApi(input: EraseRequest) {
  const form = new FormData();
  form.append("image", input.image, "image.jpg");
  form.append("mask", input.mask, "mask.png");
  form.append("metadata", JSON.stringify({ schemaVersion: 1, mode: "erase", target: "base",
    width: input.width, height: input.height, documentId: input.documentId, revision: input.revision,
    coordinateSystem: "0-1000", bboxOrder: "ymin,xmin,ymax,xmax" }));
  const response = await fetch(input.apiUrl, { method: "POST", body: form, signal: input.signal });
  if (!response.ok) throw new Error(`图片编辑接口失败：HTTP ${response.status}`);
  const result = (response.headers.get("content-type") ?? "").includes("application/json")
    ? await resolveJsonImage(await response.json(), input.apiUrl, input.signal) : await response.blob();
  if (!result.type.startsWith("image/")) throw new Error("接口没有返回有效图片");
  return result;
}
