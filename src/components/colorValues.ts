export type ColorFormat = "HEX" | "RGB" | "HSL";
export type ColorTone = { h: number; s: number; v: number };
export function colorTone(hex: string): ColorTone {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}
export function toneHex({ h, s, v }: ColorTone) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, "0"); };
  return `#${f(5)}${f(3)}${f(1)}`;
}
export function colorFields(color: string, format: ColorFormat): string[] {
  if (format === "HEX") return [color.toUpperCase()];
  if (format === "RGB") return color.slice(1).match(/../g)!.map(value => String(parseInt(value, 16)));
  const { h, s, v } = colorTone(color), lightness = v * (1 - s / 2);
  const saturation = lightness === 0 || lightness === 1 ? 0 : (v - lightness) / Math.min(lightness, 1 - lightness);
  return [h, saturation * 100, lightness * 100].map(value => String(Math.round(value * 100) / 100));
}
export function fieldsColor(fields: string[], format: ColorFormat): string | undefined {
  if (format === "HEX") return /^#?[\da-f]{6}$/i.test(fields[0].trim()) ? `#${fields[0].trim().replace("#", "").toLowerCase()}` : undefined;
  if (fields.some(value => !/^(\d+(\.\d*)?|\.\d+)$/.test(value.trim()))) return;
  const numbers = fields.map(Number);
  if (format === "RGB") return numbers.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    ? "#" + numbers.map(value => value.toString(16).padStart(2, "0")).join("") : undefined;
  const [h, s, l] = numbers;
  if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) return;
  const lightness = l / 100, v = lightness + s / 100 * Math.min(lightness, 1 - lightness);
  return toneHex({ h: h % 360, s: v ? 2 * (1 - lightness / v) : 0, v });
}
