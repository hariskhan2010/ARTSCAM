import type { Segment } from '../model/schema';
import type { Vec2 } from './path';
import { arcToCubics, ellipse } from './shapes';

/**
 * DXF import (plan.md T1.6): LINE, ARC, CIRCLE, LWPOLYLINE (with bulges) and
 * SPLINE, in model space, scaled to mm from `$INSUNITS`. Non-rational splines
 * of degree ≤ 3 become exact Bézier pieces; rational splines are flattened.
 * Open pieces whose ends touch are joined into contours, so a rectangle drawn
 * as four LINEs comes in as one closed vector.
 */

export interface DxfVector {
  segments: Segment[];
  closed: boolean;
  /** DXF layer name. */
  layer: string;
}

export interface DxfImport {
  vectors: DxfVector[];
  /** mm per drawing unit used for the import. */
  scale: number;
  warnings: string[];
}

export interface DxfOptions {
  /** mm per drawing unit when the file does not say (`$INSUNITS` 0 or missing). Default 1. */
  defaultScale?: number;
  /** Join open pieces whose ends are within this distance (mm). Default 0.001; 0 disables. */
  joinTolerance?: number;
  /** Max deviation (mm) when flattening rational splines. Default 0.01. */
  tolerance?: number;
}

export class DxfError extends Error {}

/** Index known to be in range (checked by the surrounding loop bounds). */
const ix = <T>(a: readonly T[], i: number): T => a[i] as T;

/** `$INSUNITS` code → mm per unit. */
const INSUNITS: Record<number, number> = {
  1: 25.4,
  2: 304.8,
  3: 1_609_344,
  4: 1,
  5: 10,
  6: 1000,
  8: 25.4e-6,
  9: 25.4e-3,
  10: 914.4,
  14: 100,
};

interface Pair {
  code: number;
  value: string;
}

function readPairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number((lines[i] as string).trim());
    if (!Number.isInteger(code))
      throw new DxfError(`Bad group code "${lines[i]}" on line ${i + 1}`);
    pairs.push({ code, value: (lines[i + 1] as string).trim() });
  }
  return pairs;
}

interface Entity {
  type: string;
  pairs: Pair[];
}

/** Splits the ENTITIES section into entities; also returns HEADER variables. */
function sections(pairs: Pair[]): { header: Map<string, Pair[]>; entities: Entity[] } {
  const header = new Map<string, Pair[]>();
  const entities: Entity[] = [];
  let section = '';
  let current: Entity | undefined;
  let headerVar: string | undefined;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i] as Pair;
    if (p.code === 0 && p.value === 'SECTION') {
      section = pairs[i + 1]?.value ?? '';
      i++;
      continue;
    }
    if (p.code === 0 && p.value === 'ENDSEC') {
      if (current) entities.push(current);
      current = undefined;
      section = '';
      continue;
    }
    if (section === 'HEADER') {
      if (p.code === 9) {
        headerVar = p.value;
        header.set(headerVar, []);
      } else if (headerVar) header.get(headerVar)?.push(p);
    } else if (section === 'ENTITIES') {
      if (p.code === 0) {
        if (current) entities.push(current);
        current = { type: p.value, pairs: [] };
      } else current?.pairs.push(p);
    }
  }
  return { header, entities };
}

const first = (e: Entity, code: number, fallback = 0): number => {
  const p = e.pairs.find((q) => q.code === code);
  return p ? Number(p.value) : fallback;
};
const all = (e: Entity, code: number): number[] =>
  e.pairs.filter((q) => q.code === code).map((q) => Number(q.value));
const layerOf = (e: Entity) => e.pairs.find((q) => q.code === 8)?.value ?? '0';

/** Arc between two points with a DXF bulge (tan of a quarter of the included angle). */
function bulgeArc(a: Vec2, b: Vec2, bulge: number): Segment[] {
  if (bulge === 0) return [{ type: 'line', p: [b[0], b[1]] }];
  const sweep = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (chord === 0) return [];
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  // Centre: from the chord midpoint along the left normal (for CCW, bulge > 0).
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const h = r * Math.cos(sweep / 2) * Math.sign(bulge);
  const nx = -(b[1] - a[1]) / chord;
  const ny = (b[0] - a[0]) / chord;
  const cx = mx + nx * h;
  const cy = my + ny * h;
  const start = Math.atan2(a[1] - cy, a[0] - cx);
  const segs = arcToCubics(cx, cy, r, r, 0, start, sweep);
  const last = segs.at(-1);
  if (last?.type === 'cubic') last.p = [b[0], b[1]];
  return segs;
}

