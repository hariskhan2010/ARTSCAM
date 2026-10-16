import type { Tool, Toolpath } from '../model/schema';
import { heightAt } from './tools';
import type { Grid } from '../relief/relief';
import { booleanOp, normalize, offset, simplify, type Region } from '../vector/clip';
import type { Vec2 } from '../vector/path';
import { PathBuilder } from './builder';
import { emitPocketCentres } from './pocket';

/**
 * 3D CAM on a relief (plan.md M5).
 *
 * Placement: the relief's highest point sits at the top of the stock, so the
 * machined surface is z = top − (max − h). The drop-cutter gives, at any XY,
 * the lowest tool-tip height that touches but never cuts into that surface:
 * the maximum over nearby cells of (surface − tool height at that distance).
 */

export type Rough3dParams = Extract<Toolpath, { type: 'rough3d' }>['params'];
export type Finish3dParams = Extract<Toolpath, { type: 'finish3d' }>['params'];
export type Rest3dParams = Extract<Toolpath, { type: 'rest3d' }>['params'];

export interface PlacedRelief {
  grid: Grid;
  /** Stock top Z (absolute). */
  top: number;
  /** Highest relief height (aligned with the stock top). */
  maxH: number;
  /** Lowest allowed tip Z (stock bottom). */
  floor: number;
}

export function placeRelief(grid: Grid, top: number, floor: number): PlacedRelief {
  let maxH = -Infinity;
  for (let i = 0; i < grid.z.length; i++) maxH = Math.max(maxH, grid.z[i] as number);
  return { grid, top, maxH: Number.isFinite(maxH) ? maxH : 0, floor };
}

type ToolShape = Pick<Tool, 'type' | 'diameter' | 'angle' | 'tipDiameter'>;

/** A straight move may dip at most this far (mm) below the safe surface before it is split. */
const REFINE_TOL = 0.005;
/** A finishing link may run this far (mm) outside the boundary (it follows the edge). */
const LINK_TOL = 0.005;

/**
 * A drop-cutter for one tool: `at(x, y)` is the lowest safe tip Z at world XY.
 * Uses the true distance from (x, y) to every cell centre within reach, so
 * the result does not depend on where (x, y) falls inside a cell.
 */
export function dropCutter(pr: PlacedRelief, tool: ToolShape, inflate = 0) {
  const g = pr.grid;
  const res = g.resolution;
  const R = tool.diameter / 2 + inflate;
  const k = Math.ceil(R / res) + 1;
  // Tool height above the tip by distance, as a fine lookup table.
  const step = Math.min(res / 8, R / 256);
  const table = new Float32Array(Math.ceil(R / step) + 2);
  for (let i = 0; i < table.length; i++)
    table[i] = heightAt(tool, Math.max(0, Math.min(R, i * step) - inflate));
  const shift = pr.top - pr.maxH;
  const rowMax = rowWindowMax(g.z, g.cols, g.rows, k);
  return {
    at(x: number, y: number): number {
      const cx = Math.floor(x / res);
      const cy = Math.floor(y / res);
      const c0 = Math.max(0, cx - k);
      const c1 = Math.min(g.cols - 1, cx + k);
      const r0 = Math.max(0, cy - k);
      const r1 = Math.min(g.rows - 1, cy + k);
      const mc = Math.min(g.cols - 1, Math.max(0, cx));
      const start = Math.min(r1, Math.max(r0, cy));
      let best = -Infinity;
      // Rows nearest first; skip a row when even its highest cell, at the
      // row's nearest distance, cannot beat the best so far (the tool height
      // only grows with distance), so the result is the same as a full scan.
      for (let i = 0; ; i++) {
        const r = i % 2 === 0 ? start + i / 2 : start - (i + 1) / 2;
        if (start + i / 2 > r1 && start - (i + 1) / 2 < r0) break;
        if (r < r0 || r > r1) continue;
        const dy = (r + 0.5) * res - y;
        const ady = Math.abs(dy);
        if (ady > R) continue;
        const bound =
          (rowMax[r * g.cols + mc] as number) + shift - (table[Math.floor(ady / step)] as number);
        if (bound <= best) continue;
        for (let c = c0; c <= c1; c++) {
          const dx = (c + 0.5) * res - x;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R) continue;
          // Round the distance down so the tool is never assumed thinner than it is.
          const v =
            (g.z[r * g.cols + c] as number) + shift - (table[Math.floor(d / step)] as number);
          if (v > best) best = v;
        }
      }
      if (best === -Infinity) return pr.top;
      return Math.min(pr.top, Math.max(pr.floor, best));
    },
  };
}

