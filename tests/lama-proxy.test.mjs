import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createLamaProxy } from "../server/lamaProxy.mjs";

async function serve(t, handler) {
  const server = http.createServer(handler); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function proxy(t, upstream, extra = {}) {
  const middleware = createLamaProxy({ apiUrl: upstream, username: "test-user", apiKey: "test-key", ...extra });
  return serve(t, (req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
}
function form() {
  const data = new FormData();
  data.append("image", new Blob(["jpeg-input"], { type: "image/jpeg" }), "image.jpg");
  data.append("mask", new Blob(["png-input"], { type: "image/png" }), "mask.png");
  data.append("metadata", JSON.stringify({ documentId: "local-only", revision: 2, coordinateSystem: "0-1000" }));
  return data;
}
test("bridge forwards only image/mask with server-side Basic Auth and returns JPEG", async t => {
  let fields, authorization, requestId;
  const upstream = await serve(t, async (req, res) => {
    authorization = req.headers.authorization; requestId = req.headers["x-request-id"];
    const buffers = []; for await (const buffer of req) buffers.push(buffer);
    const data = await new Request("http://localhost", { method: "POST", body: Buffer.concat(buffers), headers: req.headers }).formData();
    fields = [...data.keys()];
    assert.equal(data.get("image").type, "image/jpeg"); assert.equal(await data.get("image").text(), "jpeg-input");
    assert.equal(data.get("mask").type, "image/png"); assert.equal(await data.get("mask").text(), "png-input");
    res.writeHead(200, { "content-type": "image/jpeg", "x-request-id": requestId, "x-total-ms": "23.4" }).end("jpeg-output");
  });
  const base = await proxy(t, upstream);
  const response = await fetch(`${base}/api/eraser`, { method: "POST", body: form() });
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(await response.text(), "jpeg-output");
  assert.deepEqual(fields, ["image", "mask"]); assert.equal(authorization, `Basic ${Buffer.from("test-user:test-key").toString("base64")}`);
  assert.ok(requestId); assert.equal(response.headers.get("x-total-ms"), "23.4"); assert.equal(response.headers.get("authorization"), null);
});
test("blank credentials fail locally, without sending upstream", async t => {
  let calls = 0; const upstream = await serve(t, (_req, res) => { calls++; res.end(); });
  const base = await proxy(t, upstream, { username: "", apiKey: "" });
  const response = await fetch(`${base}/api/eraser`, { method: "POST", body: form() });
  assert.equal(response.status, 503); assert.equal((await response.json()).detail.code, "LAMA_CREDENTIALS_MISSING"); assert.equal(calls, 0);
});
for (const [status, payload] of [[401, { status: false, results: null, msg: "Unauthorized" }], [422, { detail: { code: "IMAGE_MASK_SIZE_MISMATCH" } }], [429, { detail: { code: "LAMA_INPAINT_BUSY" } }]]) {
  test(`upstream HTTP ${status} and error body are preserved`, async t => {
    const upstream = await serve(t, (_req, res) => res.writeHead(status, { "content-type": "application/json", "retry-after": "1" }).end(JSON.stringify(payload)));
    const base = await proxy(t, upstream); const response = await fetch(`${base}/api/eraser`, { method: "POST", body: form() });
    assert.equal(response.status, status); assert.deepEqual(await response.json(), payload);
  });
}
test("reject duplicate fields and cross-site requests without upstream calls", async t => {
  let calls = 0; const upstream = await serve(t, (_req, res) => { calls++; res.end(); }); const base = await proxy(t, upstream);
  const duplicate = form(); duplicate.append("mask", new Blob(["x"], { type: "image/png" }), "mask.png");
  assert.equal((await fetch(`${base}/api/eraser`, { method: "POST", body: duplicate })).status, 422);
  assert.equal((await fetch(`${base}/api/eraser`, { method: "POST", body: form(), headers: { origin: "https://another-site.example" } })).status, 403);
  assert.equal(calls, 0);
});
test("invalid successful response is never delivered as a result image", async t => {
  const upstream = await serve(t, (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("not an image"));
  const base = await proxy(t, upstream); const response = await fetch(`${base}/api/eraser`, { method: "POST", body: form() });
  assert.equal(response.status, 502); assert.equal((await response.json()).detail.code, "LAMA_INVALID_RESPONSE");
});
test("timeout aborts upstream request without retry", async t => {
  let calls = 0; const upstream = await serve(t, req => { calls++; req.resume(); });
  const base = await proxy(t, upstream, { timeoutMs: 80 });
  const response = await fetch(`${base}/api/eraser`, { method: "POST", body: form() });
  assert.equal(response.status, 504); assert.equal((await response.json()).detail.code, "LAMA_REQUEST_TIMEOUT"); assert.equal(calls, 1);
});
test("browser cancellation closes the upstream connection", async t => {
  let started, closed;
  const began = new Promise(resolve => { started = resolve; }); const ended = new Promise(resolve => { closed = resolve; });
  const upstream = await serve(t, (req, res) => { req.resume(); res.on("close", closed); started(); });
  const base = await proxy(t, upstream); const controller = new AbortController();
  const request = fetch(`${base}/api/eraser`, { method: "POST", body: form(), signal: controller.signal });
  await began; controller.abort(); await assert.rejects(request, { name: "AbortError" });
  let timer;
  try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("upstream remained open")), 1000); })]); }
  finally { clearTimeout(timer); }
});
