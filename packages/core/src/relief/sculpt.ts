import type { ReliefOp } from '../model/schema';
import type { Vec2 } from '../vector/path';
import { boxBlur, type Grid } from './relief';

/**
 * Sculpt brushes (plan.md T6.5). A stroke's weight at a cell is the brush
 * falloff at the cell's distance to the stroke path (smooth, 1 at the path, 0
 * at the radius), so overlapping stamps never pile up: a stroke changes a
 * height by at most its strength, and nothing beyond its radius.
 */

type SculptOp = Extract<ReliefOp, { op: 'sculpt' }>;

/** Distance from p to segment a–b. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Brush weight (0 … 1) per cell. */
function strokeWeights(g: Grid, op: SculptOp): Float32Array {
  const w = new Float32Array(g.cols * g.rows);
  const R = op.radius;
  const res = g.resolution;
  const pts = op.points as Vec2[];
  const segs: [Vec2, Vec2][] =
    pts.length === 1
      ? [[pts[0] as Vec2, pts[0] as Vec2]]
      : pts.slice(1).map((p, i) => [pts[i] as Vec2, p]);
  for (const [a, b] of segs) {
    const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - R) / res));
    const c1 = Math.min(g.cols - 1, Math.ceil((Math.max(a[0], b[0]) + R) / res));
    const r0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - R) / res));
    const r1 = Math.min(g.rows - 1, Math.ceil((Math.max(a[1], b[1]) + R) / res));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const d = segDist([(c + 0.5) * res, (r + 0.5) * res], a, b) / R;
        if (d >= 1) continue;
        const f = (1 - d * d) ** 2;
        const k = r * g.cols + c;
        if (f > (w[k] as number)) w[k] = f;
      }
  }
  return w;
}

export function applySculpt(g: Grid, op: SculptOp): void {
  const w = strokeWeights(g, op);
  const z = g.z;
  if (op.tool === 'smooth') {
    const blurred = Float32Array.from(z);
    boxBlur(blurred, g.cols, g.rows, op.radius / 3 / g.resolution, 3);
    const s = Math.min(1, op.strength);
    for (let k = 0; k < z.length; k++) {
      const f = (w[k] as number) * s;
      if (f > 0) z[k] = (z[k] as number) + ((blurred[k] as number) - (z[k] as number)) * f;
    }
    return;
  }
  const sign = op.tool === 'raise' ? 1 : -1;
  for (let k = 0; k < z.length; k++) {
    const f = w[k] as number;
    if (f > 0) z[k] = (z[k] as number) + sign * op.strength * f;
  }
}