/**
 * Per row, the maximum of z over columns c − k … c + k (clamped to the row),
 * with a monotonic queue: O(cells).
 */
function rowWindowMax(z: Float32Array, cols: number, rows: number, k: number): Float32Array {
  const out = new Float32Array(z.length);
  const q = new Int32Array(cols);
  for (let r = 0; r < rows; r++) {
    const o = r * cols;
    let head = 0;
    let tail = 0;
    let next = 0; // next column to push
    for (let c = 0; c < cols; c++) {
      const hi = Math.min(cols - 1, c + k);
      while (next <= hi) {
        const v = z[o + next] as number;
        while (tail > head && (z[o + (q[tail - 1] as number)] as number) <= v) tail--;
        q[tail++] = next++;
      }
      while ((q[head] as number) < c - k) head++;
      out[o + c] = z[o + (q[head] as number)] as number;
    }
  }
  return out;
}

/**
 * Removes points that lie on the straight 3D line between the last kept point
 * and the next one: within 1e-6 mm sideways (XY) and `tol` in Z. Both checks
 * matter: dropping a point that is only level in Z would let a move cut
 * across the surface diagonally.
 */
function simplify3(pts: [number, number, number][], tol = 0.003): [number, number, number][] {
  if (pts.length < 3) return pts;
  const out = [pts[0] as [number, number, number]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out.at(-1) as [number, number, number];
    const p = pts[i] as [number, number, number];
    const b = pts[i + 1] as [number, number, number];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    const off = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    const onLine = len2 > 0 && t > 0 && t < 1 && off < 1e-6;
    if (!onLine || Math.abs(a[2] + (b[2] - a[2]) * t - p[2]) > tol) out.push(p);
  }
  out.push(pts.at(-1) as [number, number, number]);
  return out;
}

type P3 = [number, number, number];
type Drop = ReturnType<typeof dropCutter>;

/**
 * Places points on a drop-cutter surface. Where the safe surface rises above
 * the straight move between two points (steep walls), midpoints are inserted
 * until the move stays above it, so no straight move cuts into the relief.
 */
function surfaceFollower(drop: Drop) {
  const refine = (a: P3, c: P3, out: P3[], depth: number) => {
    const mx = (a[0] + c[0]) / 2;
    const my = (a[1] + c[1]) / 2;
    const mz = drop.at(mx, my);
    if (depth >= 8 || mz <= (a[2] + c[2]) / 2 + REFINE_TOL) return;
    const m: P3 = [mx, my, mz];
    refine(a, m, out, depth + 1);
    out.push(m);
    refine(m, c, out, depth + 1);
  };
  /** Appends (x, y) on the surface. */
  const push = (pts: P3[], x: number, y: number) => {
    const p: P3 = [x, y, drop.at(x, y)];
    const last = pts.at(-1);
    if (last && last[0] === x && last[1] === y) return;
    if (last) refine(last, p, pts, 0);
    pts.push(p);
  };
  /** Appends samples at most `res` apart along the straight XY move from the last point to (x, y). */
  const lineTo = (pts: P3[], x: number, y: number, res: number) => {
    const last = pts.at(-1);
    if (last) {
      const [x0, y0] = last;
      const n = Math.ceil(Math.hypot(x - x0, y - y0) / res);
      for (let i = 1; i < n; i++) push(pts, x0 + ((x - x0) * i) / n, y0 + ((y - y0) * i) / n);
    }
    push(pts, x, y);
  };
  return { push, lineTo };
}
type Follower = ReturnType<typeof surfaceFollower>;

/**
 * A test for links: true when the straight XY move a → c stays inside
 * `region` (always, without one). Links may run exactly along the region's
 * edge, so they are tested against the region grown by a hair.
 */
