import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import ts from "typescript";

const source = await readFile(new URL("../src/editor/grayPng.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { encodeGrayPng } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

// Independent parsing, bitwise CRC, and Node zlib inflation; no encoder helpers reused.
for (const [width, height] of [[1, 1], [37, 131], [1024, 1024]]) test(`gray PNG header, CRC and exact samples ${width}x${height}`, async () => {
  const pixels = Uint8Array.from({ length: width * height }, (_, i) => ((i * 13 + Math.floor(i / width)) % 29 < 11 ? 255 : 0));
  const blob = await encodeGrayPng(pixels, width, height), bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, "image/png");
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8; const types = [], data = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    types.push(type);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(offset + 8 + length));
    if (type === "IHDR") {
      assert.equal(length, 13); assert.equal(bytes.readUInt32BE(offset + 8), width); assert.equal(bytes.readUInt32BE(offset + 12), height);
      assert.deepEqual([...bytes.subarray(offset + 16, offset + 21)], [8, 0, 0, 0, 0]);
    }
    if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.equal(offset, bytes.length); assert.deepEqual(types, ["IHDR", "IDAT", "IEND"]);
  const raw = inflateSync(Buffer.concat(data)); assert.equal(raw.length, (width + 1) * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width + 1)], 0);
    assert.deepEqual([...raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1))], [...pixels.subarray(y * width, (y + 1) * width)]);
  }
});

test("gray PNG rejects mismatched and invalid dimensions", async () => {
  for (const [w, h] of [[0, 1], [-1, 1], [1.5, 1], [2, 2], [0x80000000, 1]]) {
    await assert.rejects(encodeGrayPng(new Uint8Array(1), w, h), /蒙版尺寸/);
  }
});
