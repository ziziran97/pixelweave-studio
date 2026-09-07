import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Pure business modules only; transpile types with the existing dependency, no test framework or browser mocks.
async function load(path) {
  const code = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const { applyResult, History, sameDocumentContent } = await load("../src/editor/model.ts");
const { binaryPixels } = await load("../src/editor/geometry.ts");
const snapshot = () => ({
  size: { width: 4096, height: 2160 },
  objects: [
    { type: "Image", editorId: "base", editorPurpose: "base", editorAssetId: "asset-original", visible: true },
    { type: "Textbox", editorId: "title", editorPurpose: "content", text: "准确文案", visible: true },
    { type: "Rect", editorId: "hidden", editorPurpose: "content", visible: false },
    { type: "Path", editorId: "drawing", editorPurpose: "content", visible: true },
  ], masks: [{ kind: "rect", operation: "add", points: [{ x: 1, y: 1 }, { x: 10, y: 10 }], width: 0 }],
  adjustments: { brightness: 30, contrast: 0, saturation: 0, blur: 0, grayscale: false, sepia: false },
});

test("base result retains editable text and original snapshot", () => {
  const before = snapshot(), saved = structuredClone(before);
  const next = applyResult(before, { type: "Image", editorId: "new-base", editorPurpose: "base", editorAssetId: "new" });
  assert.deepEqual(next.objects.map(x => x.editorId), ["new-base", "title", "hidden", "drawing"]);
  assert.equal(next.objects[1].text, "准确文案");
  assert.equal(next.masks.length, 0); assert.equal(next.adjustments.brightness, 0);
  next.objects[1].text = "继续编辑";
  assert.deepEqual(before, saved);
});
test("undo branch, adjustment restoration, and independent history copies", () => {
  const history = new History(), first = snapshot(); history.reset(first);
  first.adjustments.brightness = 80;
  assert.equal(history.current.adjustments.brightness, 30);
  history.push(first); history.index--;
  const branch = structuredClone(history.current); branch.objects[1].text = "新分支"; history.push(branch);
  assert.equal(history.entries.length, 2); assert.equal(history.canRedo, false);
  assert.equal(history.entries[0].adjustments.brightness, 30);
});
test("memory budget charges an image only once across many text edits", () => {
  const history = new History(); history.reset(snapshot());
  for (let i = 0; i < 15; i++) { const next = snapshot(); next.objects[1].text = String(i); history.push(next); }
  history.trim(70_000, new Set(["asset-original"]), () => 50_000);
  assert.ok(history.entries.length > 1, "shared base image must not be charged for every edit");
  history.trim(50_100, new Set(["asset-original"]), () => 50_000);
  assert.equal(history.entries.length, 1); assert.equal(history.current.objects[1].text, "14");
});
test("binary mask has only opaque black/white including antialiased and erased edges", () => {
  const pixels = new Uint8ClampedArray([255,255,255,0, 255,255,255,127, 255,255,255,128, 255,255,255,255]);
  assert.equal(binaryPixels(pixels), 2);
  assert.deepEqual([...pixels], [0,0,0,255, 0,0,0,255, 255,255,255,255, 255,255,255,255]);
});


test("selection restoration excludes only masks from document comparison", () => {
  const before = snapshot(), selection = structuredClone(before);
  selection.masks = [];
  assert.equal(sameDocumentContent(before, selection), true);
  for (const mutate of [
    value => { value.objects[1].text = "改变文案"; },
    value => { value.objects[0].editorAssetId = "new-image"; },
    value => { value.objects[2].visible = true; },
    value => { value.adjustments.brightness = 80; },
    value => { value.size.width = 2048; },
    value => { value.futureDocumentProperty = true; },
  ]) {
    const changed = structuredClone(selection); mutate(changed);
    assert.equal(sameDocumentContent(before, changed), false);
  }
});
