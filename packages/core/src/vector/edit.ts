import type { Segment } from '../model/schema';
import {
  rotation,
  subpaths,
  translation,
  type BBox,
  type Matrix,
  type Piece,
  type Vec2,
} from './path';
import { arcToCubics } from './shapes';

/**
 * Vector editing tools (plan.md T6.7): arcs through three points, fillet and
 * chamfer corners, grid and circular arrays, align and distribute, joining
 * open paths and repairing messy ones. Pure functions on segment lists.
 */

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pt = (p: Vec2): [number, number] => [p[0], p[1]];

// --- Arc --------------------------------------------------------------------------

/**
 * Open arc from `a` to `b` passing through `m`. Collinear points give a
 * straight line from `a` to `b`.
 */
export function arcThrough(a: Vec2, m: Vec2, b: Vec2): Segment[] {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  const span = Math.max(dist(a, b), dist(a, m), dist(m, b));
  if (Math.abs(d) < 1e-9 * Math.max(1, span * span)) {
    return [
      { type: 'move', p: pt(a) },
      { type: 'line', p: pt(b) },
    ];
  }
  const sq = (p: Vec2) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(a) * (m[1] - b[1]) + sq(m) * (b[1] - a[1]) + sq(b) * (a[1] - m[1])) / d;
  const cy = (sq(a) * (b[0] - m[0]) + sq(m) * (a[0] - b[0]) + sq(b) * (m[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  const ang = (p: Vec2) => Math.atan2(p[1] - cy, p[0] - cx);
  const TAU = 2 * Math.PI;
  const ccw = (from: number, to: number) => (((to - from) % TAU) + TAU) % TAU;
  const a0 = ang(a);
  const toB = ccw(a0, ang(b));
  // Counter-clockwise when the middle point comes before b going that way.
  const sweep = ccw(a0, ang(m)) < toB ? toB : toB - TAU;
  const arcs = arcToCubics(cx, cy, r, r, 0, a0, sweep);
  const last = arcs.at(-1);
  if (last?.type === 'cubic') last.p = pt(b);
  return [{ type: 'move', p: pt(a) }, ...arcs];
}

// --- Fillet and chamfer ----------------------------------------------------------

function pieceToSegment(p: Piece): Segment {
  switch (p.kind) {
    case 'line':
      return { type: 'line', p: pt(p.p1) };
    case 'quad':
      return { type: 'quad', c: pt(p.c), p: pt(p.p1) };
    case 'cubic':
      return { type: 'cubic', c1: pt(p.c1), c2: pt(p.c2), p: pt(p.p1) };
  }
}

/**
 * Replaces every corner between two straight lines by `corner(p1, u, p2, v, t)`
 * segments, where the lines are cut back by `t` from the corner: p1 on the
 * incoming line (direction u), p2 on the outgoing one (direction v). `cutBack`
 * gives t for a corner turning by `turn` radians (before limiting it to half
 * of each line).
 */
function roundCorners(
  segments: readonly Segment[],
  closedVector: boolean,
  cutBack: (turn: number) => number,
  corner: (p1: Vec2, u: Vec2, p2: Vec2, v: Vec2, turn: number, t: number) => Segment[],
): Segment[] {
  const out: Segment[] = [];
  for (const sp of subpaths(segments, closedVector)) {
    const ps = sp.pieces.filter((p) => dist(p.p0, p.p1) > 1e-9 || p.kind !== 'line');
    const n = ps.length;
    if (n === 0) continue;
    const lens = ps.map((p) => (p.kind === 'line' ? dist(p.p0, p.p1) : 0));
    const dir = (p: Piece) => {
      const l = dist(p.p0, p.p1);
      return [(p.p1[0] - p.p0[0]) / l, (p.p1[1] - p.p0[1]) / l] as Vec2;
    };
    // Corner i sits at the end of piece i (and the start of piece i + 1).
    const cut = new Array<number>(n).fill(0);
    const turns = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = ps[i] as Piece;
      const b = ps[(i + 1) % n] as Piece;
      if (!sp.closed && i === n - 1) continue;
      if (a.kind !== 'line' || b.kind !== 'line') continue;
      const u = dir(a);
      const v = dir(b);
      const cos = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
      const turn = Math.acos(cos);
      if (turn < 1e-6 || turn > Math.PI - 1e-6) continue; // straight on, or a reversal
      // At most half of each line, so the neighbouring corner has room too.
      cut[i] = Math.min(cutBack(turn), (lens[i] as number) / 2, (lens[(i + 1) % n] as number) / 2);
      turns[i] = turn;
    }
    const startCut = sp.closed ? (cut[n - 1] as number) : 0;
    const first = ps[0] as Piece;
    const startAt =
      first.kind === 'line' && startCut > 0
        ? ([first.p0[0] + dir(first)[0] * startCut, first.p0[1] + dir(first)[1] * startCut] as Vec2)
        : first.p0;
    out.push({ type: 'move', p: pt(startAt) });
    for (let i = 0; i < n; i++) {
      const p = ps[i] as Piece;
      const c = cut[i] as number;
      if (p.kind === 'line') {
        const u = dir(p);
        out.push({ type: 'line', p: pt([p.p1[0] - u[0] * c, p.p1[1] - u[1] * c]) });
      } else out.push(pieceToSegment(p));
      if (c > 0) {
        const next = ps[(i + 1) % n] as Piece;
        const u = dir(p);
        const v = dir(next);
        const p1: Vec2 = [p.p1[0] - u[0] * c, p.p1[1] - u[1] * c];
        const p2: Vec2 = [next.p0[0] + v[0] * c, next.p0[1] + v[1] * c];
        out.push(...corner(p1, u, p2, v, turns[i] as number, c));
      }
    }
    if (sp.closed) out.push({ type: 'close' });
  }
  return out;
}

/** Rounds every line–line corner with radius `r` (limited where the lines are short). */
export function filletCorners(segments: readonly Segment[], r: number, closed = false): Segment[] {
  if (!(r > 0)) return [...segments];
  const result = roundCorners(
    segments,
    closed,
    (turn) => r * Math.tan(turn / 2),
    (p1, u, p2, v, turn, t) => {
      // The radius that fits the (possibly limited) cut-back.
      const rr = t / Math.tan(turn / 2);
      const k = (4 / 3) * Math.tan(turn / 4) * rr;
      return [
        {
          type: 'cubic',
          c1: pt([p1[0] + u[0] * k, p1[1] + u[1] * k]),
          c2: pt([p2[0] - v[0] * k, p2[1] - v[1] * k]),
          p: pt(p2),
        },
      ];
    },
  );
  return sameShape(result, segments) ? [...segments] : result;
}

/** Cuts every line–line corner straight, `d` back along each line. */
export function chamferCorners(segments: readonly Segment[], d: number, closed = false): Segment[] {
  if (!(d > 0)) return [...segments];
  const result = roundCorners(
    segments,
    closed,
    () => d,
    (_p1, _u, p2) => [{ type: 'line', p: pt(p2) }],
  );
  return sameShape(result, segments) ? [...segments] : result;
}

/** No corner changed: keep the caller's segments exactly. */
function sameShape(a: readonly Segment[], b: readonly Segment[]): boolean {
  const lines = (s: readonly Segment[]) => s.filter((x) => x.type !== 'close').length;
  return (
    lines(a) === lines(b) &&
    JSON.stringify(a.filter((x) => x.type !== 'close')) ===
      JSON.stringify(b.filter((x) => x.type !== 'close'))
  );
}

// --- Arrays ------------------------------------------------------------------------

/** Moves for a cols × rows grid of copies, row by row; the first is the original. */
export function gridArrayMatrices(cols: number, rows: number, dx: number, dy: number): Matrix[] {
  const out: Matrix[] = [];
  for (let r = 0; r < Math.max(1, Math.floor(rows)); r++)
    for (let c = 0; c < Math.max(1, Math.floor(cols)); c++) out.push(translation(c * dx, r * dy));
  return out;
}

/**
 * Turns for `count` copies around `centre` over `degrees` (counter-clockwise).
 * A full circle spaces them evenly; a part circle puts copies at both ends.
 */
export function circularArrayMatrices(count: number, centre: Vec2, degrees: number): Matrix[] {
  const n = Math.max(1, Math.floor(count));
  const full = Math.abs(Math.abs(degrees) - 360) < 1e-9;
  const step = ((full ? degrees / n : degrees / Math.max(1, n - 1)) * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => rotation(i * step, centre[0], centre[1]));
}

// --- Align and distribute ------------------------------------------------------------

export type AlignMode = 'left' | 'centerX' | 'right' | 'bottom' | 'middle' | 'top';

/** Offsets [dx, dy] that align each box to the selection's bounds. */
export function alignOffsets(boxes: readonly BBox[], mode: AlignMode): [number, number][] {
  const minX = Math.min(...boxes.map((b) => b.minX));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  return boxes.map((b): [number, number] => {
    switch (mode) {
      case 'left':
        return [minX - b.minX, 0];
      case 'right':
        return [maxX - b.maxX, 0];
      case 'centerX':
        return [(minX + maxX) / 2 - (b.minX + b.maxX) / 2, 0];
      case 'bottom':
        return [0, minY - b.minY];
      case 'top':
        return [0, maxY - b.maxY];
      case 'middle':
        return [0, (minY + maxY) / 2 - (b.minY + b.maxY) / 2];
    }
  });
}

/** Offsets that space boxes with equal gaps along an axis; the outermost two stay put. */
export function distributeOffsets(boxes: readonly BBox[], axis: 'x' | 'y'): [number, number][] {
  const lo = (b: BBox) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: BBox) => (axis === 'x' ? b.maxX : b.maxY);
  const order = boxes.map((_, i) => i).sort((i, j) => lo(boxes[i] as BBox) - lo(boxes[j] as BBox));
  const out = boxes.map((): [number, number] => [0, 0]);
  if (boxes.length < 3) return out;
  const first = boxes[order[0] as number] as BBox;
  const end = Math.max(...boxes.map(hi));
  const sizes = boxes.reduce((s, b) => s + hi(b) - lo(b), 0);
  const gap = (end - lo(first) - sizes) / (boxes.length - 1);
  let at = lo(first);
  for (const i of order) {
    const b = boxes[i] as BBox;
    const d = at - lo(b);
    out[i] = axis === 'x' ? [d, 0] : [0, d];
    at += hi(b) - lo(b) + gap;
  }
  // The last box ends where it was (floating-point drift aside).
  const last = order.at(-1) as number;
  out[last] = [0, 0];
  return out;
}

