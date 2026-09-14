import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/integration.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { readReplacementOutcome: read } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("malformed success receipts remain unknown instead of closing the editor", () => {
  for (const recordId of [undefined, null, "", " \t\n", 0, 123, true, {}, [], ["record"]]) {
    assert.deepEqual(read({ status: "succeeded", recordId }), { status: "pending" });
  }
  assert.deepEqual(read({ status: "succeeded", recordId: " record-a " }), { status: "succeeded", recordId: "record-a" });
});

test("unknown receipts stay pending; definitive failures always have a readable message", () => {
  for (const value of [null, undefined, false, "succeeded", [], {}, { status: "done" }, { status: "pending" }]) {
    assert.deepEqual(read(value), { status: "pending" });
  }
  for (const message of [undefined, null, "", "  ", {}, 123]) {
    const result = read({ status: "failed", message, objectId: {} });
    assert.equal(result.status, "failed");
    assert.match(result.message, /编辑内容已保留/);
    assert.equal(result.objectId, undefined);
  }
  assert.deepEqual(read({ status: "failed", message: " 需修改文案 ", objectId: "text-a" }),
    { status: "failed", message: "需修改文案", objectId: "text-a" });
});
