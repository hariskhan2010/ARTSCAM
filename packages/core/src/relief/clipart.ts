/**
 * Starter clipart library (plan.md T6.10): a few small relief pieces made from
 * simple formulas at run time, so the app ships no binary files. Each clip is
 * a height grid (row 0 at the bottom) peaking at 1; a paste scales it to the
 * height the user picks.
 */

export interface Clip {
  cols: number;
  rows: number;
  z: Float32Array;
}

export interface StarterClip {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** Height at clip coordinates x ∈ [-1, 1] across, y ∈ [-1, 1] up (≥ 0). */
  shape: (x: number, y: number) => number;
}

const dome = (t: number) => (t < 1 ? Math.sqrt(1 - t * t) : 0);

export const STARTER_CLIPS: readonly StarterClip[] = [
  {
    id: 'rosette',
    name: 'Rosette',
    cols: 128,
    rows: 128,
    shape: (x, y) => {
      // Eight rounded petals around a raised centre button.
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const petal = Math.abs(Math.cos(4 * a));
      const edge = 0.95 * (0.55 + 0.45 * Math.pow(petal, 0.6));
      const petals = 0.65 * dome(r / edge) * (0.75 + 0.25 * petal);
      return Math.max(petals, dome(r / 0.22));
    },
  },
  {
    id: 'leaf',
    name: 'Leaf',
    cols: 128,
    rows: 64,
    shape: (x, y) => {
      // Pointed at both ends, with a groove down the middle vein.
      const half = 0.95 * Math.pow(Math.max(0, 1 - x * x), 0.75);
      if (half <= 0) return 0;
      const body = dome(Math.abs(y) / half) * Math.sqrt(Math.max(0, 1 - x * x));
      const vein = 0.2 * Math.exp(-((y / 0.06) ** 2)) * (Math.abs(x) < 0.95 ? 1 : 0);
      return Math.max(0, body - vein);
    },
  },
  {
    id: 'shell',
    name: 'Shell',
    cols: 128,
    rows: 112,
    shape: (x, y) => {
      // A scallop: ribs fanning out from a hinge at the bottom, wavy rim.
      const hx = x;
      const hy = y + 0.95;
      const r = Math.hypot(hx, hy);
      const a = Math.atan2(hx, hy); // 0 straight up
      if (Math.abs(a) > 1.2) return 0;
      const rim = 1.85 * (1 - 0.04 * (1 - Math.cos(11 * a)));
      if (r >= rim) return 0;
      const fan = dome(r / rim) * Math.cos(a * 0.9);
      const ribs = 0.8 + 0.2 * Math.cos(11 * a);
      return Math.max(0, fan * ribs * Math.min(1, r / 0.25));
    },
  },
  {
    id: 'bead',
    name: 'Bead',
    cols: 64,
    rows: 64,
    shape: (x, y) => dome(Math.hypot(x, y) / 0.95),
  },
];

/** Builds a starter clip's grid, normalised so its highest point is 1. */
export function makeStarterClip(id: string): Clip | undefined {
  const s = STARTER_CLIPS.find((c) => c.id === id);
  if (!s) return undefined;
  const z = new Float32Array(s.cols * s.rows);
  let max = 0;
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++) {
      const h = s.shape(((c + 0.5) / s.cols) * 2 - 1, ((r + 0.5) / s.rows) * 2 - 1);
      z[r * s.cols + c] = h;
      max = Math.max(max, h);
    }
  if (max > 0) for (let i = 0; i < z.length; i++) z[i] = (z[i] as number) / max;
  return { cols: s.cols, rows: s.rows, z };
}

/**
 * Placement rectangle for a clip of `aspect` (width / height): centred on the
 * material, as large as fits in a third of its width and height.
 */
export function defaultClipPlacement(
  stock: { width: number; height: number },
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  const bw = stock.width / 3;
  const bh = stock.height / 3;
  const w = Math.min(bw, bh * aspect);
  const h = w / aspect;
  return { x: (stock.width - w) / 2, y: (stock.height - h) / 2, w, h };
}
