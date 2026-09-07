import { Canvas, Ellipse, Rect } from "fabric";
import type { FabricObject, Point } from "fabric";

/** Keep empty shape interiors out of pointer targeting, without changing their controls. */
export class DrawingCanvas extends Canvas {
  override _checkTarget(object: FabricObject, pointer: Point): boolean {
    if (!(object instanceof Rect || object instanceof Ellipse)) return super._checkTarget(object, pointer);
    if (!object.visible || !object.evented || object.opacity === 0) return false;
    if (object.editorFilled !== false) return super._checkTarget(object, pointer);

    // A small screen-space margin makes thin outlines easy to pick at any zoom.
    // Use a cheap bounds check before Fabric renders the real rounded/dashed outline.
    const bounds = object.getBoundingRect(), margin = this.targetFindTolerance / this.getZoom();
    if (pointer.x < bounds.left - margin || pointer.x > bounds.left + bounds.width + margin ||
      pointer.y < bounds.top - margin || pointer.y > bounds.top + bounds.height + margin) return false;
    const viewport = pointer.transform(this.viewportTransform);
    return !this.isTargetTransparent(object, viewport.x, viewport.y);
  }
}
