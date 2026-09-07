import type { PointData } from "../types";

// Work in image coordinates, but keep the stagger distance stable on screen.
export function textPlacement(area: { left: number; top: number; right: number; bottom: number },
  size: { width: number; height: number }, occupied: PointData[], zoom: number): PointData {
  const center = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
  const roomX = Math.max(0, (area.right - area.left - size.width) / 2);
  const roomY = Math.max(0, (area.bottom - area.top - size.height) / 2);
  const step = 24 / zoom;
  const offsets: PointData[] = [];
  for (let n = 0; n <= 8; n++) offsets.push({ x: n, y: n });
  // When the lower-right direction reaches an edge, try the other nearby spaces.
  for (let radius = 1; radius <= 8; radius++) {
    for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) {
      if (Math.max(Math.abs(x), Math.abs(y)) === radius) offsets.push({ x, y });
    }
  }
  let best = center, bestDistance = -1;
  for (const offset of offsets) {
    const candidate = { x: center.x + Math.max(-roomX, Math.min(roomX, offset.x * step)),
      y: center.y + Math.max(-roomY, Math.min(roomY, offset.y * step)) };
    const distance = occupied.reduce((min, point) => Math.min(min, Math.hypot(candidate.x - point.x, candidate.y - point.y)), Infinity);
    if (distance >= step * .9) return candidate;
    if (distance > bestDistance) { bestDistance = distance; best = candidate; }
  }
  return best;
}