/**
 * Splits a non-rational B-spline of degree ≤ 3 into exact Bézier pieces by
 * knot insertion (Boehm): every knot in the domain is raised to multiplicity
 * `degree`, after which each run of degree + 1 control points is one piece.
 */
function splineToBeziers(degree: number, knots: number[], ctrl: Vec2[]): Segment[] {
  let K = [...knots];
  let P = ctrl.map((p): Vec2 => [p[0], p[1]]);
  const insert = (u: number) => {
    let k = -1;
    for (let i = 0; i < K.length - 1; i++) if (ix(K, i) <= u && u < ix(K, i + 1)) k = i;
    if (k < 0) return false;
    const Q: Vec2[] = [];
    for (let i = 0; i <= P.length; i++) {
      if (i <= k - degree) Q.push(ix(P, i));
      else if (i > k) Q.push(ix(P, i - 1));
      else {
        const den = ix(K, i + degree) - ix(K, i);
        const alpha = den === 0 ? 0 : (u - ix(K, i)) / den;
        const a = ix(P, i - 1);
        const b = ix(P, i);
        Q.push([(1 - alpha) * a[0] + alpha * b[0], (1 - alpha) * a[1] + alpha * b[1]]);
      }
    }
    K = [...K.slice(0, k + 1), u, ...K.slice(k + 1)];
    P = Q;
    return true;
  };
  const lo = ix(K, degree);
  const hi = ix(K, K.length - degree - 1);
  const count = (u: number) => K.filter((k) => k === u).length;
  const raise = (u: number) => {
    while (count(u) < degree && insert(u));
  };
  const distinct = [...new Set(K.filter((k) => k >= lo && k <= hi))];
  for (const u of distinct) raise(u);

  const base = K.lastIndexOf(lo) - degree;
  const spans = distinct.length - 1;
  const start = ix(P, base);
  const segs: Segment[] = [{ type: 'move', p: [start[0], start[1]] }];
  for (let s = 0; s < spans; s++) {
    const pts = P.slice(base + s * degree + 1, base + (s + 1) * degree + 1).map(
      (p): [number, number] => [p[0], p[1]],
    );
    if (degree === 1) segs.push({ type: 'line', p: ix(pts, 0) });
    else if (degree === 2) segs.push({ type: 'quad', c: ix(pts, 0), p: ix(pts, 1) });
    else segs.push({ type: 'cubic', c1: ix(pts, 0), c2: ix(pts, 1), p: ix(pts, 2) });
  }
  return segs;
}

/** de Boor evaluation of a (possibly rational) B-spline at u. */
function deBoor(degree: number, knots: number[], ctrl: Vec2[], weights: number[], u: number): Vec2 {
  let k = degree;
  while (k < knots.length - degree - 2 && u >= ix(knots, k + 1)) k++;
  const d = Array.from({ length: degree + 1 }, (_, j) => {
    const p = ix(ctrl, j + k - degree);
    const w = weights[j + k - degree] ?? 1;
    return [p[0] * w, p[1] * w, w];
  });
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = j + k - degree;
      const den = ix(knots, i + degree - r + 1) - ix(knots, i);
      const alpha = den === 0 ? 0 : (u - ix(knots, i)) / den;
      const a = ix(d, j - 1);
      const b = ix(d, j);
      d[j] = [
        (1 - alpha) * ix(a, 0) + alpha * ix(b, 0),
        (1 - alpha) * ix(a, 1) + alpha * ix(b, 1),
        (1 - alpha) * ix(a, 2) + alpha * ix(b, 2),
      ];
    }
  }
  const h = ix(d, degree);
  return [ix(h, 0) / ix(h, 2), ix(h, 1) / ix(h, 2)];
}

