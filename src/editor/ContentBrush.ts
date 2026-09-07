import { PencilBrush } from "fabric";
import type { Point, TEvent } from "fabric";

export class ContentBrush extends PencilBrush {
  onMouseMove(pointer: Point, options: TEvent) {
    if (!this._points.length) return;
    // Preserve the last freehand point as the anchor on entering Shift mode.
    if (options.e.shiftKey && !this.drawStraightLine && this._points.length) {
      this._points.push(this._points[this._points.length - 1].clone());
    }
    super.onMouseMove(pointer, options);
  }
  onMouseUp(options: TEvent) {
    if (!this._points.length) return false;
    if (this.canvas._isMainEvent(options.e)) this.onMouseMove(this.canvas.getScenePoint(options.e), options);
    return super.onMouseUp(options);
  }
}
