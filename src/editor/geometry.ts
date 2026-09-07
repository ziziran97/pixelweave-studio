/** Threshold selection coverage, not RGB: transparent black is outside the mask. */
export function binaryPixels(data: Uint8ClampedArray) {
  let selected = 0;
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i + 3] >= 128 ? 255 : 0;
    if (value) selected++;
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  return selected;
}
