import { Shadow, Textbox } from "fabric";
import type { TextProperties } from "../types";

export function textProperties(text: Textbox): TextProperties {
  const shadow = text.shadow;
  return {
    fontFamily: text.fontFamily, fontSize: text.fontSize, fill: String(text.fill ?? "#2574d8"),
    fontWeight: String(text.fontWeight), fontStyle: text.fontStyle,
    background: text.editorTextBackground ?? false, backgroundColor: text.editorTextBackgroundColor ?? "#ffffff",
    backgroundPadding: text.editorTextPadding ?? 10, backgroundRadius: text.editorTextRadius ?? 0, textAlign: text.textAlign, lineHeight: text.lineHeight, charSpacing: text.charSpacing,
    stroke: String(text.stroke ?? "#ffffff"), strokeWidth: text.stroke ? text.strokeWidth : 0,
    shadowColor: shadow?.color ?? "#000000", shadowBlur: shadow?.blur ?? 0,
    shadowOffsetX: shadow?.offsetX ?? 0, shadowOffsetY: shadow?.offsetY ?? 0,
  };
}
export function applyTextProperties(text: Textbox, values: TextProperties) {
  text.set({ fontFamily: values.fontFamily, fontSize: values.fontSize, fill: values.fill, fontWeight: values.fontWeight, fontStyle: values.fontStyle as "normal" | "italic",
    editorTextBackground: values.background, editorTextBackgroundColor: values.backgroundColor,
    editorTextPadding: values.backgroundPadding, editorTextRadius: values.backgroundRadius,
    textAlign: values.textAlign, lineHeight: values.lineHeight, charSpacing: values.charSpacing,
    stroke: values.strokeWidth > 0 ? values.stroke : null, strokeWidth: values.strokeWidth,
    paintFirst: "stroke", splitByGrapheme: true,
    shadow: values.shadowBlur || values.shadowOffsetX || values.shadowOffsetY
      ? new Shadow({ color: values.shadowColor, blur: values.shadowBlur, offsetX: values.shadowOffsetX, offsetY: values.shadowOffsetY }) : null,
  });
  text.initDimensions(); text.setCoords();
}

export const DEFAULT_TEXT: TextProperties = {
  fontFamily: "Microsoft YaHei", fontSize: 40, fill: "#2574d8", fontWeight: "normal", fontStyle: "normal",
  textAlign: "left", lineHeight: 1.16, charSpacing: 0,
  background: false, backgroundColor: "#ffffff", backgroundPadding: 10, backgroundRadius: 0,
  stroke: "#ffffff", strokeWidth: 0, shadowColor: "#000000", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
};
