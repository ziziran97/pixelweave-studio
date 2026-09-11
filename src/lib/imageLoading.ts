type ImageLoadOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  cache?: RequestCache;
  failureMessage?: string;
  timeoutMessage?: string;
};

/** Bound the entire download, including the response body; never retry implicitly. */
export async function fetchImageBlob(url: string, options: ImageLoadOptions = {}) {
  const { signal, timeoutMs = 30000, cache, failureMessage = "图片加载失败，请重试", timeoutMessage = "图片加载超时，请检查网络后重试" } = options;
  signal?.throwIfAborted();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(new DOMException(timeoutMessage, "TimeoutError")), timeoutMs);
  try {
    const download = fetch(url, { signal: controller.signal, cache }).then(async response => {
      if (!response.ok) throw new Error(failureMessage);
      const blob = await response.blob();
      if (!blob.size) throw new Error(failureMessage);
      return blob;
    });
    return await Promise.race([download, aborted]);
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new Error(controller.signal.reason?.name === "TimeoutError" ? timeoutMessage : failureMessage);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
  }
}