function linkTester(region: Region | undefined) {
  const grown = region?.length ? offset(region, LINK_TOL, { join: 'miter', fill: 'nonZero' }) : [];
  const pieces = segmentClipper(grown);
  return (a: Vec2, c: Vec2) => {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (!region || len < 1e-9) return true;
    // One inside run covering the whole move.
    const runs = pieces(a, c);
    const inside = runs.reduce((s, [t0, t1]) => s + (t1 - t0) * len, 0);
    return runs.length === 1 && inside >= len - 1e-3;
  };
}

/**
 * Clips straight segments to a region (non-zero winding): `(a, c)` returns
 * the inside runs as [t0, t1] (0 … 1 along a → c), in order. Exact, and
 * much faster than a general polygon clip for many short segments.
 */
function segmentClipper(region: Region): (a: Vec2, c: Vec2) => [number, number][] {
  const inside = insideTester(region);
  const edges = region.flatMap((ring) =>
    ring.map((p, i): [Vec2, Vec2] => [p, ring[(i + 1) % ring.length] as Vec2]),
  );
  /** Where (0…1 along a → c) the segment meets the region's edges. */
  const hits = (a: Vec2, c: Vec2) => {
    const [x0, x1] = a[0] < c[0] ? [a[0], c[0]] : [c[0], a[0]];
    const [y0, y1] = a[1] < c[1] ? [a[1], c[1]] : [c[1], a[1]];
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const ts: number[] = [];
    for (const [p, q] of edges) {
      if (Math.max(p[0], q[0]) < x0 || Math.min(p[0], q[0]) > x1) continue;
      if (Math.max(p[1], q[1]) < y0 || Math.min(p[1], q[1]) > y1) continue;
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-15) continue; // parallel: the pieces' middles decide
      const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
      const s = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1) ts.push(t);
    }
    return ts;
  };
  return (a: Vec2, c: Vec2) => {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (edges.length === 0 || len < 1e-12) return [];
    // Split where the segment meets the edges; each part is wholly inside or
    // outside, decided at its middle. Adjacent inside parts merge.
    const ts = [0, ...hits(a, c).sort((s, t) => s - t), 1];
    const runs: [number, number][] = [];
    for (let i = 1; i < ts.length; i++) {
      const t0 = ts[i - 1] as number;
      const t1 = ts[i] as number;
      if ((t1 - t0) * len < 1e-7) continue;
      const tm = (t0 + t1) / 2;
      if (!inside(a[0] + (c[0] - a[0]) * tm, a[1] + (c[1] - a[1]) * tm)) continue;
      const last = runs.at(-1);
      if (last && (t0 - last[1]) * len < 1e-6) last[1] = t1;
      else runs.push([t0, t1]);
    }
    return runs;
  };
}

/** One continuous cut through `pts`: travel, plunge, cut, retract. */
function emitChain(b: PathBuilder, pts: P3[]) {
  if (pts.length === 0) return;
  const path = simplify3(pts);
  const first = path[0] as P3;
  b.travelTo([first[0], first[1]]);
  b.plungeTo(first[2]);
  for (const p of path) b.cutTo([p[0], p[1]], p[2]);
  b.retract();
}

/**
 * Point-in-region test (non-zero winding), with the edges sorted into
 * horizontal bands so a test only looks at the edges near its Y.
 */
function insideTester(region: Region): (x: number, y: number) => boolean {
  const edges: [number, number, number, number][] = [];
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const ring of region)
    ring.forEach((a, i) => {
      const c = ring[(i + 1) % ring.length] as Vec2;
      edges.push([a[0], a[1], c[0], c[1]]);
      y0 = Math.min(y0, a[1]);
      y1 = Math.max(y1, a[1]);
    });
  if (edges.length === 0) return () => false;
  const nb = Math.max(1, Math.min(4096, Math.ceil(edges.length / 4)));
  const bh = (y1 - y0) / nb || 1;
  const band = (y: number) => Math.min(nb - 1, Math.max(0, Math.floor((y - y0) / bh)));
  const bands: number[][] = Array.from({ length: nb }, () => []);
  edges.forEach((e, i) => {
    for (let k = band(Math.min(e[1], e[3])); k <= band(Math.max(e[1], e[3])); k++)
      (bands[k] as number[]).push(i);
  });
  return (x, y) => {
    if (y < y0 || y > y1) return false;
    let w = 0;
    for (const i of bands[band(y)] as number[]) {
      const [ax, ay, cx, cy] = edges[i] as [number, number, number, number];
      const side = (cx - ax) * (y - ay) - (x - ax) * (cy - ay);
      if (ay <= y) {
        if (cy > y && side > 0) w++;
      } else if (cy <= y && side < 0) w--;
    }
    return w !== 0;
  };
}

