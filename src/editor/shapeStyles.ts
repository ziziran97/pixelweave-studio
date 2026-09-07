import type { ShapeLineStyle } from "../types";

export const SHAPE_LINE_STYLES: { id: ShapeLineStyle; label: string }[] = [
  { id: "solid", label: "实线" },
  { id: "dashed", label: "虚线" },
  { id: "dense-dashed", label: "密虚线" },
  { id: "dotted", label: "圆点线" },
  { id: "dash-dot", label: "点划线" },
];

// Shared by the menu preview and actual shapes. Spacing scales with stroke width;
// round caps make zero-length dash segments into circles, with room between caps.
export function shapeLinePattern(style: ShapeLineStyle, width: number) {
  const cap: CanvasLineCap = style === "dotted" || style === "dash-dot" ? "round" : "butt";
  const units = style === "dashed" ? [4, 3] : style === "dense-dashed" ? [2, 1.5]
    : style === "dotted" ? [0, 2.5] : style === "dash-dot" ? [4, 2, 0, 2] : undefined;
  return { dash: units?.map(value => value * width) ?? null, cap };
}
