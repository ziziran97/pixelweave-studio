// Minimal PNG encoder: 8-bit grayscale, no alpha/palette/ancillary chunks.
// CompressionStream("deflate") produces the zlib stream required by PNG IDAT.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function chunk(type: string, data: Uint8Array<ArrayBuffer>) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < bytes.length - 4; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

export async function encodeGrayPng(gray: Uint8Array<ArrayBuffer>, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 0x7fffffff || height > 0x7fffffff || gray.length !== width * height) {
    throw new Error("蒙版尺寸与像素数据不一致");
  }
  // Feed bounded row batches rather than allocating another full uncompressed image.
  let row = 0;
  const rows = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (row === height) { controller.close(); return; }
      const count = Math.min(64, height - row), stride = width + 1;
      const batch = new Uint8Array(stride * count);
      for (let y = 0; y < count; y++) {
        // Filter 0 (None) preserves the binary samples; the leading byte stays zero.
        batch.set(gray.subarray((row + y) * width, (row + y + 1) * width), y * stride + 1);
      }
      row += count; controller.enqueue(batch);
    },
  });
  const compressed = new Uint8Array(await new Response(rows.pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; // bit depth; color type/compression/filter/interlace all remain 0.
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())], { type: "image/png" });
}
