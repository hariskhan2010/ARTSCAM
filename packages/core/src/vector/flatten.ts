import type { Segment } from '../model/schema';
import { subpaths, type Piece, type Vec2 } from './path';

/**
 * Curve flattening (plan.md T1.2): Béziers become polylines whose maximum
 * deviation from the true curve is at most `tolerance` mm.
 *
 * The bound is guaranteed, not estimated: a Bézier lies inside the convex hull
 * of its control points, so if every control point is within `tolerance` of
 * the chord, the whole curve is too. Pieces are split at t = ½ until that
 * holds.
 */

export interface Polyline {
  points: Vec2[];
  /** True when the last point connects back to the first. */
  closed: boolean;
}

export const DEFAULT_TOLERANCE = 0.01;
const MAX_DEPTH = 24;

/** Distance from p to the segment ab. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

function splitHalf(piece: Piece): [Piece, Piece] {
  if (piece.kind === 'line') {
    const m = lerp(piece.p0, piece.p1, 0.5);
    return [
      { kind: 'line', p0: piece.p0, p1: m },
      { kind: 'line', p0: m, p1: piece.p1 },
    ];
  }
  if (piece.kind === 'quad') {
    const a = lerp(piece.p0, piece.c, 0.5);
    const b = lerp(piece.c, piece.p1, 0.5);
    const m = lerp(a, b, 0.5);
    return [
      { kind: 'quad', p0: piece.p0, c: a, p1: m },
      { kind: 'quad', p0: m, c: b, p1: piece.p1 },
    ];
  }
  const ab = lerp(piece.p0, piece.c1, 0.5);
  const bc = lerp(piece.c1, piece.c2, 0.5);
  const cd = lerp(piece.c2, piece.p1, 0.5);
  const abc = lerp(ab, bc, 0.5);
  const bcd = lerp(bc, cd, 0.5);
  const m = lerp(abc, bcd, 0.5);
  return [
    { kind: 'cubic', p0: piece.p0, c1: ab, c2: abc, p1: m },
    { kind: 'cubic', p0: m, c1: bcd, c2: cd, p1: piece.p1 },
  ];
}

function flatEnough(piece: Piece, tolerance: number): boolean {
  switch (piece.kind) {
    case 'line':
      return true;
    case 'quad':
      return distToSegment(piece.c, piece.p0, piece.p1) <= tolerance;
    case 'cubic':
      return (
        distToSegment(piece.c1, piece.p0, piece.p1) <= tolerance &&
        distToSegment(piece.c2, piece.p0, piece.p1) <= tolerance
      );
  }
}

/** Appends the points of a flattened piece (excluding its start point) to `out`. */
export function flattenPiece(piece: Piece, tolerance: number, out: Vec2[], depth = 0): void {
  if (depth >= MAX_DEPTH || flatEnough(piece, tolerance)) {
    out.push(piece.p1);
    return;
  }
  const [a, b] = splitHalf(piece);
  flattenPiece(a, tolerance, out, depth + 1);
  flattenPiece(b, tolerance, out, depth + 1);
}

/**
 * Flattens a segment list into polylines (one per subpath). A closed polyline
 * does not repeat its first point at the end.
 */
export function flatten(
  segments: readonly Segment[],
  tolerance = DEFAULT_TOLERANCE,
  closed = false,
): Polyline[] {
  if (!(tolerance > 0)) throw new RangeError(`tolerance must be > 0, got ${tolerance}`);
  return subpaths(segments, closed).map((sp) => {
    const points: Vec2[] = [sp.start];
    for (const p of sp.pieces) flattenPiece(p, tolerance, points);
    const last = points.at(-1) as Vec2;
    if (sp.closed && points.length > 1 && last[0] === sp.start[0] && last[1] === sp.start[1]) {
      points.pop();
    }
    return { points, closed: sp.closed };
  });
}

/** Signed area of a closed polyline: positive when counter-clockwise (Y up). */
export function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** Length of a polyline, including the closing edge when closed. */
export function polylineLength(points: readonly Vec2[], closed: boolean): number {
  let sum = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}