/** A raster direction: u along the lines (0 … along), v across them (0 … across). */
interface RasterFrame {
  along: number;
  across: number;
  toXY(u: number, v: number): Vec2;
}

/** Lines along X or Y over the whole material. */
function axisFrame(dir: 'x' | 'y', width: number, height: number): RasterFrame {
  return {
    along: dir === 'x' ? width : height,
    across: dir === 'x' ? height : width,
    toXY: (u, v) => (dir === 'x' ? [u, v] : [v, u]),
  };
}

/** Lines at `deg` degrees counter-clockwise from X, over the bounding box of `area` in that direction. */
function angleFrame(deg: number, area: Region): RasterFrame {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts = area.flat();
  const us = pts.map((p) => p[0] * c + p[1] * s);
  const vs = pts.map((p) => -p[0] * s + p[1] * c);
  const u0 = Math.min(...us);
  const v0 = Math.min(...vs);
  return {
    along: Math.max(...us) - u0,
    across: Math.max(...vs) - v0,
    toXY: (u, v) => {
      const U = u0 + u;
      const V = v0 + v;
      return [U * c - V * s, U * s + V * c];
    },
  };
}

/**
 * Raster finishing in one direction: parallel lines, zig-zag, the tool
 * following the drop-cutter surface; links between lines also follow the
 * surface, so the whole pass is one continuous cut.
 *
 * With a clip region, the tool centre stays inside it: each line is clipped
 * to the region, and a link follows the surface only when it stays inside
 * too; otherwise the tool lifts and moves to the next piece.
 */
function emitRaster(
  b: PathBuilder,
  follow: Follower,
  res: number,
  frame: RasterFrame,
  step: number,
  clip: Region | undefined,
): void {
  const { along, across, toXY } = frame;
  if (!(along > 0)) return;
  const linkInside = linkTester(clip);
  const clipLine = segmentClipper(clip ?? []);
  const nLines = Math.max(1, Math.round(across / step));
  const n = Math.max(1, Math.ceil(along / res));
  const vOf = (li: number) => (li * across) / nLines;
  // Each line's pieces as [u0, u1] (u0 < u1) along it.
  const lines: [number, number][][] = [];
  for (let li = 0; li <= nLines; li++) {
    const v = vOf(li);
    if (!clip) {
      lines.push([[0, along]]);
      continue;
    }
    lines.push(
      clipLine(toXY(0, v), toXY(along, v))
        .map(([t0, t1]): [number, number] => [t0 * along, t1 * along])
        .filter(([u0, u1]) => u1 - u0 > 1e-6),
    );
  }
  const used = lines.map((l) => l.map(() => false));
  /** Appends a piece from ua to ub on line li, following the surface. */
  const addSpan = (pts: P3[], li: number, ua: number, ub: number) => {
    // Samples on the same grid as an unclipped line, plus the piece's ends.
    const lo = Math.min(ua, ub);
    const hi = Math.max(ua, ub);
    const ks: number[] = [];
    for (let k = Math.ceil((lo * n) / along); k <= Math.floor((hi * n) / along); k++) {
      const u = (k * along) / n;
      if (u > lo + 1e-9 && u < hi - 1e-9) ks.push(u);
    }
    for (const u of [ua, ...(ua < ub ? ks : ks.reverse()), ub]) {
      const [x, y] = toXY(u, vOf(li));
      follow.push(pts, x, y);
    }
  };
  // Zig-zag chains: from the end of a piece, continue on the next line with
  // the nearest unused piece that can be reached without leaving the
  // region; start a new chain (lift) when there is none.
  for (;;) {
    let li = used.findIndex((l) => l.includes(false));
    if (li < 0) break;
    let si = (used[li] as boolean[]).indexOf(false);
    let [ua, ub] = (lines[li] as [number, number][])[si] as [number, number];
    const pts: P3[] = [];
    for (;;) {
      (used[li] as boolean[])[si] = true;
      addSpan(pts, li, ua, ub);
      const end = toXY(ub, vOf(li));
      const next = li + 1;
      let best: [number, number, number] | undefined;
      (lines[next] ?? []).forEach(([u0, u1], j) => {
        if ((used[next] as boolean[])[j]) return;
        const [s, e] = Math.abs(u0 - ub) <= Math.abs(u1 - ub) ? [u0, u1] : [u1, u0];
        const d = Math.abs(s - ub);
        if (best && d >= Math.abs(best[1] - ub)) return;
        if (linkInside(end, toXY(s, vOf(next)))) best = [j, s, e];
      });
      if (!best) break;
      li = next;
      [si, ua, ub] = best;
    }
    emitChain(b, pts);
  }
}

