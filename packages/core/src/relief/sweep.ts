import type { Project, ReliefOp, Segment } from '../model/schema';
import { flatten } from '../vector/flatten';
import type { Vec2 } from '../vector/path';

/**
 * Sweeps (plan.md M6): reliefs built from cross-sections.
 *
 * A cross-section is an open vector drawn at true size. Its ends sit on the
 * base; its height at each point is measured from the straight line between
 * its ends, read left to right (so it does not matter which way it was drawn).
 */

export interface Section {
  /** Distance between the ends, mm. */
  width: number;
  /** Height at u ∈ [0, 1] across the section (0 = left end). */
  at(u: number): number;
}

const SECTION_BINS = 1024;

/** A cross-section from an open vector's segments. */
export function sectionProfile(segments: readonly Segment[], tolerance: number): Section {
  const pts = flatten(segments, tolerance, false).flatMap((p) => p.points);
  if (pts.length < 2) throw new RangeError('A cross-section needs at least two points');
  let a = pts[0] as Vec2;
  let b = pts.at(-1) as Vec2;
  if (a[0] > b[0]) [a, b] = [b, a];
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (width < 1e-9) throw new RangeError('A cross-section needs its ends apart');
  const ex = (b[0] - a[0]) / width;
  const ey = (b[1] - a[1]) / width;
  // Upper envelope of the section, sampled in bins along the chord.
  const bins = new Float64Array(SECTION_BINS + 1).fill(-Infinity);
  const local = pts.map(([x, y]): Vec2 => {
    const dx = x - a[0];
    const dy = y - a[1];
    return [(dx * ex + dy * ey) / width, -dx * ey + dy * ex];
  });
  for (let i = 1; i < local.length; i++) {
    const [u0, h0] = local[i - 1] as Vec2;
    const [u1, h1] = local[i] as Vec2;
    const k0 = Math.max(0, Math.ceil(Math.min(u0, u1) * SECTION_BINS));
    const k1 = Math.min(SECTION_BINS, Math.floor(Math.max(u0, u1) * SECTION_BINS));
    for (let k = k0; k <= k1; k++) {
      const u = k / SECTION_BINS;
      const t = u1 === u0 ? 0 : (u - u0) / (u1 - u0);
      bins[k] = Math.max(bins[k] as number, h0 + (h1 - h0) * t);
    }
    for (const [u, h] of [local[i - 1], local[i]] as Vec2[]) {
      const k = Math.round(u * SECTION_BINS);
      if (k >= 0 && k <= SECTION_BINS) bins[k] = Math.max(bins[k] as number, h);
    }
  }
  // Gaps (a section that doubles back) take the nearest known height.
  let last = 0;
  for (let k = 0; k <= SECTION_BINS; k++) {
    if (Number.isFinite(bins[k])) last = bins[k] as number;
    else bins[k] = last;
  }
  return {
    width,
    at(u: number) {
      const x = Math.min(1, Math.max(0, u)) * SECTION_BINS;
      const k = Math.min(SECTION_BINS - 1, Math.floor(x));
      const f = x - k;
      return (bins[k] as number) * (1 - f) + (bins[k + 1] as number) * f;
    },
  };
}

export interface HeightTarget {
  cols: number;
  rows: number;
  resolution: number;
  /** Writes height h into cell i (applying the op's combine mode). */
  put(i: number, h: number): void;
}

function vectorById(project: Project, id: string, role: string) {
  const v = project.vectors.find((x) => x.id === id);
  if (!v) throw new RangeError(`${role} uses unknown vector "${id}"`);
  return v;
}

