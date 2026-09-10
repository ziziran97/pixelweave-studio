import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/eraseApi.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { callEraseApi } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const input = (signal = new AbortController().signal) => ({
  apiUrl: "/business/erase", image: new Blob(["jpeg"], { type: "image/jpeg" }),
  mask: new Blob(["png"], { type: "image/png" }), width: 128, height: 96,
  documentId: "document-test", revision: 7, signal,
});

test("JPEG binary response preserves multipart files, all metadata and browser boundary without Basic Auth", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/business/erase"); assert.equal(init.method, "POST");
    assert.equal(init.headers, undefined);
    assert.deepEqual([...init.body.keys()], ["image", "mask", "metadata"]);
    assert.equal(init.body.get("image").name, "image.jpg");
    assert.equal(init.body.get("image").type, "image/jpeg");
    assert.equal(init.body.get("mask").name, "mask.png");
    assert.equal(init.body.get("mask").type, "image/png");
    assert.deepEqual(JSON.parse(init.body.get("metadata")), {
      schemaVersion: 1, mode: "erase", target: "base", width: 128, height: 96,
      documentId: "document-test", revision: 7, coordinateSystem: "0-1000", bboxOrder: "ymin,xmin,ymax,xmax",
    });
    return new Response(new Blob(["result"], { type: "image/jpeg" }));
  });
  const result = await callEraseApi(input());
  assert.equal(result.type, "image/jpeg"); assert.equal(await result.text(), "result");
  assert.equal(fetch.mock.callCount(), 1);
});

const cases = [
  ["production size mismatch", 422, { detail: { code: "IMAGE_MASK_SIZE_MISMATCH" } }, "选区数据无效，请重新选择"],
  ["production queue timeout", 429, { detail: { code: "LAMA_INPAINT_QUEUE_TIMEOUT" } }, "排队等待超时，请稍后重试"],
  ["bridge processing timeout", 504, { detail: { code: "LAMA_REQUEST_TIMEOUT" } }, "等待消除结果超时，后台可能仍在处理，请稍后重试"],
  ["HTTP processing timeout", 504, "<html>gateway timeout</html>", "等待消除结果超时，后台可能仍在处理，请稍后重试"],
  ["HTTP request timeout", 408, "", "等待消除结果超时，后台可能仍在处理，请稍后重试"],
  ["invalid result", 502, { detail: { code: "LAMA_INVALID_RESPONSE" } }, "消除服务返回的图片无效，请稍后重试"],
  ["bridge connection failed", 502, { detail: { code: "LAMA_CONNECTION_FAILED" } }, "无法连接消除服务，请稍后重试"],
  ["local credentials missing", 503, { detail: { code: "LAMA_CREDENTIALS_MISSING" } }, "请先填写本地消除服务账号和密钥，再重启生产测试服务"],
  ["production auth", 401, { status: false, results: null, msg: "Unauthorized" }, "消除服务鉴权失败，请检查本地账号和密钥"],
  ["ability detail", 422, { detail: { code: "INVALID_MASK_FORMAT", message: "private detail" } }, "选区数据无效，请重新选择"],
  ["business nesting", 500, { code: "FAIL", data: { error: { detail: { code: "MASK_SIZE_MISMATCH" } } } }, "选区数据无效，请重新选择"],
  ["pixel limit", 400, { code: "PIXEL_LIMIT_EXCEEDED" }, "图片过大，请调整后重试"],
  ["file limit", 400, { errorCode: "FILE_TOO_LARGE" }, "图片过大，请调整后重试"],
  ["empty selection", 400, { error: { code: "EMPTY_MASK" } }, "选区数据无效，请重新选择"],
  ["queue limit", 500, { error: { code: "QUEUE_FULL" } }, "服务繁忙，请稍后重试"],
  ["not ready", 500, { code: "SERVICE_NOT_READY" }, "消除服务暂不可用，请稍后重试"],
  ["non JSON", 500, "<html>internal server error</html>", "消除请求失败，请稍后重试"],
  ["unknown", 422, { detail: { code: "NEW_UNKNOWN", message: "private detail" } }, "消除请求失败，请稍后重试"],
  ["malformed JSON with status", 413, '{"detail":', "图片过大，请调整后重试"],
  ["HTTP busy", 429, "", "服务繁忙，请稍后重试"],
  ["HTTP unavailable", 503, "", "消除服务暂不可用，请稍后重试"],
];
for (const [label, status, body, message] of cases) test(`error: ${label}, no automatic retry`, async t => {
  // Deliberately omit JSON content type to cover mislabelled proxy errors.
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  await assert.rejects(callEraseApi(input()), { message });
  assert.equal(fetch.mock.callCount(), 1);
});

test("broken error body preserves HTTP fallback", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("body failure")); } }), { status: 429 }));
  await assert.rejects(callEraseApi(input()), { message: "服务繁忙，请稍后重试" });
});

test("network failure is translated without retry", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(callEraseApi(input()), { message: "无法连接消除服务，请稍后重试" });
  assert.equal(fetch.mock.callCount(), 1);
});

test("cancellation during fetch remains AbortError", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const pending = callEraseApi(input(controller.signal)); controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("cancellation while consuming an error body is not swallowed by fallback", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503, json: async () => { controller.abort(); throw controller.signal.reason; } }));
  await assert.rejects(callEraseApi(input(controller.signal)), { name: "AbortError" });
});

test("already cancelled request never fetches", async t => {
  const controller = new AbortController(); controller.abort();
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  await assert.rejects(callEraseApi(input(controller.signal)), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("existing JSON data URL result remains supported", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: { image: "data:image/jpeg;base64,cmVzdWx0" } }));
  const result = await callEraseApi(input());
  assert.equal(result.type, "image/jpeg"); assert.equal(await result.text(), "result");
});

test("malformed successful JSON has a readable response error", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("{", { headers: { "content-type": "application/json" } }));
  await assert.rejects(callEraseApi(input()), { message: "消除服务返回的数据无效，请稍后重试" });
});

for (const body of [{}, { image: "data:image/png;base64,not-valid-@" }, { url: "http://[invalid" }, { url: "file:///private.jpg" }]) {
  test(`invalid JSON image is classified as an invalid result: ${JSON.stringify(body)}`, async t => {
    const location = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "http://localhost/" } });
    t.after(() => { if (location) Object.defineProperty(globalThis, "location", location); else delete globalThis.location; });
    const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(callEraseApi(input()), { message: "消除服务返回的图片无效，请稍后重试" });
    assert.equal(fetch.mock.callCount(), 1);
  });
}
