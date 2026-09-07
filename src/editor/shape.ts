import { Ellipse, Rect } from "fabric";
import type { ShapeProperties } from "../types";

export const DEFAULT_SHAPE: ShapeProperties = { filled: true, color: "#2574d8", lineWidth: 2, lineStyle: "solid", radius: 0 };
export function shapeProperties(shape: Rect | Ellipse): ShapeProperties {
  return { filled: shape.editorFilled ?? true, color: shape.editorColor ?? "#2574d8",
    lineWidth: shape.editorLineWidth ?? 2, lineStyle: shape.editorLineStyle ?? "solid", radius: shape.editorRadius ?? 0 };
}
export function applyShapeProperties(shape: Rect | Ellipse, values: ShapeProperties) {
  shape.set({ editorFilled: values.filled, editorColor: values.color, editorLineWidth: values.lineWidth,
    editorLineStyle: values.lineStyle, editorRadius: values.radius,
    fill: values.filled ? values.color : null, stroke: values.filled ? null : values.color,
    strokeWidth: values.filled ? 0 : values.lineWidth, strokeUniform: true,
    strokeDashArray: !values.filled && values.lineStyle === "dashed" ? [values.lineWidth * 4, values.lineWidth * 3] : null,
  });
  if (shape instanceof Rect) shape.set({ rx: values.radius, ry: values.radius });
  shape.setCoords();
}