// --- Join and repair -------------------------------------------------------------------

/** Pieces of one path, reversed (end to start). */
function reversePieces(ps: readonly Piece[]): Piece[] {
  return [...ps].reverse().map((p): Piece => {
    switch (p.kind) {
      case 'line':
        return { kind: 'line', p0: p.p1, p1: p.p0 };
      case 'quad':
        return { kind: 'quad', p0: p.p1, c: p.c, p1: p.p0 };
      case 'cubic':
        return { kind: 'cubic', p0: p.p1, c1: p.c2, c2: p.c1, p1: p.p0 };
    }
  });
}

function toSegments(ps: readonly Piece[], closed: boolean): Segment[] {
  const first = ps[0];
  if (!first) return [];
  return [
    { type: 'move', p: pt(first.p0) },
    ...ps.map(pieceToSegment),
    ...(closed ? [{ type: 'close' } as Segment] : []),
  ];
}

/**
 * Joins open paths whose ends meet within `tol` (in either direction) into
 * longer paths; a path whose ends meet becomes closed.
 */
export function joinOpenPaths(
  paths: readonly (readonly Segment[])[],
  tol: number,
): { segments: Segment[]; closed: boolean }[] {
  const pool = paths
    .flatMap((s) => subpaths(s, false))
    .filter((sp) => sp.pieces.length > 0)
    .map((sp) => sp.pieces);
  const out: { segments: Segment[]; closed: boolean }[] = [];
  while (pool.length) {
    let chain = pool.shift() as Piece[];
    for (let grown = true; grown;) {
      grown = false;
      const start = (chain[0] as Piece).p0;
      const end = (chain.at(-1) as Piece).p1;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i] as Piece[];
        const cs = (c[0] as Piece).p0;
        const ce = (c.at(-1) as Piece).p1;
        let joined: Piece[] | undefined;
        if (dist(end, cs) <= tol) joined = [...chain, ...c];
        else if (dist(end, ce) <= tol) joined = [...chain, ...reversePieces(c)];
        else if (dist(start, ce) <= tol) joined = [...c, ...chain];
        else if (dist(start, cs) <= tol) joined = [...reversePieces(c), ...chain];
        if (joined) {
          chain = snapJoins(joined);
          pool.splice(i, 1);
          grown = true;
          break;
        }
      }
    }
    const closed =
      chain.length > 1 && dist((chain[0] as Piece).p0, (chain.at(-1) as Piece).p1) <= tol;
    if (closed) chain = snapJoins([...chain, chain[0] as Piece]).slice(0, -1);
    out.push({ segments: toSegments(chain, closed), closed });
  }
  return out;
}

