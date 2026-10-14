import type { Segment } from '../model/schema';

/**
 * Path model (plan.md T1.1): pieces, bounding box, length and point-at for
 * vector segment lists (move / line / quad / cubic / close).
 *
 * A segment list is one or more subpaths, each starting with `move`. `close`
 * draws a line back to the subpath start. When a vector is `closed`, every
 * subpath without an explicit `close` is closed too. All values are mm.
 */

export type Vec2 = readonly [number, number];

export type Piece =
  | { kind: 'line'; p0: Vec2; p1: Vec2 }
  | { kind: 'quad'; p0: Vec2; c: Vec2; p1: Vec2 }
  | { kind: 'cubic'; p0: Vec2; c1: Vec2; c2: Vec2; p1: Vec2 };

export interface Subpath {
  start: Vec2;
  pieces: Piece[];
  closed: boolean;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PathPoint {
  point: Vec2;
  /** Unit tangent in the direction of travel ([0, 0] on a zero-length path). */
  tangent: Vec2;
}

const EMPTY_BBOX: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

/** Splits a segment list into subpaths of drawable pieces. */
export function subpaths(segments: readonly Segment[], closed = false): Subpath[] {
  const out: Subpath[] = [];
  let current: Subpath | undefined;
  let pen: Vec2 = [0, 0];

  const finish = () => {
    if (!current) return;
    if (closed && !current.closed) closeCurrent(current);
    out.push(current);
    current = undefined;
  };
  const closeCurrent = (sp: Subpath) => {
    if (!same(pen, sp.start)) sp.pieces.push({ kind: 'line', p0: pen, p1: sp.start });
    sp.closed = true;
    pen = sp.start;
  };

  segments.forEach((seg, i) => {
    if (seg.type === 'move') {
      finish();
      pen = seg.p;
      current = { start: seg.p, pieces: [], closed: false };
      return;
    }
    if (!current || current.closed) {
      if (current?.closed && seg.type !== 'close') {
        // Drawing after close continues a new subpath from the start point (SVG rule).
        const start = current.start;
        finish();
        current = { start, pieces: [], closed: false };
        pen = start;
      } else if (!current) {
        throw new RangeError(`Segment ${i} (${seg.type}) comes before any "move"`);
      }
    }
    const sp = current as Subpath;
    switch (seg.type) {
      case 'line':
        sp.pieces.push({ kind: 'line', p0: pen, p1: seg.p });
        break;
      case 'quad':
        sp.pieces.push({ kind: 'quad', p0: pen, c: seg.c, p1: seg.p });
        break;
      case 'cubic':
        sp.pieces.push({ kind: 'cubic', p0: pen, c1: seg.c1, c2: seg.c2, p1: seg.p });
        break;
      case 'close':
        if (!sp.closed) closeCurrent(sp);
        return;
    }
    pen = seg.p;
  });
  finish();
  return out;
}

/** All drawable pieces of a segment list, in order. */
export function pieces(segments: readonly Segment[], closed = false): Piece[] {
  return subpaths(segments, closed).flatMap((s) => s.pieces);
}

/** Point on a piece at parameter t ∈ [0, 1]. */
export function evalPiece(piece: Piece, t: number): Vec2 {
  const u = 1 - t;
  switch (piece.kind) {
    case 'line':
      return [u * piece.p0[0] + t * piece.p1[0], u * piece.p0[1] + t * piece.p1[1]];
    case 'quad': {
      const a = u * u;
      const b = 2 * u * t;
      const c = t * t;
      return [
        a * piece.p0[0] + b * piece.c[0] + c * piece.p1[0],
        a * piece.p0[1] + b * piece.c[1] + c * piece.p1[1],
      ];
    }
    case 'cubic': {
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      return [
        a * piece.p0[0] + b * piece.c1[0] + c * piece.c2[0] + d * piece.p1[0],
        a * piece.p0[1] + b * piece.c1[1] + c * piece.c2[1] + d * piece.p1[1],
      ];
    }
  }
}

/** First derivative dB/dt of a piece at t. */
export function derivPiece(piece: Piece, t: number): Vec2 {
  const u = 1 - t;
  switch (piece.kind) {
    case 'line':
      return [piece.p1[0] - piece.p0[0], piece.p1[1] - piece.p0[1]];
    case 'quad':
      return [
        2 * u * (piece.c[0] - piece.p0[0]) + 2 * t * (piece.p1[0] - piece.c[0]),
        2 * u * (piece.c[1] - piece.p0[1]) + 2 * t * (piece.p1[1] - piece.c[1]),
      ];
    case 'cubic':
      return [
        3 * u * u * (piece.c1[0] - piece.p0[0]) +
          6 * u * t * (piece.c2[0] - piece.c1[0]) +
          3 * t * t * (piece.p1[0] - piece.c2[0]),
        3 * u * u * (piece.c1[1] - piece.p0[1]) +
          6 * u * t * (piece.c2[1] - piece.c1[1]) +
          3 * t * t * (piece.p1[1] - piece.c2[1]),
      ];
  }
}

/** Parameters in (0, 1) where one axis of the derivative is zero (curve extrema). */
function extremaParams(piece: Piece, axis: 0 | 1): number[] {
  if (piece.kind === 'line') return [];
  if (piece.kind === 'quad') {
    const denom = piece.p0[axis] - 2 * piece.c[axis] + piece.p1[axis];
    if (denom === 0) return [];
    const t = (piece.p0[axis] - piece.c[axis]) / denom;
    return t > 0 && t < 1 ? [t] : [];
  }
  // Derivative of a cubic / 3 = a t² + b t + c.
  const p0 = piece.p0[axis];
  const p1 = piece.c1[axis];
  const p2 = piece.c2[axis];
  const p3 = piece.p1[axis];
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (b !== 0) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

function growBBox(box: BBox, p: Vec2): BBox {
  return {
    minX: Math.min(box.minX, p[0]),
    minY: Math.min(box.minY, p[1]),
    maxX: Math.max(box.maxX, p[0]),
    maxY: Math.max(box.maxY, p[1]),
  };
}

/** Exact bounding box of one piece (curve extrema, not control points). */
export function pieceBBox(piece: Piece): BBox {
  let box = growBBox(growBBox(EMPTY_BBOX, piece.p0), piece.p1);
  for (const axis of [0, 1] as const) {
    for (const t of extremaParams(piece, axis)) box = growBBox(box, evalPiece(piece, t));
  }
  return box;
}

/** Union of two boxes. */
export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Exact bounding box of a path, or undefined for an empty one. A lone `move`
 * contributes its point.
 */
export function bbox(segments: readonly Segment[]): BBox | undefined {
  let box = EMPTY_BBOX;
  for (const sp of subpaths(segments)) {
    box = growBBox(box, sp.start);
    for (const p of sp.pieces) box = unionBBox(box, pieceBBox(p));
  }
  return box.minX === Infinity ? undefined : box;
}

// 5-point Gauss–Legendre nodes and weights on [-1, 1].
const GL_X = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GL_W = [
  0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891,
  0.2369268850561891,
];

function speed(piece: Piece, t: number): number {
  const d = derivPiece(piece, t);
  return Math.hypot(d[0], d[1]);
}

function gauss(piece: Piece, t0: number, t1: number): number {
  const half = (t1 - t0) / 2;
  const mid = (t0 + t1) / 2;
  let sum = 0;
  for (let i = 0; i < 5; i++)
    sum += (GL_W[i] as number) * speed(piece, mid + half * (GL_X[i] as number));
  return sum * half;
}

function adaptive(piece: Piece, t0: number, t1: number, whole: number, depth: number): number {
  const mid = (t0 + t1) / 2;
  const left = gauss(piece, t0, mid);
  const right = gauss(piece, mid, t1);
  if (depth >= 18 || Math.abs(left + right - whole) <= 1e-10 * Math.max(1, whole)) {
    return left + right;
  }
  return adaptive(piece, t0, mid, left, depth + 1) + adaptive(piece, mid, t1, right, depth + 1);
}

/** Arc length of a piece between parameters t0 and t1 (default: whole piece). */
export function pieceLength(piece: Piece, t0 = 0, t1 = 1): number {
  if (t1 <= t0) return 0;
  if (piece.kind === 'line') return (t1 - t0) * speed(piece, 0);
  return adaptive(piece, t0, t1, gauss(piece, t0, t1), 0);
}

/** Total length of a path (mm). */
export function length(segments: readonly Segment[], closed = false): number {
  return pieces(segments, closed).reduce((sum, p) => sum + pieceLength(p), 0);
}

/** Parameter t on a piece where the arc length from 0 equals `distance`. */
export function paramAtLength(piece: Piece, distance: number, total = pieceLength(piece)): number {
  if (distance <= 0 || total === 0) return 0;
  if (distance >= total) return 1;
  if (piece.kind === 'line') return distance / total;
  let lo = 0;
  let hi = 1;
  let t = distance / total;
  for (let i = 0; i < 60; i++) {
    const err = pieceLength(piece, 0, t) - distance;
    if (Math.abs(err) < 1e-9) break;
    if (err > 0) hi = t;
    else lo = t;
    const v = speed(piece, t);
    const newton = v > 0 ? t - err / v : NaN;
    t = newton > lo && newton < hi ? newton : (lo + hi) / 2;
  }
  return t;
}

function unit(d: Vec2): Vec2 {
  const len = Math.hypot(d[0], d[1]);
  return len === 0 ? [0, 0] : [d[0] / len, d[1] / len];
}

/** Tangent of a piece at t, falling back to the chord where a control point coincides. */
function tangentOf(piece: Piece, t: number): Vec2 {
  const d = unit(derivPiece(piece, t));
  if (d[0] !== 0 || d[1] !== 0) return d;
  const eps = t < 0.5 ? 1e-6 : -1e-6;
  const a = evalPiece(piece, t);
  const b = evalPiece(piece, t + eps);
  return unit(eps > 0 ? [b[0] - a[0], b[1] - a[1]] : [a[0] - b[0], a[1] - b[1]]);
}

/**
 * Point and tangent at `distance` mm along the path (clamped to its ends).
 * Returns undefined when the path has no drawable pieces.
 */
export function pointAt(
  segments: readonly Segment[],
  distance: number,
  closed = false,
): PathPoint | undefined {
  const list = pieces(segments, closed);
  if (list.length === 0) return undefined;
  let remaining = Math.max(0, distance);
  for (let i = 0; i < list.length; i++) {
    const piece = list[i] as Piece;
    const len = pieceLength(piece);
    if (remaining <= len || i === list.length - 1) {
      const t = paramAtLength(piece, remaining, len);
      return { point: evalPiece(piece, t), tangent: tangentOf(piece, t) };
    }
    remaining -= len;
  }
  return undefined;
}

/** 2D affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (SVG order). */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 · m2: applies m2 first, then m1. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export const translation = (dx: number, dy: number): Matrix => [1, 0, 0, 1, dx, dy];

export const scaling = (sx: number, sy = sx, cx = 0, cy = 0): Matrix => [
  sx,
  0,
  0,
  sy,
  cx - sx * cx,
  cy - sy * cy,
];

/** Counter-clockwise rotation by `radians` about (cx, cy). */
export function rotation(radians: number, cx = 0, cy = 0): Matrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) throw new RangeError('Matrix is not invertible');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyMatrix(m: Matrix, p: Vec2): [number, number] {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** Applies an affine transform to every point of a segment list (Béziers stay exact). */
export function transformSegments(segments: readonly Segment[], m: Matrix): Segment[] {
  const t = (p: Vec2) => applyMatrix(m, p);
  return segments.map((s): Segment => {
    switch (s.type) {
      case 'move':
      case 'line':
        return { type: s.type, p: t(s.p) };
      case 'quad':
        return { type: 'quad', c: t(s.c), p: t(s.p) };
      case 'cubic':
        return { type: 'cubic', c1: t(s.c1), c2: t(s.c2), p: t(s.p) };
      case 'close':
        return { type: 'close' };
    }
  });
}