/** Extrude: a section swept along a rail (plan.md T6.1). */
export function applyExtrude(
  t: HeightTarget,
  op: Extract<ReliefOp, { op: 'extrude' }>,
  project: Project,
): void {
  const res = t.resolution;
  const tol = Math.min(0.02, res / 4);
  const railV = vectorById(project, op.rail, 'Extrude rail');
  const start = sectionProfile(vectorById(project, op.section, 'Extrude section').segments, tol);
  const end = op.endSection
    ? sectionProfile(vectorById(project, op.endSection, 'Extrude end section').segments, tol)
    : undefined;
  const half = (op.width ?? start.width) / 2;
  const rails = flatten(railV.segments, tol, railV.closed);
  const n = t.cols * t.rows;
  // Per cell: distance to the nearest rail point, signed offset, distance along the rail.
  const best = new Float32Array(n).fill(Infinity);
  const offset = new Float32Array(n);
  const along = new Float32Array(n);
  let total = 0;
  for (const rail of rails) {
    const pts = rail.points;
    const closed = rail.closed;
    const segs = closed ? pts.length : pts.length - 1;
    let s0 = total;
    for (let i = 0; i < segs; i++) {
      const a = pts[i] as Vec2;
      const b = pts[(i + 1) % pts.length] as Vec2;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) continue;
      const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - half) / res));
      const c1 = Math.min(t.cols - 1, Math.ceil((Math.max(a[0], b[0]) + half) / res));
      const r0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - half) / res));
      const r1 = Math.min(t.rows - 1, Math.ceil((Math.max(a[1], b[1]) + half) / res));
      const firstOpen = !closed && i === 0;
      const lastOpen = !closed && i === segs - 1;
      for (let r = r0; r <= r1; r++) {
        const y = (r + 0.5) * res;
        for (let c = c0; c <= c1; c++) {
          const x = (c + 0.5) * res;
          const px = x - a[0];
          const py = y - a[1];
          let u = (px * dx + py * dy) / (len * len);
          // Open rails end square: nothing beyond their first and last points.
          if ((firstOpen && u < 0) || (lastOpen && u > 1)) continue;
          u = Math.min(1, Math.max(0, u));
          const fx = px - u * dx;
          const fy = py - u * dy;
          const d = Math.hypot(fx, fy);
          const k = r * t.cols + c;
          if (d >= (best[k] as number)) continue;
          best[k] = d;
          offset[k] = (dx * py - dy * px) / len >= 0 ? d : -d;
          along[k] = s0 + u * len;
        }
      }
      s0 += len;
    }
    total = s0;
  }
  for (let k = 0; k < n; k++) {
    const d = best[k] as number;
    if (!(d <= half)) continue;
    // Left of the rail's direction is the section's left end.
    const u = 0.5 - (offset[k] as number) / (2 * half);
    const h0 = start.at(u);
    const h = end ? h0 + (end.at(u) - h0) * ((along[k] as number) / Math.max(total, 1e-9)) : h0;
    t.put(k, h);
  }
}

/** Spin: a section turned around a centre point (plan.md T6.2). */
export function applySpin(
  t: HeightTarget,
  op: Extract<ReliefOp, { op: 'spin' }>,
  project: Project,
): void {
  const res = t.resolution;
  const s = sectionProfile(
    vectorById(project, op.section, 'Spin section').segments,
    Math.min(0.02, res / 4),
  );
  const [cx, cy] = op.centre;
  const R = s.width;
  const c0 = Math.max(0, Math.floor((cx - R) / res));
  const c1 = Math.min(t.cols - 1, Math.ceil((cx + R) / res));
  const r0 = Math.max(0, Math.floor((cy - R) / res));
  const r1 = Math.min(t.rows - 1, Math.ceil((cy + R) / res));
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const d = Math.hypot((c + 0.5) * res - cx, (r + 0.5) * res - cy);
      if (d <= R) t.put(r * t.cols + c, s.at(d / R));
    }
}

