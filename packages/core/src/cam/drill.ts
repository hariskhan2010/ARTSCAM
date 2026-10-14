import type { Toolpath, Vector } from '../model/schema';
import { bbox, type Vec2 } from '../vector/path';
import { APPROACH_CLEARANCE, PathBuilder, passDepths } from './builder';

/**
 * Drilling (plan.md T2.4): one hole at the centre of each vector's bounding
 * box (circles drawn for holes), visited nearest-first. Peck drilling feeds
 * down one peck, rapids out above the stock to clear chips, and feeds back
 * down to just above the last depth. Canned cycles (G81–G83) are not used:
 * GRBL does not support them.
 */

export type DrillParams = Extract<Toolpath, { type: 'drill' }>['params'];

/** How far above the previous peck depth the re-entry slows to plunge rate (mm). */
const PECK_REENTRY_GAP = 0.5;

export function drillPoints(vectors: readonly Vector[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const v of vectors) {
    const b = bbox(v.segments);
    if (b) pts.push([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]);
  }
  // Nearest-neighbour order from the origin.
  const out: Vec2[] = [];
  let at: Vec2 = [0, 0];
  const left = [...pts];
  while (left.length) {
    let best = 0;
    left.forEach((p, i) => {
      const q = left[best] as Vec2;
      if (Math.hypot(p[0] - at[0], p[1] - at[1]) < Math.hypot(q[0] - at[0], q[1] - at[1])) best = i;
    });
    at = left.splice(best, 1)[0] as Vec2;
    out.push(at);
  }
  return out;
}

export function emitDrill(b: PathBuilder, points: readonly Vec2[], params: DrillParams): void {
  const bottom = b.topZ - params.depth;
  const above = b.topZ + APPROACH_CLEARANCE;
  for (const p of points) {
    b.travelTo(p);
    const depths = params.peck ? passDepths(b.topZ, params.depth, params.peck) : [bottom];
    let reached = b.topZ;
    depths.forEach((z, i) => {
      if (i > 0) {
        // Clear chips, then come back down: rapid only above the stock, feed inside the hole.
        b.rapidUp(above);
        b.plungeTo(reached + PECK_REENTRY_GAP);
      }
      b.plungeTo(z);
      reached = z;
    });
    if (params.dwell) b.dwell(params.dwell);
    b.retract();
  }
}
