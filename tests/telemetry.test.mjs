import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/telemetry.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { EraseTelemetry, readEraseTelemetry, clearEraseTelemetry } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const context = { requestId: "request-one", documentId: "document-one", imageSessionId: "image-session-one", revision: 2, width: 512, height: 384, source: "online" };
const begin = () => { clearEraseTelemetry(); return new EraseTelemetry("test", undefined, true).start(context); };
const events = name => readEraseTelemetry().filter(event => event.name === name);

test("one attempt keeps identity and records acceptance exactly once, separately from cleanup", () => {
  const run = begin(); run.requestStarted(); run.requestStarted();
  run.response({ httpStatus: 200, algorithmVersion: "v2", queueWaitMs: 0 });
  run.requestFinished("success"); run.previewShown(); run.previewShown();
  run.decision("accepted"); run.decision("discarded"); run.decision("no_decision", "unmount");
  assert.equal(events("erase_request_started").length, 1); assert.equal(events("erase_request_finished").length, 1);
  assert.equal(events("erase_preview_shown").length, 1); assert.equal(events("erase_decision").length, 1);
  assert.equal(events("erase_decision")[0].outcome, "accepted"); assert.equal(events("erase_decision")[0].queueWaitMs, 0);
  assert.equal(events("erase_decision")[0].algorithmVersion, "v2");
  assert.equal(new Set(readEraseTelemetry().map(event => event.eventId)).size, readEraseTelemetry().length);
  assert.ok(readEraseTelemetry().every(event => event.requestId === context.requestId && event.environment === "test"));
});
test("cancelled wait and late success cannot become a failure, result or decision", () => {
  const run = begin(); run.requestStarted(); run.cancel("waiting", "user_cancel", "job-one");
  run.cancel("waiting", "unmount", "job-one"); run.response({ algorithmVersion: "late" }); run.requestFinished("success"); run.previewShown(); run.decision("discarded");
  assert.equal(events("erase_request_finished")[0].outcome, "cancelled");
  assert.equal(events("erase_cancelled").length, 1); assert.equal(events("erase_decision").length, 0);
  assert.equal(events("erase_preview_shown").length, 0);
});
test("preparation failure has no service invocation; request failures are terminal", () => {
  let run = begin(); run.preparationFailed(); run.cancel("preparing", "unmount", "job");
  assert.equal(events("erase_request_started").length, 0); assert.equal(events("erase_preparation_failed").length, 1);
  run = begin(); run.requestStarted(); run.requestFinished("failure", "QUEUE_TIMEOUT"); run.decision("no_decision", "close");
  assert.equal(events("erase_request_finished")[0].errorCode, "QUEUE_TIMEOUT"); assert.equal(events("erase_decision").length, 0);
  assert.equal("algorithmVersion" in events("erase_request_finished")[0], false);
});
test("preview failures and retries reuse the result, and leaving is not rejection", () => {
  const run = begin(); run.requestStarted(); run.requestFinished("success");
  run.previewFailed("generate", 1, "generate:1"); run.previewFailed("generate", 1, "generate:1");
  run.cancel("preview", "user_cancel", "preview-job"); run.previewFailed("load", 1, "load:2:0"); run.previewShown();
  run.applyFailed(); run.decision("no_decision", "image_change");
  assert.equal(events("erase_request_finished").length, 1); assert.equal(events("erase_preview_failed").length, 2);
  assert.equal(events("erase_decision")[0].outcome, "no_decision"); assert.equal(events("erase_decision")[0].previewShown, true);
  assert.equal(events("erase_apply_failed").length, 1);
});
test("receiver exceptions, rejected promises and pending promises do not block event production", async () => {
  clearEraseTelemetry();
  for (const receiver of [() => { throw new Error("receiver failed"); }, () => Promise.reject(new Error("offline")), () => new Promise(() => {})]) {
    const run = new EraseTelemetry("test", receiver, true).start(context); run.requestStarted(); run.requestFinished("success"); run.decision("accepted");
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(events("erase_decision").length, 3);
});
test("diagnostics are bounded copies and production without a receiver retains nothing", async () => {
  clearEraseTelemetry(); const changed = { ...context };
  const telemetry = new EraseTelemetry("development", event => { event.width = 1; }, true);
  const run = telemetry.start(changed); changed.width = 9; run.requestStarted();
  await Promise.resolve(); assert.equal(readEraseTelemetry()[0].width, 512); assert.equal(readEraseTelemetry()[1].width, 512);
  readEraseTelemetry()[0].width = 2; assert.equal(readEraseTelemetry()[0].width, 512);
  for (let i = 0; i < 210; i++) telemetry.start({ ...context, requestId: `request-${i}` });
  assert.equal(readEraseTelemetry().length, 200);
  clearEraseTelemetry(); new EraseTelemetry("production").start(context); assert.deepEqual(readEraseTelemetry(), []);
});
