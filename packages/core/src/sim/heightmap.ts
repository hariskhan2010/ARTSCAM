import { heightAt, radiusAt } from '../cam/tools';
import { stockBounds } from '../gcode/checker';
import type { GcodeProgram } from '../gcode/parser';
import type { Stock, Tool } from '../model/schema';

/**
 * Stock simulation on a heightmap (plan.md T2.6 / §4 "Simulation"): the top
 * of the stock is a grid of Z values; every move sweeps the tool shape (flat,
 * ball, V, tapered ball) through it and lowers the cells it passes. Reads the
 * parsed G-code, so it shows what the machine would do with the exported file.
 */

export interface Heightmap {
  /** Work-coordinate X/Y of cell (0, 0)'s centre. */
  x0: number;
  y0: number;
  /** Cell size (mm). */
  cell: number;
  cols: number;
  rows: number;
  /** Row-major, row 0 at y0 (bottom). */
  z: Float32Array;
  /** Stock top Z. */
  top: number;
  bottom: number;
}

export interface SimOptions {
  /** Cell size (mm). Default: chosen so the grid has at most `maxCells` cells. */
  cell?: number;
  maxCells?: number;
}

export function createHeightmap(
  stock: Pick<Stock, 'width' | 'height' | 'thickness' | 'origin' | 'zZero'>,
  options: SimOptions = {},
): Heightmap {
  const b = stockBounds(stock);
  const maxCells = options.maxCells ?? 1_000_000;
  const cell = options.cell ?? Math.max(0.05, Math.sqrt((stock.width * stock.height) / maxCells));
  const cols = Math.max(1, Math.ceil(stock.width / cell));
  const rows = Math.max(1, Math.ceil(stock.height / cell));
  const z = new Float32Array(cols * rows).fill(b.max[2]);
  return {
    x0: b.min[0] + cell / 2,
    y0: b.min[1] + cell / 2,
    cell,
    cols,
    rows,
    z,
    top: b.max[2],
    bottom: b.min[2],
  };
}

/**
 * Lowers cells under the tool tip at (x, y, z). Only the part of the tool
 * below the stock top can cut, so the footprint is the tool radius at that
 * height (exact; for a V-bit near the surface this is far smaller than R).
 */
function stamp(
  hm: Heightmap,
  R: number,
  x: number,
  y: number,
  z: number,
  profile: Float32Array,
  step: number,
) {
  if (z >= hm.top) return;
  const c0 = Math.max(0, Math.floor((x - R - hm.x0) / hm.cell));
  const c1 = Math.min(hm.cols - 1, Math.ceil((x + R - hm.x0) / hm.cell));
  const r0 = Math.max(0, Math.floor((y - R - hm.y0) / hm.cell));
  const r1 = Math.min(hm.rows - 1, Math.ceil((y + R - hm.y0) / hm.cell));
  for (let r = r0; r <= r1; r++) {
    const cy = hm.y0 + r * hm.cell - y;
    for (let c = c0; c <= c1; c++) {
      const cx = hm.x0 + c * hm.cell - x;
      const d = Math.hypot(cx, cy);
      if (d > R) continue;
      const h = profile[Math.min(profile.length - 1, Math.round(d / step))] as number;
      const zz = z + h;
      const i = r * hm.cols + c;
      if (zz < (hm.z[i] as number)) hm.z[i] = zz;
    }
  }
}

/**
 * Exact sweep of a level move a→b at height z: every cell within `R` of the
 * segment is lowered to z + tool height at its distance from the segment.
 */
function sweepLevel(
  hm: Heightmap,
  R: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z: number,
  profile: Float32Array,
  step: number,
) {
  const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - hm.x0) / hm.cell));
  const c1 = Math.min(hm.cols - 1, Math.ceil((Math.max(ax, bx) + R - hm.x0) / hm.cell));
  const r0 = Math.max(0, Math.floor((Math.min(ay, by) - R - hm.y0) / hm.cell));
  const r1 = Math.min(hm.rows - 1, Math.ceil((Math.max(ay, by) + R - hm.y0) / hm.cell));
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  for (let r = r0; r <= r1; r++) {
    const py = hm.y0 + r * hm.cell;
    for (let c = c0; c <= c1; c++) {
      const px = hm.x0 + c * hm.cell;
      let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > R) continue;
      const zz = z + (profile[Math.min(profile.length - 1, Math.round(d / step))] as number);
      const i = r * hm.cols + c;
      if (zz < (hm.z[i] as number)) hm.z[i] = zz;
    }
  }
}

/** Sweeps every move of the program through the heightmap (in place). */
export function simulate(
  hm: Heightmap,
  program: GcodeProgram,
  tool: Pick<Tool, 'type' | 'diameter' | 'angle' | 'tipDiameter'>,
): Heightmap {
  const R = tool.diameter / 2;
  // Tool profile lookup: height above tip vs radius.
  const step = Math.min(hm.cell / 4, R / 64);
  const profile = new Float32Array(Math.ceil(R / step) + 2);
  for (let i = 0; i < profile.length; i++)
    profile[i] = Math.min(heightAt(tool, Math.min(i * step, R)), 1e6);
  const spacing = hm.cell / 2;
  for (const m of program.moves) {
    let prev = m.from;
    for (const p of m.points) {
      const [fx, fy, fz] = prev;
      const [tx, ty, tz] = p;
      prev = p;
      if (fx === null || fy === null || fz === null || tx === null || ty === null || tz === null)
        continue;
      if (Math.min(fz, tz) >= hm.top) continue;
      const len = Math.hypot(tx - fx, ty - fy);
      if (Math.abs(tz - fz) < 1e-9) {
        // Level move: exact sweep.
        const reach = Math.min(R, radiusAt(tool, hm.top - fz) + hm.cell);
        sweepLevel(hm, reach, fx, fy, tx, ty, fz, profile, step);
        continue;
      }
      if (len < 1e-9) {
        // Straight up or down: the lowest point cuts everything.
        const zz = Math.min(fz, tz);
        stamp(hm, Math.min(R, radiusAt(tool, hm.top - zz) + hm.cell), fx, fy, zz, profile, step);
        continue;
      }
      // Sloped (ramps): sample along the move.
      const n = Math.max(1, Math.ceil(len / spacing));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const zz = fz + (tz - fz) * t;
        const reach = Math.min(R, radiusAt(tool, hm.top - zz) + hm.cell);
        stamp(hm, reach, fx + (tx - fx) * t, fy + (ty - fy) * t, zz, profile, step);
      }
    }
  }
  return hm;
}