/** Makes each piece start exactly where the previous one ends. */
function snapJoins(ps: Piece[]): Piece[] {
  return ps.map((p, i) => (i === 0 ? p : { ...p, p0: (ps[i - 1] as Piece).p1 }));
}

/**
 * Cleans a vector: drops zero-length pieces (and so repeated points), and
 * closes a path whose ends are within `tol`. `fixes` counts the changes.
 */
export function repairSegments(
  segments: readonly Segment[],
  closed: boolean,
  tol: number,
): { segments: Segment[]; closed: boolean; fixes: number } {
  let fixes = 0;
  let allClosed = true;
  const out: Segment[] = [];
  for (const sp of subpaths(segments, closed)) {
    const kept = sp.pieces.filter((p) => {
      const zero =
        dist(p.p0, p.p1) <= 1e-9 &&
        (p.kind === 'line' ||
          (p.kind === 'quad' && dist(p.c, p.p0) <= 1e-9) ||
          (p.kind === 'cubic' && dist(p.c1, p.p0) <= 1e-9 && dist(p.c2, p.p0) <= 1e-9));
      if (zero) fixes++;
      return !zero;
    });
    if (kept.length === 0) {
      fixes++;
      continue;
    }
    let isClosed = sp.closed;
    let ps = snapJoins(kept);
    const gap = dist((ps[0] as Piece).p0, (ps.at(-1) as Piece).p1);
    if (!isClosed && ps.length > 1 && gap <= tol) {
      // Snap the end onto the start and close.
      const last = ps.at(-1) as Piece;
      ps = [...ps.slice(0, -1), { ...last, p1: (ps[0] as Piece).p0 }];
      isClosed = true;
      fixes++;
    }
    // A closed path's closing line is implied by "close".
    if (isClosed) {
      const last = ps.at(-1) as Piece;
      if (last.kind === 'line' && dist(last.p1, (ps[0] as Piece).p0) <= 1e-9 && ps.length > 2)
        ps = ps.slice(0, -1);
    }
    allClosed &&= isClosed;
    out.push(...toSegments(ps, isClosed));
  }
  return { segments: out, closed: allClosed && out.length > 0, fixes };
}
