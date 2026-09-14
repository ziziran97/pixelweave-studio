import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/editor/submissionProgress.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { readReplacementProgress: read, submissionSteps: steps } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("person metadata is processed before OCR, with no-text skipping and late-stage protection", () => {
  assert.equal(read({ stage: "marking" }, "person")?.stage, "marking");
  assert.equal(read({ stage: "ocr" }, "marking")?.stage, "ocr", "OCR after metadata must not be treated as a backwards report");
  assert.equal(read({ stage: "image_text" }, "ocr")?.stage, "image_text");
  assert.equal(read({ stage: "saving" }, "image_text")?.stage, "saving");
  assert.equal(read({ stage: "saving" }, "ocr")?.stage, "saving", "a successful OCR with no text can skip text detection");
  assert.equal(read({ stage: "marking" }, "ocr"), undefined, "late metadata reports cannot replace OCR progress");
  assert.equal(read({ stage: "person" }, "marking"), undefined);
  assert.equal(read({ stage: "image_text" }, "saving"), undefined);
  assert.equal(read({ stage: "marking", message: "正在验证人物标记…" }, "marking")?.message, "正在验证人物标记…");
});

test("stage callbacks reject malformed and backwards reports; legacy text cannot imply completion", () => {
  for (const value of [null, 1, {}, { stage: "complete" }, { stage: "ocr", message: 12 }, "  "]) assert.equal(read(value), undefined);
  assert.equal(read({ stage: "person" }, "saving"), undefined);
  assert.deepEqual(read("  已保存  "), { message: "已保存" });
  assert.equal(read({ stage: "saving", message: " " }).stage, "saving");
  assert.ok(read({ stage: "ocr" }).message.includes("识别"));
  assert.equal(read("a".repeat(700)).message.length, 500);
  assert.equal(read({ stage: "ocr", message: "a".repeat(700) }).message.length, 500);
});
test("skipped text checks and review retry stay distinct from successful completion", () => {
  const base = { step: "image", status: "processing", textsSkipped: true, waitStartedAt: 0 };
  assert.deepEqual(steps(base).map(item => item.status), ["skipped", "active", "waiting", "waiting"]);
  assert.deepEqual(steps({ ...base, step: "review", status: "review_failed" }).map(item => item.status), ["skipped", "done", "done", "failed"]);
  assert.deepEqual(steps({ ...base, step: "review", status: "preview_complete" }).map(item => item.status), ["skipped", "done", "done", "done"]);
});
