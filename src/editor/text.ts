import { Shadow, Textbox } from "fabric";
import type { TextProperties } from "../types";
import { FONT_FAMILY, fontWeight, supportsItalic } from "./fonts";

export const isVerticalText = (text: Textbox) => Math.abs(((text.angle % 360) + 360) % 360 - 90) < .0001;

export function toggleTextBold(values: TextProperties): TextProperties {
  const weight = fontWeight(values.fontWeight, values.fontFamily);
  if (weight === "700") {
    const restored = fontWeight(values.boldRestoreWeight ?? "400", values.fontFamily);
    return { ...values, fontWeight: restored, fontStyle: supportsItalic(values.fontFamily, restored) ? values.fontStyle : "normal", boldRestoreWeight: undefined };
  }
  return { ...values, fontWeight: "700", fontStyle: supportsItalic(values.fontFamily, "700") ? values.fontStyle : "normal", boldRestoreWeight: weight };
}

export function textProperties(text: Textbox): TextProperties {
  const shadow = text.shadow;
  return {
    fontFamily: text.fontFamily, fontSize: text.fontSize, fill: String(text.fill ?? "#2574d8"),
    fontWeight: String(text.fontWeight), fontStyle: text.fontStyle,
    underline: text.underline, linethrough: text.linethrough,
    opacity: Math.round(text.opacity * 100),
    background: text.editorTextBackground ?? false, backgroundColor: text.editorTextBackgroundColor ?? "#ffffff",
    backgroundPadding: text.editorTextPadding ?? 10, backgroundRadius: text.editorTextRadius ?? 0, textAlign: text.textAlign, lineHeight: text.lineHeight, charSpacing: text.charSpacing,
    strokeEnabled: text.editorTextStrokeEnabled ?? (!!text.stroke && text.strokeWidth > 0),
    stroke: String(text.stroke ?? text.editorTextStrokeColor ?? "#ffffff"),
    strokeWidth: text.stroke ? text.strokeWidth : text.editorTextStrokeWidth ?? 2,
    shadowEnabled: text.editorTextShadowEnabled ?? !!shadow,
    shadowColor: shadow?.color ?? text.editorTextShadowColor ?? "#000000", shadowBlur: shadow?.blur ?? text.editorTextShadowBlur ?? 0,
    shadowOffsetX: shadow?.offsetX ?? text.editorTextShadowOffsetX ?? 0, shadowOffsetY: shadow?.offsetY ?? text.editorTextShadowOffsetY ?? 0,
    boldRestoreWeight: text.editorTextBoldRestoreWeight,
  };
}
export function applyTextProperties(text: Textbox, values: TextProperties) {
  const strokeEnabled = values.strokeEnabled ?? values.strokeWidth > 0;
  const shadowEnabled = values.shadowEnabled ?? !!(values.shadowBlur || values.shadowOffsetX || values.shadowOffsetY);
  text.set({ fontFamily: values.fontFamily, fontSize: values.fontSize, fill: values.fill, fontWeight: values.fontWeight, fontStyle: values.fontStyle as "normal" | "italic",
    underline: values.underline ?? false, linethrough: values.linethrough ?? false,
    opacity: Math.max(0, Math.min(100, values.opacity ?? 100)) / 100,
    editorTextBackground: values.background, editorTextBackgroundColor: values.backgroundColor,
    editorTextPadding: values.backgroundPadding, editorTextRadius: values.backgroundRadius,
    editorTextShadowColor: values.shadowColor,
    editorTextShadowEnabled: shadowEnabled, editorTextShadowBlur: values.shadowBlur,
    editorTextShadowOffsetX: values.shadowOffsetX, editorTextShadowOffsetY: values.shadowOffsetY,
    editorTextStrokeEnabled: strokeEnabled, editorTextStrokeColor: values.stroke, editorTextStrokeWidth: values.strokeWidth,
    editorTextBoldRestoreWeight: values.boldRestoreWeight,
    textAlign: values.textAlign, lineHeight: values.lineHeight, charSpacing: values.charSpacing,
    stroke: strokeEnabled ? values.stroke : null, strokeWidth: strokeEnabled ? values.strokeWidth : 0,
    paintFirst: "stroke", splitByGrapheme: true,
    shadow: shadowEnabled
      ? new Shadow({ color: values.shadowColor, blur: values.shadowBlur, offsetX: values.shadowOffsetX, offsetY: values.shadowOffsetY }) : null,
  });
  text.initDimensions(); text.setCoords();
}

export const DEFAULT_TEXT: TextProperties = {
  fontFamily: FONT_FAMILY, fontSize: 40, fill: "#2574d8", fontWeight: "400", fontStyle: "normal",
  underline: false, linethrough: false,
  opacity: 100,
  textAlign: "left", lineHeight: 1.16, charSpacing: 0,
  background: false, backgroundColor: "#ffffff", backgroundPadding: 10, backgroundRadius: 0,
  stroke: "#ffffff", strokeWidth: 2, strokeEnabled: false, shadowEnabled: false,
  shadowColor: "#000000", shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 2,
};
