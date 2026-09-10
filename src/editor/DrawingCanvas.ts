import { Canvas, Ellipse, FabricImage, Rect, Textbox } from "fabric";
import type { FabricObject, Point } from "fabric";

/** Keep empty shape interiors out of pointer targeting, without changing their controls. */
export class DrawingCanvas extends Canvas {
  beforeAdjustments = false;

  override _renderObjects(ctx: CanvasRenderingContext2D, objects: FabricObject[]) {
    if (!this.beforeAdjustments) { super._renderObjects(ctx, objects); return; }
    // A view-only base substitution. Serialized filters, objects and exports remain intact.
    for (const object of objects) {
      if (object instanceof FabricImage && object.editorPurpose === "base") {
        ctx.save(); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, object.width, object.height);
        ctx.drawImage(object._originalElement, 0, 0, object.width, object.height); ctx.restore();
      } else object.render(ctx);
    }
  }

  override _checkTarget(object: FabricObject, pointer: Point): boolean {
    if (object instanceof Textbox && object.opacity === 0) return false;
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
