import type { ReliefOp } from '../model/schema';

/**
 * Textures (plan.md T6.4): repeating height patterns, 0 to `height`, at
 * `spacing`, turned by `angle`. Every pattern is a pure function of position,
 * so a texture rebuilds the same every time.
 */

type TextureOp = Extract<ReliefOp, { op: 'texture' }>;

/** Deterministic pseudo-random number in [0, 1) for integer cell (i, j) and a salt. */
function hash(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(salt, 0x5bd1e995);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Height (0 … 1) of a pattern at pattern coordinates (u, v), in repeats. */
function unitHeight(pattern: TextureOp['pattern'], u: number, v: number): number {
  switch (pattern) {
    case 'lines':
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    case 'dimples': {
      // A round bump in the middle of every repeat cell.
      const du = u - Math.floor(u) - 0.5;
      const dv = v - Math.floor(v) - 0.5;
      const d = Math.hypot(du, dv) / 0.45;
      return d < 1 ? Math.sqrt(1 - d * d) : 0;
    }
    case 'hammered': {
      // Overlapping shallow domes on a jittered grid: the highest one wins.
      const i0 = Math.floor(u);
      const j0 = Math.floor(v);
      let best = 0;
      for (let i = i0 - 1; i <= i0 + 1; i++)
        for (let j = j0 - 1; j <= j0 + 1; j++) {
          const cu = i + 0.15 + 0.7 * hash(i, j, 1);
          const cv = j + 0.15 + 0.7 * hash(i, j, 2);
          const r = 0.75 + 0.25 * hash(i, j, 3);
          const d = Math.hypot(u - cu, v - cv) / r;
          if (d < 1) best = Math.max(best, Math.sqrt(1 - d * d));
        }
      return best;
    }
    case 'weave': {
      // Checkerboard of tiles, three rounded strands each, alternating direction.
      const i = Math.floor(u);
      const j = Math.floor(v);
      const across = (i + j) % 2 === 0 ? v - j : u - i;
      return Math.sin(Math.PI * ((across * 3) % 1));
    }
  }
}

export interface TextureTarget {
  cols: number;
  rows: number;
  resolution: number;
  /** Cells to change (undefined: all). */
  mask: Uint8Array | undefined;
  put(i: number, h: number): void;
}

export function applyTexture(t: TextureTarget, op: TextureOp): void {
  const a = ((op.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const s = op.spacing;
  for (let r = 0; r < t.rows; r++) {
    const y = (r + 0.5) * t.resolution;
    for (let c = 0; c < t.cols; c++) {
      const k = r * t.cols + c;
      if (t.mask && !t.mask[k]) continue;
      const x = (c + 0.5) * t.resolution;
      // Pattern coordinates: the world turned back by the angle, in repeats.
      const u = (x * cos + y * sin) / s;
      const v = (-x * sin + y * cos) / s;
      t.put(k, op.height * unitHeight(op.pattern, u, v));
    }
  }
}