/**
 * Cuts the pieces in order, each following the surface. Consecutive pieces
 * are linked along the surface when the straight move between them is short
 * and stays inside `area`; otherwise the tool lifts.
 */
function emitPieces(
  b: PathBuilder,
  follow: Follower,
  res: number,
  pieces: Vec2[][],
  area: Region,
  maxLink: number,
): void {
  const linkInside = linkTester(area);
  let pts: P3[] = [];
  for (const piece of pieces) {
    const start = piece[0];
    if (!start) continue;
    const last = pts.at(-1);
    if (last) {
      const from: Vec2 = [last[0], last[1]];
      const len = Math.hypot(start[0] - from[0], start[1] - from[1]);
      if (len > maxLink || !linkInside(from, start)) {
        emitChain(b, pts);
        pts = [];
      }
    }
    for (const p of piece) follow.lineTo(pts, p[0], p[1], res);
  }
  emitChain(b, pts);
}

/**
 * Spiral finishing: a circular spiral from outside the area to its centre
 * (the middle of its bounding box), clipped to the area. Inside the area the
 * cut is continuous; where the spiral leaves it, the tool follows the
 * surface straight to where it comes back in, or lifts when that is far or
 * would leave the area.
 */
function emitSpiral(
  b: PathBuilder,
  follow: Follower,
  res: number,
  step: number,
  area: Region,
  maxLink: number,
): void {
  const pts = area.flat();
  if (pts.length === 0) return;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const R = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
  const inside = insideTester(area);
  /** The point nearest the area's edge on the inside, between a (inside) and c (outside). */
  const crossing = (a: Vec2, c: Vec2): Vec2 => {
    let i = a;
    let o = c;
    for (let k = 0; k < 30; k++) {
      const m: Vec2 = [(i[0] + o[0]) / 2, (i[1] + o[1]) / 2];
      if (inside(m[0], m[1])) i = m;
      else o = m;
    }
    return i;
  };
  const pieces: Vec2[][] = [];
  let cur: Vec2[] | undefined;
  let prev: Vec2 | undefined;
  const visit = (p: Vec2) => {
    const pin = inside(p[0], p[1]);
    if (prev && pin !== !!cur) {
      if (pin) {
        cur = [crossing(p, prev)];
        pieces.push(cur);
      } else {
        cur?.push(crossing(prev, p));
        cur = undefined;
      }
    }
    if (pin) {
      if (!cur) pieces.push((cur = []));
      cur.push(p);
    }
    prev = p;
  };
  // Archimedean spiral r = R − step·θ/2π, sampled about every `res` along it.
  for (let theta = 0; ;) {
    const r = R - (step * theta) / (2 * Math.PI);
    if (r <= 0) {
      visit([cx, cy]);
      break;
    }
    visit([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
    theta += Math.min(res / r, Math.PI / 8);
  }
  emitPieces(b, follow, res, pieces, area, maxLink);
}

/**
 * Offset finishing: the area's outline, then rings offset inward from it by
 * the step-over until nothing is left, each following the surface. Each
 * ring starts at its point nearest the end of the last one.
 */
function emitOffsetRings(
  b: PathBuilder,
  follow: Follower,
  res: number,
  step: number,
  area: Region,
  maxLink: number,
): void {
  const pieces: Vec2[][] = [];
  let at: Vec2 | undefined;
  for (let k = 0; ; k++) {
    const rings = (
      k === 0 ? area : offset(area, -k * step, { join: 'round', fill: 'nonZero' })
    ).filter((r) => r.length >= 2);
    if (rings.length === 0) break;
    // Nearest ring first, each closed back to its start.
    while (rings.length) {
      let best = { ri: 0, vi: 0, d: Infinity };
      rings.forEach((ring, ri) =>
        ring.forEach((p, vi) => {
          const d = at ? Math.hypot(p[0] - at[0], p[1] - at[1]) : 0;
          if (d < best.d) best = { ri, vi, d };
        }),
      );
      const ring = rings.splice(best.ri, 1)[0] as Vec2[];
      const loop = [...ring.slice(best.vi), ...ring.slice(0, best.vi + 1)];
      pieces.push(loop);
      at = loop.at(-1);
    }
  }
  emitPieces(b, follow, res, pieces, area, maxLink);
}

/**
 * 3D finishing (plan.md M5, T6.13): raster lines (optionally turned by an
 * angle), a spiral, or offset rings, the tool following the drop-cutter
 * surface. With a boundary, the tool centre stays inside it.
 */
export function emitFinish3d(
  b: PathBuilder,
  pr: PlacedRelief,
  tool: ToolShape & Pick<Tool, 'stepOver'>,
  params: Finish3dParams,
  width: number,
  height: number,
  boundary?: Region,
): void {
  const follow = surfaceFollower(dropCutter(pr, tool));
  const step = params.stepOver ?? tool.stepOver;
  const res = pr.grid.resolution;
  // The material, or the boundary within it.
  const area = () =>
    boundary
      ? booleanOp('intersect', boundary, materialRect(width, height), 'nonZero')
      : materialRect(width, height);
  // Spiral and offset links longer than this lift instead of cutting across.
  const maxLink = Math.max(4 * step, tool.diameter);
  if (params.pattern === 'spiral') {
    emitSpiral(b, follow, res, step, area(), maxLink);
    return;
  }
  if (params.pattern === 'offset') {
    emitOffsetRings(b, follow, res, step, area(), maxLink);
    return;
  }
  const turn = (((params.angle ?? 0) % 180) + 180) % 180;
  const bases = params.pattern === 'xy' ? [0, 90] : [params.pattern === 'x' ? 0 : 90];
  for (const base of bases) {
    const deg = (base + turn) % 180;
    if (deg === 0 || deg === 90) {
      emitRaster(b, follow, res, axisFrame(deg === 0 ? 'x' : 'y', width, height), step, boundary);
    } else {
      const a = area();
      emitRaster(b, follow, res, angleFrame(deg, a), step, a);
    }
  }
}

function materialRect(width: number, height: number): Region {
  return [
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
  ];
}

/** Rest machining cuts where the larger tool left more than this (mm) for the smaller one. */
const REST_MIN = 0.02;

/**
 * 3D rest machining: where the larger tool `restTool` (already run) sits
 * higher than `tool` by more than REST_MIN beyond what the slope explains
 * (so it could not reach material the smaller tool can), grown by the small
 * tool's radius, raster lines along X follow the small tool's surface.
 */
export function emitRest3d(
  b: PathBuilder,
  pr: PlacedRelief,
  tool: ToolShape & Pick<Tool, 'stepOver'>,
  restTool: ToolShape,
  params: Rest3dParams,
  width: number,
  height: number,
  boundary?: Region,
): void {
  const drop = dropCutter(pr, tool);
  const big = dropCutter(pr, restTool);
  const res = pr.grid.resolution;
  const r = tool.diameter / 2;
  // Compare the two surfaces on a grid no finer than the relief's.
  const cell = Math.max(res, Math.min(1, r / 2));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  // Cell centres, kept on the material (past its edge the grid has no support).
  const xOf = (j: number) => Math.min(width, (j + 0.5) * cell);
  const yOf = (i: number) => Math.min(height, (i + 0.5) * cell);
  const small = new Float32Array(cols * rows);
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      small[i * cols + j] = drop.at(xOf(j), yOf(i));
  // On a slope the bigger ball sits higher than the smaller one even where
  // both touch the relief: by (R − r)(1/cos θ − 1) on a plane of slope θ,
  // and less on convex shapes. Only the excess over that means material the
  // bigger tool could not reach (concave corners, narrow grooves).
  const dR = Math.max(0, restTool.diameter / 2 - r);
  // Between cell centres a smaller tool also dips lower into the gaps of the
  // relief grid; that is not material left behind either.
  const grain = Math.max(
    0,
    heightAt(tool, Math.min(r, res)) - heightAt(restTool, Math.min(r, res)),
  );
  const at = (i: number, j: number) =>
    small[Math.min(rows - 1, Math.max(0, i)) * cols + Math.min(cols - 1, Math.max(0, j))] as number;
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const gx = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
      const gy = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
      const slope = dR * (Math.sqrt(1 + gx * gx + gy * gy) - 1);
      const lift = big.at(xOf(j), yOf(i)) - at(i, j);
      if (lift > slope + grain + REST_MIN) mask[i * cols + j] = 1;
    }
  let region = simplify(maskRegion(mask, cols, rows, cell), cell / 4);
  if (region.length === 0) return;
  // Grown by the tool radius, plus half a cell diagonal for positions between samples.
  region = offset(region, r + cell * Math.SQRT1_2, {
    join: 'round',
    fill: 'nonZero',
    arcTolerance: cell / 16,
  });
  region = booleanOp('intersect', region, materialRect(width, height), 'nonZero');
  if (boundary) region = booleanOp('intersect', region, boundary, 'nonZero');
  if (region.length === 0) return;
  const step = params.stepOver ?? tool.stepOver;
  emitRaster(b, surfaceFollower(drop), res, axisFrame('x', width, height), step, region);
}

/** Cell rectangles of a boolean mask (row runs), as a clean region. */
function maskRegion(mask: Uint8Array, cols: number, rows: number, cell: number): Region {
  const rects: Vec2[][] = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!mask[r * cols + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < cols && mask[r * cols + c]) c++;
      const x0 = start * cell;
      const x1 = c * cell;
      const y0 = r * cell;
      const y1 = (r + 1) * cell;
      rects.push([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);
    }
  }
  return rects.length ? normalize(rects, 'nonZero') : [];
}

