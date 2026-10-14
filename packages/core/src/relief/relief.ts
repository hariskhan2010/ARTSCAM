import type { Project, Relief, ReliefOp, Stock } from '../model/schema';
import { flatten } from '../vector/flatten';
import type { Vec2 } from '../vector/path';

/**
 * Relief engine (plan.md M4 / T4.1–T4.2). A relief is a height grid laid over
 * the material: cell (col, row) has its centre at ((col + ½)·res,
 * (row + ½)·res) in world mm, row 0 at the bottom. Heights are mm above the
 * relief base. The grid is rebuilt from the relief's ops, in order, starting
 * from zero, so it is derived data like a toolpath.
 */

export interface Grid {
  cols: number;
  rows: number;
  /** mm per cell. */
  resolution: number;
  z: Float32Array;
}

/** Grid size that covers the material at `resolution` mm per cell. */
export function reliefSize(stock: Pick<Stock, 'width' | 'height'>, resolution: number) {
  if (!(resolution > 0)) throw new RangeError('resolution must be > 0');
  return {
    cols: Math.max(1, Math.ceil(stock.width / resolution)),
    rows: Math.max(1, Math.ceil(stock.height / resolution)),
  };
}

/** Cell-index bounds [c0, c1] × [r0, r1] (inclusive) touched by rings, with a margin. */
function ringBounds(rings: readonly Vec2[][], g: Grid, margin = 1) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  const res = g.resolution;
  return {
    c0: Math.max(0, Math.floor(minX / res) - margin),
    c1: Math.min(g.cols - 1, Math.ceil(maxX / res) + margin),
    r0: Math.max(0, Math.floor(minY / res) - margin),
    r1: Math.min(g.rows - 1, Math.ceil(maxY / res) + margin),
    empty: !Number.isFinite(minX),
  };
}

/** Even-odd scanline fill of cell centres; returns a full-grid mask. */
export function rasterize(rings: readonly Vec2[][], g: Grid): Uint8Array {
  const mask = new Uint8Array(g.cols * g.rows);
  const b = ringBounds(rings, g, 0);
  if (b.empty) return mask;
  const res = g.resolution;
  for (let row = b.r0; row <= b.r1; row++) {
    const y = (row + 0.5) * res;
    const xs: number[] = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i] as Vec2;
        const c = ring[j] as Vec2;
        if (a[1] > y !== c[1] > y) xs.push(a[0] + ((y - a[1]) * (c[0] - a[0])) / (c[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] as number) / res - 0.5));
      const c1 = Math.min(g.cols - 1, Math.floor((xs[k + 1] as number) / res - 0.5));
      for (let c = c0; c <= c1; c++) mask[row * g.cols + c] = 1;
    }
  }
  return mask;
}

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, zz: Float64Array) {
  let k = 0;
  v[0] = 0;
  zz[0] = -Infinity;
  zz[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const vk = v[k] as number;
      s = ((f[q] as number) + q * q - ((f[vk] as number) + vk * vk)) / (2 * q - 2 * vk);
      if (s > (zz[k] as number)) break;
      k--;
    }
    k++;
    v[k] = q;
    zz[k] = s;
    zz[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((zz[k + 1] as number) < q) k++;
    const vk = v[k] as number;
    d[q] = (q - vk) * (q - vk) + (f[vk] as number);
  }
}

/**
 * Distance (mm) from each inside cell to the region's edge, 0 outside. Exact
 * Euclidean transform on cell centres, corrected by half a cell so a cell
 * next to the edge reads ½·res.
 */
export function distanceInside(mask: Uint8Array, g: Grid, rings: readonly Vec2[][]): Float32Array {
  const out = new Float32Array(g.cols * g.rows);
  const b = ringBounds(rings, g, 2);
  if (b.empty) return out;
  const W = b.c1 - b.c0 + 1;
  const H = b.r1 - b.r0 + 1;
  const n = Math.max(W, H);
  const INF = 1e20;
  const grid = new Float64Array(W * H);
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) grid[r * W + c] = mask[(r + b.r0) * g.cols + c + b.c0] ? INF : 0;
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const zz = new Float64Array(n + 1);
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) f[r] = grid[r * W + c] as number;
    edt1d(f, H, d, v, zz);
    for (let r = 0; r < H; r++) grid[r * W + c] = d[r] as number;
  }
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) f[c] = grid[r * W + c] as number;
    edt1d(f, W, d, v, zz);
    for (let c = 0; c < W; c++) {
      const i = (r + b.r0) * g.cols + c + b.c0;
      if (mask[i]) out[i] = Math.max(0.5, Math.sqrt(d[c] as number) - 0.5) * g.resolution;
    }
  }
  return out;
}

/** Height of a profile at distance d from the edge. */
export function profileHeight(
  op: Extract<ReliefOp, { op: 'fromVector' }>,
  d: number,
  dMax: number,
): number {
  const H = op.height;
  let h: number;
  switch (op.profile) {
    case 'flat':
      h = H;
      break;
    case 'dome': {
      const t = dMax > 0 ? Math.min(1, d / dMax) : 1;
      h = H * Math.sqrt(1 - (1 - t) * (1 - t));
      break;
    }
    case 'angle': {
      const slope = Math.tan((((op.angle ?? 45) * Math.PI) / 180) as number);
      h = H > 0 ? Math.min(d * slope, H) : d * slope;
      break;
    }
    case 'round': {
      const r = Math.abs(H);
      h = Math.sign(H) * (d >= r ? r : Math.sqrt(r * r - (r - d) * (r - d)));
      break;
    }
  }
  return h + (op.base ?? 0);
}

type Mode = Extract<ReliefOp, { op: 'fromVector' }>['mode'];

