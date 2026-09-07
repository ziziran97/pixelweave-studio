import { Ellipse, Rect } from "fabric";
import type { ShapeProperties } from "../types";
import { shapeLinePattern } from "./shapeStyles";

export const DEFAULT_SHAPE: ShapeProperties = { filled: true, color: "#2574d8", lineWidth: 2, lineStyle: "solid", radius: 0, opacity: 100 };
export function rectRadiusLimit(shape: Rect) {
  const scale = shape.getObjectScaling();
  return Math.max(0, Math.floor(Math.min(shape.width * scale.x, shape.height * scale.y) / 2));
}
/** Radius is measured in image pixels, including while a selection is being scaled. */
export function syncRectRadius(shape: Rect, finish = false) {
  const scale = shape.getObjectScaling();
  const radius = Math.min(Math.max(0, shape.editorRadius ?? 0), rectRadiusLimit(shape));
  shape.set({ rx: scale.x ? radius / scale.x : 0, ry: scale.y ? radius / scale.y : 0 });
  // Keep the requested radius through a gesture, so shrinking and growing back is reversible.
  if (finish) shape.set("editorRadius", radius);
}
export function shapeProperties(shape: Rect | Ellipse): ShapeProperties {
  return { filled: shape.editorFilled ?? true, color: shape.editorColor ?? "#2574d8",
    lineWidth: shape.editorLineWidth ?? 2, lineStyle: shape.editorLineStyle ?? "solid",
    radius: shape instanceof Rect ? Math.min(shape.editorRadius ?? 0, rectRadiusLimit(shape)) : shape.editorRadius ?? 0,
    opacity: Math.round((shape.opacity ?? 1) * 100) };
}
export function applyShapeProperties(shape: Rect | Ellipse, values: ShapeProperties) {
  const pattern = shapeLinePattern(values.lineStyle, values.lineWidth);
  shape.set({ editorFilled: values.filled, editorColor: values.color, editorLineWidth: values.lineWidth,
    editorLineStyle: values.lineStyle, editorRadius: values.radius,
    fill: values.filled ? values.color : null, stroke: values.filled ? null : values.color,
    strokeWidth: values.filled ? 0 : values.lineWidth, strokeUniform: true,
    strokeDashArray: !values.filled ? pattern.dash : null, strokeLineCap: pattern.cap,
    opacity: values.opacity / 100,
  });
  if (shape instanceof Rect) syncRectRadius(shape);
  shape.setCoords();
}