/**
 * Z-level roughing: at each depth, pocket the area where the tool can reach
 * that depth without coming within `allowance` of the relief. The safe-depth
 * map is sampled on a coarse grid with the tool inflated by half a cell
 * diagonal, so positions between samples are safe too.
 */
export function emitRough3d(
  b: PathBuilder,
  pr: PlacedRelief,
  tool: ToolShape & Pick<Tool, 'stepOver' | 'stepDown'>,
  params: Rough3dParams,
  width: number,
  height: number,
  boundary: Region | undefined,
  warnings: string[],
): void {
  const allowance = params.allowance ?? 0.5;
  const cell = Math.max(pr.grid.resolution, Math.min(1, tool.diameter / 6));
  const drop = dropCutter(pr, tool, cell * Math.SQRT1_2);
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const safe = new Float32Array(cols * rows);
  let lowest = Infinity;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const z = drop.at((c + 0.5) * cell, (r + 0.5) * cell) + allowance;
      safe[r * cols + c] = z;
      lowest = Math.min(lowest, z);
    }
  if (lowest >= pr.top - 1e-6) {
    warnings.push('Nothing to rough: the relief plus allowance is at the top of the material');
    return;
  }
  const levels: number[] = [];
  for (let z = pr.top - tool.stepDown; z > lowest - tool.stepDown + 1e-9; z -= tool.stepDown) {
    levels.push(Math.max(z, lowest));
  }
  const mask = new Uint8Array(cols * rows);
  for (const z of levels) {
    for (let i = 0; i < mask.length; i++) mask[i] = (safe[i] as number) <= z + 1e-9 ? 1 : 0;
    let centres = simplify(maskRegion(mask, cols, rows, cell), cell / 2);
    if (boundary) centres = booleanOp('intersect', centres, boundary, 'nonZero');
    if (centres.length === 0) continue;
    emitPocketCentres(b, centres, tool, { depth: 0, strategy: 'offset' }, [z]);
  }
}