function combineAt(z: Float32Array, i: number, h: number, mode: Mode) {
  const cur = z[i] as number;
  switch (mode) {
    case 'add':
      z[i] = cur + h;
      break;
    case 'subtract':
      z[i] = cur - h;
      break;
    case 'mergeHigh':
      z[i] = Math.max(cur, h);
      break;
    case 'mergeLow':
      z[i] = Math.min(cur, h);
      break;
    case 'zero':
      z[i] = 0;
      break;
  }
}

/** Separable box blur (radius in cells), `passes` times (3 passes ≈ Gaussian). */
export function boxBlur(
  z: Float32Array,
  cols: number,
  rows: number,
  radius: number,
  passes: number,
) {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(z.length);
  for (let p = 0; p < passes; p++) {
    for (let row = 0; row < rows; row++) {
      const o = row * cols;
      let sum = 0;
      for (let c = -r; c <= r; c++) sum += z[o + Math.min(cols - 1, Math.max(0, c))] as number;
      for (let c = 0; c < cols; c++) {
        tmp[o + c] = sum / (2 * r + 1);
        sum +=
          (z[o + Math.min(cols - 1, c + r + 1)] as number) - (z[o + Math.max(0, c - r)] as number);
      }
    }
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++)
        sum += tmp[Math.min(rows - 1, Math.max(0, k)) * cols + c] as number;
      for (let row = 0; row < rows; row++) {
        z[row * cols + c] = sum / (2 * r + 1);
        sum +=
          (tmp[Math.min(rows - 1, row + r + 1) * cols + c] as number) -
          (tmp[Math.max(0, row - r) * cols + c] as number);
      }
    }
  }
}

/** Grayscale image (0–255, row 0 at the top as stored) sampled bilinearly at u, v ∈ [0, 1] (v up). */
function sampleImage(px: Uint8Array, w: number, h: number, u: number, v: number): number {
  const x = Math.min(w - 1, Math.max(0, u * w - 0.5));
  const y = Math.min(h - 1, Math.max(0, (1 - v) * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) => (px[yy * w + xx] ?? 0) as number;
  return (
    (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) +
    (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
  );
}

export class ReliefError extends Error {
  override name = 'ReliefError';
}

/** Grayscale image bytes by image id (images/<id>.gray in the project zip). */
export type ReliefImages = Readonly<Record<string, Uint8Array>>;

/** Rebuilds a relief's height grid from its ops. */
export function evaluateRelief(relief: Relief, project: Project, images: ReliefImages = {}): Grid {
  const g: Grid = {
    cols: relief.cols,
    rows: relief.rows,
    resolution: relief.resolution,
    z: new Float32Array(relief.cols * relief.rows),
  };
  for (const op of relief.ops) applyOp(g, op, project, images);
  return g;
}

export function applyOp(g: Grid, op: ReliefOp, project: Project, images: ReliefImages = {}): void {
  const { z, cols, rows, resolution: res } = g;
  switch (op.op) {
    case 'fromVector': {
      const v = project.vectors.find((x) => x.id === op.vector);
      if (!v) throw new ReliefError(`Relief uses unknown vector "${op.vector}"`);
      if (!v.closed) throw new ReliefError('Only closed shapes can make a relief');
      const rings = flatten(v.segments, Math.min(0.02, res / 4), true).map((p) => p.points);
      const mask = rasterize(rings, g);
      const dist =
        op.profile === 'flat' || op.mode === 'zero' ? undefined : distanceInside(mask, g, rings);
      let dMax = 0;
      if (dist) for (let i = 0; i < dist.length; i++) dMax = Math.max(dMax, dist[i] as number);
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        combineAt(z, i, profileHeight(op, dist ? (dist[i] as number) : 0, dMax), op.mode);
      }
      return;
    }
    case 'fromImage': {
      const px = images[op.image];
      if (!px || px.length !== op.px * op.py) throw new ReliefError(`Missing image "${op.image}"`);
      let src = px;
      if (op.blur && op.blur > 0) {
        const f = Float32Array.from(px);
        boxBlur(f, op.px, op.py, (op.blur / op.w) * op.px, 3);
        src = Uint8Array.from(f, (x) => Math.round(x));
      }
      const c0 = Math.max(0, Math.floor(op.x / res));
      const c1 = Math.min(cols - 1, Math.ceil((op.x + op.w) / res));
      const r0 = Math.max(0, Math.floor(op.y / res));
      const r1 = Math.min(rows - 1, Math.ceil((op.y + op.h) / res));
      for (let r = r0; r <= r1; r++) {
        const v = ((r + 0.5) * res - op.y) / op.h;
        if (v < 0 || v > 1) continue;
        for (let c = c0; c <= c1; c++) {
          const u = ((c + 0.5) * res - op.x) / op.w;
          if (u < 0 || u > 1) continue;
          const t = sampleImage(src, op.px, op.py, u, v) / 255;
          combineAt(z, r * cols + c, op.height * (op.invert ? 1 - t : t), op.mode);
        }
      }
      return;
    }
    case 'smooth':
      boxBlur(z, cols, rows, op.radius / res, op.passes);
      return;
    case 'scale':
      for (let i = 0; i < z.length; i++) z[i] = (z[i] as number) * op.factor;
      return;
    case 'offset':
      for (let i = 0; i < z.length; i++) z[i] = (z[i] as number) + op.amount;
      return;
    case 'invert': {
      let max = -Infinity;
      for (let i = 0; i < z.length; i++) max = Math.max(max, z[i] as number);
      for (let i = 0; i < z.length; i++) z[i] = max - (z[i] as number);
      return;
    }
  }
}

/** Highest and lowest heights of a grid. */
export function gridRange(z: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < z.length; i++) {
    const v = z[i] as number;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
}
