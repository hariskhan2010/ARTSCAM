import {
  applyMatrix,
  bbox,
  distToSegment,
  flatten,
  multiply,
  rotation,
  scaling,
  translation,
  unionBBox,
  type BBox,
  type Matrix,
  type Segment,
  type Vec2,
  type Vector,
} from '@naqsh/core';

/**
 * Pure editor geometry: view transform (mm ↔ screen px, Y flipped), snapping,
 * hit testing and selection-handle transforms. No DOM here so it is unit
 * tested in Node.
 */

export interface View {
  /** Screen pixels per mm. */
  scale: number;
  /** Screen position (px) of world origin. */
  originX: number;
  originY: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 400;

export function worldToScreen(v: View, p: Vec2): [number, number] {
  return [v.originX + p[0] * v.scale, v.originY - p[1] * v.scale];
}

export function screenToWorld(v: View, s: Vec2): [number, number] {
  return [(s[0] - v.originX) / v.scale, (v.originY - s[1]) / v.scale];
}

/** View matrix for Canvas2D `setTransform` (world mm → screen px). */
export function viewMatrix(v: View): Matrix {
  return [v.scale, 0, 0, -v.scale, v.originX, v.originY];
}

/** Zooms by `factor` keeping the world point under screen point `at` fixed. */
export function zoomAt(v: View, at: Vec2, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const w = screenToWorld(v, at);
  return { scale, originX: at[0] - w[0] * scale, originY: at[1] + w[1] * scale };
}

/** View that fits a world box into a screen of the given size with a margin (px). */
export function fitView(box: BBox, width: number, height: number, margin = 40, top = margin): View {
  const w = Math.max(box.maxX - box.minX, 1e-3);
  const h = Math.max(box.maxY - box.minY, 1e-3);
  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min((width - 2 * margin) / w, (height - margin - top) / h)),
  );
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  // Centre in the area below the top margin.
  const midY = top + (height - margin - top) / 2;
  return { scale, originX: width / 2 - cx * scale, originY: midY + cy * scale };
}

/** A "nice" grid step (1, 2, 5 × 10ⁿ mm) so lines are at least `minPx` apart. */
export function gridStep(scale: number, minPx = 12): number {
  const raw = minPx / scale;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

// --- Snapping ---------------------------------------------------------------

export interface SnapOptions {
  grid: boolean;
  gridSize: number;
  /** Points (nodes, centres) to snap to. */
  points: readonly Vec2[];
  /** Snap radius in mm. */
  radius: number;
}

export interface Snapped {
  point: [number, number];
  kind: 'none' | 'grid' | 'point';
}

/**
 * Snaps to the nearest candidate point within radius. Otherwise, with grid
 * snapping on, each axis locks to a grid line only when it is within the
 * radius of one, and is else rounded to a tenth of the grid step: values stay
 * tidy without the cursor jumping a whole grid cell.
 */
export function snap(p: Vec2, o: SnapOptions): Snapped {
  let best: Vec2 | undefined;
  let bestD = o.radius;
  for (const q of o.points) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d <= bestD) {
      bestD = d;
      best = q;
    }
  }
  if (best) return { point: [best[0], best[1]], kind: 'point' };
  if (o.grid && o.gridSize > 0) {
    const g = o.gridSize;
    const fine = g / 10;
    let locked = false;
    const axis = (v: number) => {
      const line = Math.round(v / g) * g;
      if (Math.abs(line - v) <= o.radius) {
        locked = true;
        return line;
      }
      // Round on the decimal representation so 0.1-steps stay exact (e.g. 12.3, not 12.300000001).
      return Number((Math.round(v / fine) * fine).toFixed(10));
    };
    const point: [number, number] = [axis(p[0]), axis(p[1])];
    return { point, kind: locked ? 'grid' : 'none' };
  }
  return { point: [p[0], p[1]], kind: 'none' };
}

/** Anchor points of segment lists (for snapping). */
export function anchorPoints(vectors: readonly { segments: readonly Segment[] }[]): Vec2[] {
  const out: Vec2[] = [];
  for (const v of vectors) for (const s of v.segments) if (s.type !== 'close') out.push(s.p);
  return out;
}

// --- Hit testing ------------------------------------------------------------

