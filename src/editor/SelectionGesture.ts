import type { DocumentSize, EraseMode, MaskStroke, PointData } from "../types";
import { polygonHasArea } from "./mask";

/** One unfinished selection. Document history and pointer ownership stay with the editor. */
export class SelectionGesture {
  mode: EraseMode = "brush";
  draft?: MaskStroke;
  hover?: PointData;
  closing = false;
  private lastPointer?: PointData;
  private moveAnchor?: PointData;
  private resizeOffset = { x: 0, y: 0 };
  private outsidePoint?: PointData;

  cancel() {
    this.draft = undefined; this.hover = undefined; this.closing = false;
    this.lastPointer = undefined; this.moveAnchor = undefined;
    this.resizeOffset = { x: 0, y: 0 }; this.outsidePoint = undefined;
  }

  begin(point: PointData, operation: MaskStroke["operation"], width: number, zoom: number) {
    this.lastPointer = point;
    if (this.mode === "lasso" && this.draft) {
      if (this.nearStart(point, zoom)) return true;
      const last = this.draft.points[this.draft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) >= 2 / zoom) this.draft.points.push(point);
    } else {
      this.draft = { kind: this.mode === "brush" ? "brush" : this.mode === "rect" ? "rect" : "polygon",
        operation, points: [point], width: this.mode === "brush" ? width : 0 };
      this.resizeOffset = { x: 0, y: 0 }; this.outsidePoint = undefined;
    }
    this.hover = point; this.closing = false;
    return false;
  }

  private nearStart(point: PointData, zoom: number) {
    const points = this.draft?.points;
    return !!points && points.length >= 3 && Math.hypot(point.x - points[0].x, point.y - points[0].y) <= this.closingRadius(zoom);
  }

  closingRadius(zoom: number) {
    const points = this.draft?.points;
    if (!points || points.length < 2) return 7 / zoom;
    const first = points[0];
    let left = first.x, right = first.x, top = first.y, bottom = first.y, nearest = Infinity;
    for (const point of points.slice(1)) {
      left = Math.min(left, point.x); right = Math.max(right, point.x);
      top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
      nearest = Math.min(nearest, Math.hypot(point.x - first.x, point.y - first.y));
    }
    // Keep the hit area clear of nearby vertices and narrow selection edges.
    return Math.min(12 / zoom, nearest / 2, Math.min(right - left, bottom - top) / 3);
  }

  move(raw: PointData, size: DocumentSize, zoom: number, final = false) {
    this.lastPointer = raw;
    const stroke = this.draft;
    if (!stroke) return;
    const inside = raw.x >= 0 && raw.y >= 0 && raw.x <= size.width && raw.y <= size.height;
    const point = { x: Math.max(0, Math.min(size.width, raw.x)), y: Math.max(0, Math.min(size.height, raw.y)) };
    if (this.mode === "lasso") {
      this.hover = inside ? point : undefined; this.closing = inside && this.nearStart(point, zoom);
    } else if (stroke.kind === "rect") {
      if (this.moveAnchor) {
        const [first, end = first] = stroke.points;
        const dx = Math.max(-Math.min(first.x, end.x), Math.min(size.width - Math.max(first.x, end.x), raw.x - this.moveAnchor.x));
        const dy = Math.max(-Math.min(first.y, end.y), Math.min(size.height - Math.max(first.y, end.y), raw.y - this.moveAnchor.y));
        stroke.points = [first, end].map(p => ({ x: p.x + dx, y: p.y + dy }));
        this.moveAnchor = raw;
      } else stroke.points[1] = {
        x: Math.max(0, Math.min(size.width, raw.x + this.resizeOffset.x)),
        y: Math.max(0, Math.min(size.height, raw.y + this.resizeOffset.y)),
      };
    } else {
      // A closed polygon must retain outside vertices too: clamping each vertex
      // would bend its edges. Preview, coverage and export clip the same path.
      if (this.mode === "freehand") { this.append(raw, final ? 0 : 1.5 / zoom); return; }
      const last = stroke.points[stroke.points.length - 1];
      if (stroke.kind === "brush" && !inside) {
        if (!this.outsidePoint) this.append(edge(last, raw, size));
        this.outsidePoint = raw;
      } else if (stroke.kind === "brush" && this.outsidePoint) {
        (stroke.breaks ??= []).push(stroke.points.length);
        stroke.points.push(edge(point, this.outsidePoint, size)); this.append(point);
        this.outsidePoint = undefined;
      } else this.append(point, final ? 0 : 1.5 / zoom);
    }
  }

  private append(point: PointData, minimum = 0) {
    const points = this.draft!.points, last = points[points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) > minimum) points.push(point);
  }

  startMove() { if (this.draft?.kind === "rect") this.moveAnchor = this.lastPointer; }
  endMove() {
    if (this.moveAnchor && this.draft?.kind === "rect" && this.lastPointer) {
      const end = this.draft.points[this.draft.points.length - 1];
      this.resizeOffset = { x: end.x - this.lastPointer.x, y: end.y - this.lastPointer.y };
    }
    this.moveAnchor = undefined;
  }
  undoPoint() {
    this.draft?.points.pop(); this.closing = false;
    if (!this.draft?.points.length) this.cancel();
    else this.hover = this.draft.points[this.draft.points.length - 1];
  }
  valid(zoom: number, size: DocumentSize) {
    const stroke = this.draft;
    if (!stroke) return false;
    if (stroke.kind === "brush") return stroke.points.length > 0;
    if (stroke.kind === "rect") {
      const first = stroke.points[0], last = stroke.points[stroke.points.length - 1];
      return !!first && !!last && Math.abs(last.x - first.x) * zoom >= 3 && Math.abs(last.y - first.y) * zoom >= 3;
    }
    return polygonHasArea(stroke, zoom, size);
  }
  take() { const stroke = this.draft; this.cancel(); return stroke; }
}

function edge(inside: PointData, outside: PointData, size: DocumentSize): PointData {
  const dx = outside.x - inside.x, dy = outside.y - inside.y;
  const tx = dx > 0 ? (size.width - inside.x) / dx : dx < 0 ? -inside.x / dx : Infinity;
  const ty = dy > 0 ? (size.height - inside.y) / dy : dy < 0 ? -inside.y / dy : Infinity;
  const t = Math.max(0, Math.min(1, tx, ty));
  return { x: inside.x + dx * t, y: inside.y + dy * t };
}