function sampledSpline(
  degree: number,
  knots: number[],
  ctrl: Vec2[],
  weights: number[],
  tol: number,
): Segment[] {
  const lo = ix(knots, degree);
  const hi = ix(knots, knots.length - degree - 1);
  const out: Vec2[] = [deBoor(degree, knots, ctrl, weights, lo)];
  const refine = (u0: number, p0: Vec2, u1: number, p1: Vec2, depth: number) => {
    const um = (u0 + u1) / 2;
    const pm = deBoor(degree, knots, ctrl, weights, um);
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    if (depth < 4 || (depth < 20 && Math.hypot(pm[0] - mx, pm[1] - my) > tol)) {
      refine(u0, p0, um, pm, depth + 1);
      refine(um, pm, u1, p1, depth + 1);
    } else out.push(p1);
  };
  refine(lo, ix(out, 0), hi, deBoor(degree, knots, ctrl, weights, hi - 1e-12 * (hi - lo)), 0);
  return out.map((p, i): Segment => ({ type: i === 0 ? 'move' : 'line', p: [p[0], p[1]] }));
}

const endPoint = (segs: Segment[]): Vec2 | undefined => {
  const last = segs.at(-1);
  return last && last.type !== 'close' ? last.p : undefined;
};
const startPoint = (segs: Segment[]): Vec2 | undefined => {
  const f = segs[0];
  return f?.type === 'move' ? f.p : undefined;
};
const near = (a: Vec2, b: Vec2, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

function reverseSegments(segs: Segment[]): Segment[] {
  const pts: Vec2[] = [];
  for (const s of segs) if (s.type !== 'close') pts.push(s.p);
  const out: Segment[] = [{ type: 'move', p: [...(pts.at(-1) as Vec2)] as [number, number] }];
  for (let i = segs.length - 1; i >= 1; i--) {
    const s = segs[i] as Segment;
    const to = pts[i - 1] as Vec2;
    const p: [number, number] = [to[0], to[1]];
    if (s.type === 'line') out.push({ type: 'line', p });
    else if (s.type === 'quad') out.push({ type: 'quad', c: s.c, p });
    else if (s.type === 'cubic') out.push({ type: 'cubic', c1: s.c2, c2: s.c1, p });
  }
  return out;
}

/** Chains open single-subpath pieces whose ends meet; closes chains that loop. */
export function joinPaths(vectors: DxfVector[], tol: number): DxfVector[] {
  const closed = vectors.filter((v) => v.closed);
  const open = vectors.filter((v) => !v.closed).map((v) => ({ ...v, segments: [...v.segments] }));
  const out: DxfVector[] = [...closed];
  while (open.length > 0) {
    const chain = open.shift() as DxfVector;
    let grown = true;
    while (grown) {
      grown = false;
      const s = startPoint(chain.segments) as Vec2;
      const e = endPoint(chain.segments) as Vec2;
      if (chain.segments.length > 1 && near(s, e, tol)) break;
      for (let i = 0; i < open.length; i++) {
        const o = open[i] as DxfVector;
        if (o.layer !== chain.layer) continue;
        const os = startPoint(o.segments) as Vec2;
        const oe = endPoint(o.segments) as Vec2;
        let add: Segment[] | undefined;
        let prepend = false;
        if (near(e, os, tol)) add = o.segments;
        else if (near(e, oe, tol)) add = reverseSegments(o.segments);
        else if (near(s, oe, tol)) [add, prepend] = [o.segments, true];
        else if (near(s, os, tol)) [add, prepend] = [reverseSegments(o.segments), true];
        if (!add) continue;
        chain.segments = prepend
          ? [...add, ...chain.segments.slice(1)]
          : [...chain.segments, ...add.slice(1)];
        open.splice(i, 1);
        grown = true;
        break;
      }
    }
    const s = startPoint(chain.segments) as Vec2;
    const e = endPoint(chain.segments) as Vec2;
    if (chain.segments.length > 2 && near(s, e, tol)) {
      const last = chain.segments.at(-1) as Segment;
      if (last.type !== 'close') last.p = [s[0], s[1]];
      chain.segments.push({ type: 'close' });
      chain.closed = true;
    }
    out.push(chain);
  }
  return out;
}

export function importDxf(text: string, options: DxfOptions = {}): DxfImport {
  const { header, entities } = sections(readPairs(text));
  const warnings: string[] = [];
  const insunits = Number(header.get('$INSUNITS')?.find((p) => p.code === 70)?.value ?? 0);
  let scale = INSUNITS[insunits];
  if (scale === undefined) {
    scale = options.defaultScale ?? 1;
    if (insunits !== 0)
      warnings.push(`Unknown $INSUNITS ${insunits}; assumed ${scale} mm per unit`);
  }
  const tol = options.tolerance ?? 0.01;
  const S = (x: number, y: number): [number, number] => [x * scale, y * scale];

  const raw: DxfVector[] = [];
  const skipped = new Map<string, number>();
  for (const e of entities) {
    const layer = layerOf(e);
    switch (e.type) {
      case 'LINE':
        raw.push({
          layer,
          closed: false,
          segments: [
            { type: 'move', p: S(first(e, 10), first(e, 20)) },
            { type: 'line', p: S(first(e, 11), first(e, 21)) },
          ],
        });
        break;
      case 'CIRCLE': {
        const [cx, cy] = S(first(e, 10), first(e, 20));
        raw.push({ layer, closed: true, segments: ellipse(cx, cy, first(e, 40) * scale) });
        break;
      }
      case 'ARC': {
        const [cx, cy] = S(first(e, 10), first(e, 20));
        const r = first(e, 40) * scale;
        const a0 = (first(e, 50) * Math.PI) / 180;
        let a1 = (first(e, 51) * Math.PI) / 180;
        while (a1 <= a0) a1 += 2 * Math.PI;
        raw.push({
          layer,
          closed: false,
          segments: [
            { type: 'move', p: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)] },
            ...arcToCubics(cx, cy, r, r, 0, a0, a1 - a0),
          ],
        });
        break;
      }
      case 'LWPOLYLINE': {
        const closed = (first(e, 70) & 1) === 1;
        const verts: { p: [number, number]; bulge: number }[] = [];
        for (const p of e.pairs) {
          if (p.code === 10) verts.push({ p: [Number(p.value) * scale, 0], bulge: 0 });
          else if (p.code === 20 && verts.length)
            (verts.at(-1) as { p: [number, number] }).p[1] = Number(p.value) * scale;
          else if (p.code === 42 && verts.length)
            (verts.at(-1) as { bulge: number }).bulge = Number(p.value);
        }
        if (verts.length < 2) break;
        const segs: Segment[] = [{ type: 'move', p: ix(verts, 0).p }];
        const n = closed ? verts.length : verts.length - 1;
        for (let i = 0; i < n; i++) {
          const a = ix(verts, i);
          const b = ix(verts, (i + 1) % verts.length);
          segs.push(...bulgeArc(a.p, b.p, a.bulge));
        }
        if (closed) segs.push({ type: 'close' });
        raw.push({ layer, closed, segments: segs });
        break;
      }
      case 'SPLINE': {
        const flags = first(e, 70);
        const degree = first(e, 71, 3);
        const knots = all(e, 40);
        const xs = all(e, 10);
        const ys = all(e, 20);
        const ctrl = xs.map((x, i): Vec2 => S(x, ys[i] ?? 0));
        const weights = all(e, 41);
        const rational = (flags & 4) === 4 && weights.some((w) => w !== 1);
        if (ctrl.length < degree + 1 || knots.length !== ctrl.length + degree + 1) {
          const fx = all(e, 11);
          const fy = all(e, 21);
          if (fx.length >= 2) {
            warnings.push('SPLINE without control points imported through its fit points as lines');
            raw.push({
              layer,
              closed: false,
              segments: fx.map((x, i): Segment => ({
                type: i === 0 ? 'move' : 'line',
                p: S(x, fy[i] ?? 0),
              })),
            });
          } else warnings.push('Skipped a SPLINE with inconsistent knots/control points');
          break;
        }
        const segs =
          !rational && degree >= 1 && degree <= 3
            ? splineToBeziers(degree, knots, ctrl)
            : sampledSpline(degree, knots, ctrl, weights.length ? weights : ctrl.map(() => 1), tol);
        const isClosed = (flags & 1) === 1;
        if (isClosed) {
          const s = startPoint(segs) as Vec2;
          const last = segs.at(-1) as Segment;
          if (last.type !== 'close' && near(s, last.p, 1e-6)) last.p = [s[0], s[1]];
          segs.push({ type: 'close' });
        }
        raw.push({ layer, closed: isClosed, segments: segs });
        break;
      }
      default:
        skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1);
    }
  }
  for (const [type, count] of skipped)
    warnings.push(`Skipped ${count} unsupported ${type} entit${count === 1 ? 'y' : 'ies'}`);

  const join = options.joinTolerance ?? 0.001;
  return { vectors: join > 0 ? joinPaths(raw, join) : raw, scale, warnings };
}
