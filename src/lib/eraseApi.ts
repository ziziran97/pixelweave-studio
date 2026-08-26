export type EraseRequest = {
  apiUrl: string;
  image: Blob;
  mask: Blob;
  signal?: AbortSignal;
};

export type InstructionEditRequest = {
  apiUrl: string;
  image: Blob;
  prompt: string;
  objects?: string;
  signal?: AbortSignal;
};

export function dataUrlToBlob(dataUrl: string) {
  const [meta, payload] = dataUrl.split(",");
  const mime = meta.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const bytes = atob(payload);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) result[i] = bytes.charCodeAt(i);
  return new Blob([result], { type: mime });
}

async function resolveJsonImage(payload: unknown, signal?: AbortSignal) {
  if (!payload || typeof payload !== "object") {
    throw new Error("消除接口返回的 JSON 中没有图片");
  }
  const data = payload as Record<string, unknown>;
  const nested =
    data.data && typeof data.data === "object"
      ? (data.data as Record<string, unknown>)
      : {};
  const candidate = [
    data.url,
    data.imageUrl,
    data.resultUrl,
    data.image,
    data.base64,
    nested.url,
    nested.imageUrl,
    nested.resultUrl,
    nested.image,
    nested.base64,
  ].find((value) => typeof value === "string") as string | undefined;

  if (!candidate) throw new Error("消除接口返回的 JSON 中没有可识别的图片字段");
  if (candidate.startsWith("data:")) return dataUrlToBlob(candidate);
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(candidate) && candidate.length > 200) {
    return dataUrlToBlob(`data:image/png;base64,${candidate.replace(/\s/g, "")}`);
  }
  const response = await fetch(candidate, { signal });
  if (!response.ok) throw new Error(`读取消除结果失败：HTTP ${response.status}`);
  return response.blob();
}

export async function callEraseApi({ apiUrl, image, mask, signal }: EraseRequest) {
  const form = new FormData();
  form.append("image", image, "image.jpg");
  form.append("mask", mask, "mask.jpg");
  const response = await fetch(apiUrl, {
    method: "POST",
    body: form,
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`消除接口失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 120)}` : ""}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return resolveJsonImage(await response.json(), signal);
  }
  const result = await response.blob();
  if (!result.type.startsWith("image/")) throw new Error("消除接口没有返回图片");
  return result;
}

export async function callInstructionEditApi({
  apiUrl,
  image,
  prompt,
  objects,
  signal,
}: InstructionEditRequest) {
  const form = new FormData();
  form.append("image", image, "image.jpg");
  form.append("prompt", prompt);
  if (objects) form.append("objects", objects);
  const response = await fetch(apiUrl, {
    method: "POST",
    body: form,
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `指令改图接口失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 120)}` : ""}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return resolveJsonImage(await response.json(), signal);
  }
  const result = await response.blob();
  if (!result.type.startsWith("image/")) {
    throw new Error("指令改图接口没有返回图片");
  }
  return result;
}