function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when p is within `tol` mm of the vector's outline, or inside it if closed. */
export function hitVector(v: Pick<Vector, 'segments' | 'closed'>, p: Vec2, tol: number): boolean {
  const polys = flatten(v.segments, Math.max(tol / 4, 1e-4), v.closed);
  let insideCount = 0;
  for (const poly of polys) {
    const pts = poly.points;
    const n = poly.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      if (distToSegment(p, pts[i] as Vec2, pts[(i + 1) % pts.length] as Vec2) <= tol) return true;
    }
    if (poly.closed && pointInRing(p, pts)) insideCount++;
  }
  return insideCount % 2 === 1;
}

/** Topmost vector hit at p (last drawn wins). */
export function pickVector<V extends Pick<Vector, 'segments' | 'closed'>>(
  vectors: readonly V[],
  p: Vec2,
  tol: number,
): V | undefined {
  for (let i = vectors.length - 1; i >= 0; i--) {
    const v = vectors[i] as V;
    if (hitVector(v, p, tol)) return v;
  }
  return undefined;
}

/** Vectors whose bounding box lies fully inside the marquee box. */
export function marqueeSelect<V extends Pick<Vector, 'id' | 'segments'>>(
  vectors: readonly V[],
  box: BBox,
): string[] {
  return vectors
    .filter((v) => {
      const b = bbox(v.segments);
      return (
        !!b && b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY
      );
    })
    .map((v) => v.id);
}

export function selectionBBox(vectors: readonly Pick<Vector, 'segments'>[]): BBox | undefined {
  let out: BBox | undefined;
  for (const v of vectors) {
    const b = bbox(v.segments);
    if (b) out = out ? unionBBox(out, b) : b;
  }
  return out;
}

export function boxFrom(a: Vec2, b: Vec2): BBox {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
  };
}

// --- Selection handles ------------------------------------------------------

/** Scale handles by compass name; `rotate` sits above the top edge. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'rotate';

/** World position of each handle for a selection box (rotate offset in mm). */
export function handlePositions(b: BBox, rotateOffset: number): Record<Handle, [number, number]> {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return {
    nw: [b.minX, b.maxY],
    n: [cx, b.maxY],
    ne: [b.maxX, b.maxY],
    e: [b.maxX, cy],
    se: [b.maxX, b.minY],
    s: [cx, b.minY],
    sw: [b.minX, b.minY],
    w: [b.minX, cy],
    rotate: [cx, b.maxY + rotateOffset],
  };
}

export function pickHandle(
  b: BBox,
  p: Vec2,
  tol: number,
  rotateOffset: number,
): Handle | undefined {
  const hs = handlePositions(b, rotateOffset);
  let best: Handle | undefined;
  let bestD = tol;
  for (const [name, q] of Object.entries(hs) as [Handle, [number, number]][]) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d <= bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/**
 * Matrix for dragging a handle from `start` to `now` (world mm). Scale handles
 * scale about the opposite edge/corner (`uniform` keeps the aspect ratio);
 * the rotate handle rotates about the centre, snapping to 15° when `snapAngle`.
 */
export function handleTransform(
  b: BBox,
  handle: Handle,
  start: Vec2,
  now: Vec2,
  opts: { uniform?: boolean; snapAngle?: boolean } = {},
): Matrix {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  if (handle === 'rotate') {
    let a = Math.atan2(now[1] - cy, now[0] - cx) - Math.atan2(start[1] - cy, start[0] - cx);
    if (opts.snapAngle) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    return rotation(a, cx, cy);
  }
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const ax = handle.includes('w') ? b.maxX : handle.includes('e') ? b.minX : cx;
  const ay = handle.includes('s') ? b.maxY : handle.includes('n') ? b.minY : cy;
  const dx = now[0] - start[0];
  const dy = now[1] - start[1];
  let sx = 1;
  let sy = 1;
  if (handle.includes('e') && w > 0) sx = (w + dx) / w;
  if (handle.includes('w') && w > 0) sx = (w - dx) / w;
  if (handle.includes('n') && h > 0) sy = (h + dy) / h;
  if (handle.includes('s') && h > 0) sy = (h - dy) / h;
  if (opts.uniform) {
    const corner = handle.length === 2;
    const s = corner
      ? Math.abs(sx - 1) > Math.abs(sy - 1)
        ? sx
        : sy
      : handle === 'n' || handle === 's'
        ? sy
        : sx;
    sx = s;
    sy = s;
  }
  // Avoid collapsing to zero (non-invertible) while dragging through the anchor.
  const guard = (s: number) => (Math.abs(s) < 1e-3 ? 1e-3 * Math.sign(s || 1) : s);
  return scaling(guard(sx), guard(sy), ax, ay);
}

export { applyMatrix, multiply, translation };
