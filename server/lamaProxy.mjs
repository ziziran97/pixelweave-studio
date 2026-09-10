import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const FILE_LIMIT = 25 * 1024 * 1024;
const BODY_LIMIT = FILE_LIMIT * 2 + 64 * 1024;
function reply(res, status, code) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ detail: { code } }));
}

// A local production-test bridge, not a public business backend or open proxy.
export function createLamaProxy({ apiUrl, username, apiKey, timeoutMs = 180000 }) {
  return async function lamaProxy(req, res, next) {
    if (req.url?.split("?")[0] !== "/api/eraser") { next(); return; }
    const host = req.headers.host || "";
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) { reply(res, 403, "LOCAL_ONLY"); return; }
    try {
      if (req.headers["sec-fetch-site"] === "cross-site" ||
          (req.headers.origin && new URL(req.headers.origin).origin !== `http://${host}`)) {
        reply(res, 403, "LOCAL_ONLY"); return;
      }
    } catch { reply(res, 403, "LOCAL_ONLY"); return; }
    if (req.method !== "POST") { reply(res, 405, "METHOD_NOT_ALLOWED"); return; }
    if (!username || !apiKey) { reply(res, 503, "LAMA_CREDENTIALS_MISSING"); return; }
    let target;
    try {
      target = new URL(apiUrl);
      if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || username.includes(":")) throw new Error();
    } catch { reply(res, 503, "LAMA_CONFIG_INVALID"); return; }
    if (!/^multipart\/form-data\s*;/i.test(req.headers["content-type"] || "")) {
      reply(res, 415, "INVALID_MULTIPART_FIELDS"); return;
    }
    if (Number(req.headers["content-length"]) > BODY_LIMIT) { reply(res, 413, "IMAGE_TOO_LARGE"); return; }
    const controller = new AbortController();
    const abortUpload = () => { if (!req.complete) req.destroy(); };
    controller.signal.addEventListener("abort", abortUpload, { once: true });
    // ServerResponse also emits close after a normal finish. Aborting an already
    // consumed upstream body can race with Undici's stream completion.
    const disconnect = () => { if (!res.writableFinished) controller.abort(); };
    req.on("aborted", disconnect);
    res.on("close", disconnect);
    const duration = Number(timeoutMs);
    const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")),
      Number.isFinite(duration) && duration > 0 ? duration : 180000);
    try {
      const buffers = []; let length = 0;
      for await (const buffer of req.iterator({ destroyOnReturn: false })) {
        length += buffer.length;
        if (length > BODY_LIMIT) { reply(res, 413, "IMAGE_TOO_LARGE"); return; }
        buffers.push(buffer);
      }
      controller.signal.throwIfAborted();
      let input;
      try {
        input = await new Request("http://localhost/upload", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: Buffer.concat(buffers) }).formData();
      } catch { reply(res, 400, "INVALID_MULTIPART_FIELDS"); return; }
      buffers.length = 0;
      if ([...input.keys()].some(key => !["image", "mask", "metadata"].includes(key)) ||
          input.getAll("image").length !== 1 || input.getAll("mask").length !== 1 || input.getAll("metadata").length > 1) {
        reply(res, 422, "INVALID_MULTIPART_FIELDS"); return;
      }
      const image = input.get("image"), mask = input.get("mask");
      if (!(image instanceof Blob) || !(mask instanceof Blob)) { reply(res, 422, "INVALID_MULTIPART_FIELDS"); return; }
      if (image.type !== "image/jpeg") { reply(res, 415, "UNSUPPORTED_IMAGE_TYPE"); return; }
      if (mask.type !== "image/png") { reply(res, 415, "UNSUPPORTED_MASK_TYPE"); return; }
      if (image.size > FILE_LIMIT || mask.size > FILE_LIMIT) { reply(res, 413, "IMAGE_TOO_LARGE"); return; }
      const form = new FormData();
      form.append("image", image, "image.jpg"); form.append("mask", mask, "mask.png");
      let requestId = randomUUID();
      try {
        const value = JSON.parse(input.get("metadata") || "{}").requestId;
        if (typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value)) requestId = value;
      } catch { /* Legacy metadata is optional and is never forwarded. */ }
      controller.signal.throwIfAborted();
      const upstream = await fetch(target, { method: "POST", body: form, redirect: "error", signal: controller.signal,
        headers: { Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString("base64")}`, "X-Request-Id": requestId } });
      const type = upstream.headers.get("content-type") || "application/octet-stream";
      if (upstream.ok && type.split(";")[0].trim().toLowerCase() !== "image/jpeg") {
        await upstream.body?.cancel(); reply(res, 502, "LAMA_INVALID_RESPONSE"); return;
      }
      res.statusCode = upstream.status;
      res.setHeader("content-type", upstream.ok ? "image/jpeg" : type.includes("json") ? "application/json" : "text/plain");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-request-id", requestId);
      for (const name of ["x-request-id", "x-algorithm-version", "x-queue-wait-ms", "x-inference-ms", "x-total-ms", "x-image-width", "x-image-height", "retry-after"]) {
        if (upstream.headers.has(name)) res.setHeader(name, upstream.headers.get(name));
      }
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
      else res.end();
    } catch {
      // Never log or return fetch options, credentials or raw transport errors.
      const timedOut = controller.signal.reason?.name === "TimeoutError";
      if (!res.destroyed) reply(res, timedOut ? 504 : 502, timedOut ? "LAMA_REQUEST_TIMEOUT" : "LAMA_CONNECTION_FAILED");
    } finally {
      clearTimeout(timer); req.off("aborted", disconnect); res.off("close", disconnect);
      controller.signal.removeEventListener("abort", abortUpload);
    }
  };
}