/** Points every `step` mm along a polyline (both ends included), `n` + 1 of them. */
function stations(points: readonly Vec2[], n: number): Vec2[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    cum.push((cum[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const L = cum.at(-1) as number;
  const out: Vec2[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const d = (k / n) * L;
    while (j < points.length - 2 && (cum[j + 1] as number) < d) j++;
    const a = points[j] as Vec2;
    const b = points[j + 1] as Vec2;
    const seg = (cum[j + 1] as number) - (cum[j] as number);
    const f = seg > 0 ? (d - (cum[j] as number)) / seg : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/**
 * Inverse of the bilinear patch p(s, t) = lerp(lerp(a, b, s), lerp(d, c, s), t)
 * with corners a (0,0), b (1,0), c (1,1), d (0,1). Undefined outside the patch.
 */
function invBilinear(p: Vec2, a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | undefined {
  const e: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const f: Vec2 = [d[0] - a[0], d[1] - a[1]];
  const g: Vec2 = [a[0] - b[0] + c[0] - d[0], a[1] - b[1] + c[1] - d[1]];
  const h: Vec2 = [p[0] - a[0], p[1] - a[1]];
  const cross = (u: Vec2, v: Vec2) => u[0] * v[1] - u[1] * v[0];
  const k2 = cross(g, f);
  const k1 = cross(e, f) + cross(h, g);
  const k0 = cross(h, e);
  const EPS = 1e-12;
  const candidates: number[] = [];
  if (Math.abs(k2) < EPS) {
    if (Math.abs(k1) > EPS) candidates.push(-k0 / k1);
  } else {
    const disc = k1 * k1 - 4 * k0 * k2;
    if (disc < 0) return undefined;
    const sq = Math.sqrt(disc);
    candidates.push((-k1 - sq) / (2 * k2), (-k1 + sq) / (2 * k2));
  }
  for (const v of candidates) {
    if (v < -1e-9 || v > 1 + 1e-9) continue;
    const den0 = e[0] + g[0] * v;
    const den1 = e[1] + g[1] * v;
    const u = Math.abs(den0) > Math.abs(den1) ? (h[0] - f[0] * v) / den0 : (h[1] - f[1] * v) / den1;
    if (u >= -1e-9 && u <= 1 + 1e-9)
      return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
  }
  return undefined;
}

/** Two-rail sweep: a section stretched between two rails (plan.md T6.3). */
export function applyTwoRail(
  t: HeightTarget,
  op: Extract<ReliefOp, { op: 'twoRail' }>,
  project: Project,
): void {
  const res = t.resolution;
  const tol = Math.min(0.02, res / 4);
  const s = sectionProfile(vectorById(project, op.section, 'Sweep section').segments, tol);
  const path = (id: string) => {
    const v = vectorById(project, id, 'Sweep rail');
    return flatten(v.segments, tol, false).flatMap((p) => p.points);
  };
  const A = path(op.railA);
  let B = path(op.railB);
  if (A.length < 2 || B.length < 2) throw new RangeError('Sweep rails need at least two points');
  // Run both rails the same way: start near start.
  const dist = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  if (
    dist(A[0] as Vec2, B[0] as Vec2) + dist(A.at(-1) as Vec2, B.at(-1) as Vec2) >
    dist(A[0] as Vec2, B.at(-1) as Vec2) + dist(A.at(-1) as Vec2, B[0] as Vec2)
  )
    B = [...B].reverse();
  const len = (pts: Vec2[]) =>
    pts.reduce((sum, p, i) => (i ? sum + dist(pts[i - 1] as Vec2, p) : 0), 0);
  const n = Math.max(1, Math.ceil(Math.max(len(A), len(B)) / (res / 2)));
  const sa = stations(A, n);
  const sb = stations(B, n);
  const done = new Uint8Array(t.cols * t.rows);
  for (let i = 0; i < n; i++) {
    const a = sa[i] as Vec2;
    const b = sa[i + 1] as Vec2;
    const c = sb[i + 1] as Vec2;
    const d = sb[i] as Vec2;
    const xs = [a[0], b[0], c[0], d[0]];
    const ys = [a[1], b[1], c[1], d[1]];
    const c0 = Math.max(0, Math.floor(Math.min(...xs) / res));
    const c1 = Math.min(t.cols - 1, Math.ceil(Math.max(...xs) / res));
    const r0 = Math.max(0, Math.floor(Math.min(...ys) / res));
    const r1 = Math.min(t.rows - 1, Math.ceil(Math.max(...ys) / res));
    for (let r = r0; r <= r1; r++)
      for (let cc = c0; cc <= c1; cc++) {
        const k = r * t.cols + cc;
        if (done[k]) continue;
        const st = invBilinear([(cc + 0.5) * res, (r + 0.5) * res], a, b, c, d);
        if (!st) continue;
        const [u, v] = st;
        // Width between the rails here, for scaled heights.
        const pa: Vec2 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        const pb: Vec2 = [d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u];
        const scale = op.scaleHeight ? dist(pa, pb) / s.width : 1;
        done[k] = 1;
        t.put(k, s.at(v) * scale);
      }
  }
}
