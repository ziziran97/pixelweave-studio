import { Textbox, classRegistry, util } from "fabric";
import type { DrawContext } from "fabric";
import { scaleTextFromCorner } from "./textScaling";

const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff01-\uff60]/u;
const opening = new Set(Array.from("（［｛〈《「『【〔〖〘〚‘“([{«"));
const closing = new Set(Array.from("、。，．・：；？！ー々ゝゞヽヾ〻）］｝〉》」』】〕〗〙〛’”)]}»!?%,.:;ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ"));
const space = (char: string) => /^\s+$/u.test(char);
// These are automatic break opportunities, never edits to the source string.
const canSeparate = (before: string, after: string) => !opening.has(before) && !closing.has(after) && !space(after);
const cjkBoundary = (before: string, after: string) => eastAsian.test(before) || eastAsian.test(after);

/** One text object, including its padded background and effects, in canvas and final render. */
export class ContentTextbox extends Textbox {
  static type = "ContentTextbox";
  private opacityCanvas?: HTMLCanvasElement;
  declare private justificationGaps?: Map<number, Set<number>>;
  // Composite all text parts once: reducing fill/stroke/background alpha
  // separately would expose their overlaps and change the original styling.
  drawObject(ctx: CanvasRenderingContext2D, forClipping: boolean | undefined, context: DrawContext) {
    if (forClipping || this.opacity >= 1) {
      this.opacityCanvas = undefined;
      super.drawObject(ctx, forClipping, context); return;
    }
    const transform = ctx.getTransform();
    const padding = Math.max(this.editorTextBackground ? this.editorTextPadding ?? 10 : 0, this.strokeWidth / 2) + this.fontSize;
    const halfWidth = this.width / 2 + padding, halfHeight = this.height / 2 + padding;
    const points = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]]
      .map(([x, y]) => transform.transformPoint({ x, y }));
    const blur = ctx.shadowBlur * 3 + 2;
    const left = Math.max(0, Math.floor(Math.min(...points.map(point => point.x)) + Math.min(0, ctx.shadowOffsetX) - blur));
    const top = Math.max(0, Math.floor(Math.min(...points.map(point => point.y)) + Math.min(0, ctx.shadowOffsetY) - blur));
    const right = Math.min(ctx.canvas.width, Math.ceil(Math.max(...points.map(point => point.x)) + Math.max(0, ctx.shadowOffsetX) + blur));
    const bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...points.map(point => point.y)) + Math.max(0, ctx.shadowOffsetY) + blur));
    if (right <= left || bottom <= top) return;
    const canvas = this.opacityCanvas ??= document.createElement("canvas");
    if (canvas.width !== right - left || canvas.height !== bottom - top) { canvas.width = right - left; canvas.height = bottom - top; }
    const layer = canvas.getContext("2d")!;
    layer.resetTransform(); layer.clearRect(0, 0, canvas.width, canvas.height);
    layer.save();
    try {
      layer.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e - left, transform.f - top);
      layer.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
      layer.shadowColor = ctx.shadowColor; layer.shadowBlur = ctx.shadowBlur;
      layer.shadowOffsetX = ctx.shadowOffsetX; layer.shadowOffsetY = ctx.shadowOffsetY;
      super.drawObject(layer, false, context);
    } finally { layer.restore(); }
    ctx.save();
    try {
      ctx.resetTransform(); ctx.shadowColor = "transparent";
      ctx.drawImage(canvas, left, top);
    } finally { ctx.restore(); }
  }
  // Share expanded advances between rendering, caret placement and selection.
  enlargeSpaces() {
    this.justificationGaps = new Map();
    if (this.textAlign !== "justify-left") { super.enlargeSpaces(); return; }
    this._textLines.forEach((line, lineIndex) => {
      if (this.isEndOfWrapping(lineIndex)) return;
      this.getLineWidth(lineIndex); // Populate Fabric's character bounds.
      const first = line.findIndex(char => !/\s/u.test(char));
      let last = line.length - 1;
      while (last >= 0 && /\s/u.test(line[last])) last--;
      const gaps = line.flatMap((char, index) => {
        if (index < first || index >= last) return [];
        if (/[ \t]/u.test(char) && index > first) return [index];
        const next = line[index + 1];
        return !space(char) && !space(next) && cjkBoundary(char, next) && canSeparate(char, next) ? [index] : [];
      });
      if (!gaps.length) return;
      const bounds = this.__charBounds[lineIndex];
      const edge = bounds[last].left + bounds[last].width - this._getWidthOfCharSpacing();
      const extra = (this.width - edge) / gaps.length;
      if (extra <= 0) return;
      const gapSet = new Set(gaps); let shift = 0;
      if (gaps.some(index => !space(line[index]))) this.justificationGaps!.set(lineIndex, gapSet);
      bounds.forEach((box, index) => {
        box.left += shift;
        if (gapSet.has(index)) { box.width += extra; box.kernedWidth += extra; shift += extra; }
      });
    });
  }
  _renderChars(method: "fillText" | "strokeText", ctx: CanvasRenderingContext2D, line: string[], left: number, top: number, lineIndex: number) {
    const gaps = this.justificationGaps?.get(lineIndex);
    if (this.textAlign !== "justify-left" || !gaps || this.path) { super._renderChars(method, ctx, line, left, top, lineIndex); return; }
    // Fabric normally flushes justified runs only at spaces. Flush at our CJK
    // gaps too, keeping Latin runs intact and drawing glyphs at their real size.
    ctx.save();
    try {
      ctx.direction = this.direction; ctx.textAlign = this.direction === "ltr" ? "left" : "right";
      const sign = this.direction === "ltr" ? 1 : -1;
      top -= this.getHeightOfLine(lineIndex) / this.lineHeight * this._fontSizeFraction;
      let start = 0;
      line.forEach((char, index) => {
        const last = index === line.length - 1;
        if (last || gaps.has(index) || this.charSpacing !== 0 || util.hasStyleChanged(this.getCompleteStyleDeclaration(lineIndex, index), this.getCompleteStyleDeclaration(lineIndex, index + 1))) {
          this._renderChar(method, ctx, lineIndex, index, line.slice(start, index + 1).join(""), left + sign * this.__charBounds[lineIndex][start].left, top);
          start = index + 1;
        }
      });
    } finally { ctx.restore(); }
  }
  private wrapEastAsian(source: string, lineIndex: number, limit: number): string[][] {
    const chars = this.graphemeSplit(source), lines: string[][] = [];
    const spacing = this._getWidthOfCharSpacing();
    let start = 0;
    while (start < chars.length) {
      let width = 0, preferred = 0, fallback = 0, end = start;
      for (; end < chars.length; end++) {
        if (end > start && canSeparate(chars[end - 1], chars[end])) {
          fallback = end;
          if (space(chars[end - 1]) || cjkBoundary(chars[end - 1], chars[end])) preferred = end;
          // A very narrow box still keeps a bracket/mark with its character.
          if (width - spacing > limit) break;
        }
        const box = this._getGraphemeBox(chars[end], lineIndex, end, end > start ? chars[end - 1] : undefined, true);
        if (!space(chars[end]) && width + box.kernedWidth - spacing > limit && (preferred || fallback)) {
          end = preferred || fallback; break;
        }
        width += box.kernedWidth;
      }
      const line = chars.slice(start, end);
      const lineWidth = this._measureWord(line, lineIndex, start) - spacing;
      if (lineWidth > limit && !space(line.at(-1)!)) this.dynamicMinWidth = Math.max(this.dynamicMinWidth, lineWidth);
      lines.push(line); start = end;
    }
    return lines;
  }
  /** Keep every grapheme (including spaces) so Fabric's cursor/selection offsets
   * remain exact. Prefer word boundaries; only over-wide words split internally. */
  _wrapText(lines: string[], desiredWidth: number): string[][] {
    this.isWrapping = true;
    const wrapped: string[][] = [];
    const spacing = this._getWidthOfCharSpacing();
    const limit = Math.max(this.minWidth, desiredWidth);
    try {
      lines.forEach((source, lineIndex) => {
        if (eastAsian.test(source)) { wrapped.push(...this.wrapEastAsian(source, lineIndex, limit)); return; }
        const tokens = source.match(/\s+|[^\s]+/gu) ?? [""];
        let line: string[] = [], width = 0, offset = 0;
        const flush = () => { wrapped.push(line); line = []; width = 0; };
        for (const token of tokens) {
          const chars = this.graphemeSplit(token);
          const wordWidth = this._measureWord(chars, lineIndex, offset);
          if (!/^\s*$/u.test(token) && line.some(char => !/^\s$/u.test(char)) && width + wordWidth - spacing > limit) flush();
          for (const char of chars) {
            let box = this._getGraphemeBox(char, lineIndex, offset, line.at(-1), true);
            // A separator stays with the preceding line rather than adding a
            // leading space to the next word. It is retained for text editing.
            if (!/^\s$/u.test(char) && line.length && width + box.kernedWidth - spacing > limit) {
              flush(); box = this._getGraphemeBox(char, lineIndex, offset, undefined, true);
            }
            line.push(char); width += box.kernedWidth; offset++;
            this.dynamicMinWidth = Math.max(this.dynamicMinWidth, box.width - spacing);
          }
        }
        wrapped.push(line);
      });
      // Textbox adopts dynamicMinWidth after wrapping. Reflow at that width now,
      // so a narrow punctuation cluster has the same layout after restoration.
      return this.dynamicMinWidth > limit ? this._wrapText(lines, this.dynamicMinWidth) : wrapped;
    } finally { this.isWrapping = false; }
  }
  static createControls() {
    const { controls } = Textbox.createControls();
    for (const corner of ["tl", "tr", "bl", "br"]) controls[corner].actionHandler = scaleTextFromCorner;
    return { controls: { tl: controls.tl, tr: controls.tr, bl: controls.bl, br: controls.br, ml: controls.ml, mr: controls.mr, mtr: controls.mtr } };
  }
  _renderBackground(ctx: CanvasRenderingContext2D) {
    if (!this.editorTextBackground) return;
    const padding = this.editorTextPadding ?? 10;
    const width = this.width + padding * 2, height = this.height + padding * 2;
    const radius = Math.min(this.editorTextRadius ?? 0, width / 2, height / 2);
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.globalAlpha *= this.editorTextBackgroundOpacity ?? 1;
    ctx.fillStyle = this.editorTextBackgroundColor ?? "#ffffff";
    ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, radius); ctx.fill();
    ctx.restore();
  }
  shouldCache() { this.ownCaching = false; return false; }
}
classRegistry.setClass(ContentTextbox);
