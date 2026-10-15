import type { Tool, Toolpath } from '../model/schema';
import { heightAt } from './tools';
import type { Grid } from '../relief/relief';
import { booleanOp, clipLines, normalize, offset, simplify, type Region } from '../vector/clip';
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

/**
 * Raster finishing: parallel lines, zig-zag, the tool following the
 * drop-cutter surface; links between lines also follow the surface, so the
 * whole pass is one continuous cut.
 *
 * With a boundary, the tool centre stays inside it: each line is clipped to
 * the boundary, and a link follows the surface only when it stays inside too;
 * otherwise the tool lifts and moves to the next piece.
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
  const drop = dropCutter(pr, tool);
  const step = params.stepOver ?? tool.stepOver;
  /**
   * Where the safe surface rises above the straight move between two samples
   * (steep walls), insert midpoints until the move stays above it.
   */
  const refine = (
    a: [number, number, number],
    c: [number, number, number],
    out: [number, number, number][],
    depth: number,
  ) => {
    const mx = (a[0] + c[0]) / 2;
    const my = (a[1] + c[1]) / 2;
    const mz = drop.at(mx, my);
    if (depth >= 8 || mz <= (a[2] + c[2]) / 2 + REFINE_TOL) return;
    const m: [number, number, number] = [mx, my, mz];
    refine(a, m, out, depth + 1);
    out.push(m);
    refine(m, c, out, depth + 1);
  };
  const res = pr.grid.resolution;
  // Links may run exactly along the boundary edge; test them against the
  // boundary grown by a hair so an edge counts as inside.
  const linkRegion = boundary?.length
    ? offset(boundary, LINK_TOL, { join: 'miter', fill: 'nonZero' })
    : [];
  /** True when the straight XY move a → c stays inside the boundary. */
  const linkInside = (a: Vec2, c: Vec2) => {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (!boundary || len < 1e-9) return true;
    const pieces = linkRegion.length ? clipLines([[a, c]], linkRegion) : [];
    const inside = pieces.reduce((s, q) => {
      for (let i = 1; i < q.length; i++) {
        const p0 = q[i - 1] as Vec2;
        const p1 = q[i] as Vec2;
        s += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      }
      return s;
    }, 0);
    return pieces.length === 1 && inside >= len - 1e-3;
  };
  const emitChain = (pts: [number, number, number][]) => {
    if (pts.length === 0) return;
    const path = simplify3(pts);
    const first = path[0] as [number, number, number];
    b.travelTo([first[0], first[1]]);
    b.plungeTo(first[2]);
    for (const p of path) b.cutTo([p[0], p[1]], p[2]);
    b.retract();
  };
  const passes: ('x' | 'y')[] = params.pattern === 'xy' ? ['x', 'y'] : [params.pattern];
  for (const dir of passes) {
    const along = dir === 'x' ? width : height;
    const across = dir === 'x' ? height : width;
    const nLines = Math.max(1, Math.round(across / step));
    const n = Math.max(1, Math.ceil(along / res));
    const toXY = (u: number, v: number): Vec2 => (dir === 'x' ? [u, v] : [v, u]);
    const vOf = (li: number) => (li * across) / nLines;
    // Each line's pieces as [u0, u1] (u0 < u1) along it.
    const lines: [number, number][][] = [];
    for (let li = 0; li <= nLines; li++) {
      const v = vOf(li);
      if (!boundary) {
        lines.push([[0, along]]);
        continue;
      }
      const uOf = (p: Vec2) => (dir === 'x' ? p[0] : p[1]);
      lines.push(
        clipLines([[toXY(0, v), toXY(along, v)]], boundary)
          .map((q): [number, number] => {
            const us = q.map(uOf);
            return [Math.max(0, Math.min(...us)), Math.min(along, Math.max(...us))];
          })
          .filter(([u0, u1]) => u1 - u0 > 1e-6)
          .sort((s, t) => s[0] - t[0]),
      );
    }
    const used = lines.map((l) => l.map(() => false));
    /** Appends a piece from ua to ub on line li, following the surface. */
    const addSpan = (pts: [number, number, number][], li: number, ua: number, ub: number) => {
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
        const p: [number, number, number] = [x, y, drop.at(x, y)];
        const last = pts.at(-1);
        if (last && last[0] === x && last[1] === y) continue;
        if (last) refine(last, p, pts, 0);
        pts.push(p);
      }
    };
    // Zig-zag chains: from the end of a piece, continue on the next line with
    // the nearest unused piece that can be reached without leaving the
    // boundary; start a new chain (lift) when there is none.
    for (;;) {
      let li = used.findIndex((l) => l.includes(false));
      if (li < 0) break;
      let si = (used[li] as boolean[]).indexOf(false);
      let [ua, ub] = (lines[li] as [number, number][])[si] as [number, number];
      const pts: [number, number, number][] = [];
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
      emitChain(pts);
    }
  }
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
