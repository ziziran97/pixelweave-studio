import { Textbox, controlsUtils } from "fabric";
import type { Transform, TransformActionHandler } from "fabric";

const starts = new WeakMap<Transform, { size: number; width: number; spacing: number; distance: number; signX: number; signY: number }>();

const resizeText: TransformActionHandler = (_event, transform, x, y) => {
  const text = transform.target;
  if (!(text instanceof Textbox) || text.isEditing || text.editorLocked || text.lockScalingX || text.lockScalingY) return false;
  let start = starts.get(transform);
  if (!start) {
    const point = controlsUtils.getLocalPoint(transform, transform.originX, transform.originY, transform.ex, transform.ey);
    start = { size: text.fontSize, width: text.width, spacing: text.charSpacing * text.fontSize / 1000,
      distance: Math.abs(point.x) + Math.abs(point.y), signX: Math.sign(point.x), signY: Math.sign(point.y) };
    starts.set(transform, start);
  }
  const point = controlsUtils.getLocalPoint(transform, transform.originX, transform.originY, x, y);
  // Crossing the opposite corner must not mirror the text or reverse the drag.
  if (!start.distance || point.x * start.signX < 0 || point.y * start.signY < 0) return false;
  const fontSize = Math.max(8, Math.min(500, Math.round(start.size * (Math.abs(point.x) + Math.abs(point.y)) / start.distance * 100) / 100));
  if (text.fontSize === fontSize) return false;
  text.set({ fontSize, width: start.width * fontSize / start.size, charSpacing: start.spacing / fontSize * 1000 });
  text.initDimensions(); text.setCoords();
  return true;
};

/** Change the real type size, retaining editable wrapping and a stationary opposite corner. */
export const scaleTextFromCorner = controlsUtils.wrapWithFireEvent("scaling", controlsUtils.wrapWithFixedAnchor(resizeText));
