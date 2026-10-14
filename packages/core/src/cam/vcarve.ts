import type { Tool, Toolpath } from '../model/schema';
import { clipLinesOutside, offset, type Region } from '../vector/clip';
import type { Vec2 } from '../vector/path';
import { PathBuilder, cumulative, cutContour, passDepths, pointAtDistance } from './builder';
import { linkInside, startNearest } from './pocket';

/**
 * V-carving (plan.md T3.4).
 *
 * Geometry: a V-bit whose tip runs along the outline inset by distance d, at
 * depth d / tan(½·angle), touches the outline exactly, and its cone cuts every
 * point between that ring and the outline to its exact depth (distance to the
 * edge / tan(½·angle)). So rings at d = step, 2·step, … carve the ideal V
 * surface; near the centre line the spacing is halved a few times. Where the
 * shape is wider than the depth allows, the bottom is cut flat at `depth`.
 *
 * Economy: a point of ring d is already cut exactly by the next ring
 * (d + s) when that ring passes within s of it at its full depth, so only the
 * parts of each ring near the centre line are kept ("pieces"). That is sound
 * only while the next ring is cut at its exact depth; when a depth pass clamps
 * it to the pass floor, the whole ring is cut instead.
 */

export type VcarveParams = Extract<Toolpath, { type: 'vcarve' }>['params'];

export const DEFAULT_VCARVE_STEP = 0.1;
/** Times the last ring spacing is halved to approach the centre line. */
const REFINE = 3;
/** Slack (mm) on the coverage test so rounding never drops a needed point. */
const COVER_SLACK = 1e-3;
/**
 * Pieces of one ring closer than this along the ring are joined: feeding
 * along an already-exact groove is cheaper than lifting out and plunging back.
 */
const JOIN_GAP = 15;

/** Distance along a closed ring to the point nearest p. */
function locate(points: readonly Vec2[], cum: readonly number[], p: Vec2): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < bestD) {
      bestD = d;
      best = (cum[i] as number) + t * Math.sqrt(len2);
    }
  }
  return best;
}

/** The part of a closed ring from distance a to b (b may exceed the length: wraps). */
function subRing(points: readonly Vec2[], cum: readonly number[], a: number, b: number): Vec2[] {
  const L = cum.at(-1) as number;
  const out: Vec2[] = [pointAtDistance(points, cum, true, a)];
  for (let lap = 0; lap <= 1; lap++) {
    for (let i = 0; i < points.length; i++) {
      const s = (cum[i] as number) + lap * L;
      if (s > a && s < b) out.push(points[i] as Vec2);
    }
  }
  out.push(pointAtDistance(points, cum, true, b));
  return out;
}

/**
 * Joins uncovered pieces of a ring across small gaps. Returns undefined when
 * what is left is (nearly) the whole ring.
 */
function joinPieces(points: Vec2[], pieces: Vec2[][]): Vec2[][] | undefined {
  if (pieces.length === 0) return [];
  const cum = cumulative(points, true);
  const L = cum.at(-1) as number;
  const spans = pieces
    .map((pc) => {
      const a = locate(points, cum, pc[0] as Vec2);
      let b = locate(points, cum, pc.at(-1) as Vec2);
      if (b <= a) b += L;
      return [a, b] as [number, number];
    })
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const sp of spans) {
    const last = merged.at(-1);
    if (last && sp[0] - last[1] <= JOIN_GAP) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  // Wrap-around: join the last span to the first.
  const first = merged[0] as [number, number];
  const last = merged.at(-1) as [number, number];
  if (merged.length > 1 && first[0] + L - last[1] <= JOIN_GAP) {
    first[0] = last[0] - L;
    merged.pop();
  }
  const covered = merged.reduce((t, [a, b]) => t + (b - a), 0);
  if (covered >= L - JOIN_GAP) return undefined;
  return merged.map(([a, b]) => subRing(points, cum, (a + L) % L, ((a + L) % L) + (b - a)));
}

export interface VRing {
  /** Closed ring, cutting direction applied. */
  points: Vec2[];
  /** Parts of the ring not already covered by the next ring (open polylines). */
  pieces: Vec2[][];
  /** Inset distance from the outline (mm). */
  d: number;
  /** Inset of the next ring inward, or undefined for the innermost ones. */
  nextD: number | undefined;
  /** Depth below the stock top (mm). */
  depth: number;
  /** Ring is part of the flat bottom. */
  flat: boolean;
  /** The region this ring bounds (inset by d): links inside it cannot gouge. */
  level: Region;
}

interface Level {
  d: number;
  region: Region;
  flat: boolean;
}

/** Carving rings from the outside in. */
export function vcarveRings(
  region: Region,
  tool: Pick<Tool, 'diameter' | 'angle' | 'stepOver'>,
  params: VcarveParams,
  warnings: string[],
): VRing[] {
  const tanHalf = Math.tan((((tool.angle ?? 90) / 2) * Math.PI) / 180);
  const step = params.step ?? DEFAULT_VCARVE_STEP;
  const climb = (params.direction ?? 'climb') === 'climb';
  // The cone can reach at most its own radius from the edge.
  const dMax = Math.min(params.depth * tanHalf, tool.diameter / 2);
  const maxDepth = dMax / tanHalf;
  if (params.depth > maxDepth + 1e-9) {
    warnings.push(
      `This V-bit reaches at most ${maxDepth.toFixed(2)} mm deep; wider areas are cut flat at that depth`,
    );
  }

  const levels: Level[] = [];
  let d = step;
  let lastGood = 0;
  for (; d <= dMax + 1e-9; d += step) {
    const level = offset(region, -d);
    if (level.length === 0) break;
    levels.push({ d, region: level, flat: false });
    lastGood = d;
  }
  if (d <= dMax + 1e-9 || lastGood === 0) {
    // Collapsed before dMax: halve towards the centre line.
    let lo = lastGood;
    let hi = Math.min(d, dMax);
    for (let i = 0; i < REFINE; i++) {
      const mid = (lo + hi) / 2;
      const level = offset(region, -mid);
      if (level.length) {
        levels.push({ d: mid, region: level, flat: false });
        lo = mid;
      } else hi = mid;
    }
  } else {
    // Still material at full depth: flat bottom, cleared inward.
    for (let k = 1; k <= 10_000; k++) {
      const level = offset(region, -(dMax + k * tool.stepOver));
      if (level.length === 0) break;
      levels.push({ d: dMax + k * tool.stepOver, region: level, flat: true });
    }
  }

  const rings: VRing[] = [];
  levels.forEach((lv, i) => {
    const next = levels[i + 1];
    // A deeper ring covers this one only if it is cut at its exact (sloped) depth.
    const cover = next && !next.flat ? offset(next.region, next.d - lv.d + COVER_SLACK) : undefined;
    for (const ring of lv.region) {
      const points = climb ? ring : [...ring].reverse();
      const loop = [...points, points[0] as Vec2];
      const raw = cover ? clipLinesOutside([loop], cover).filter((p) => p.length >= 2) : undefined;
      const joined = raw ? joinPieces(points, raw) : undefined;
      rings.push({
        points,
        // undefined join = the whole ring is needed: keep it as one closed loop.
        pieces: joined ?? [loop],
        d: lv.d,
        nextD: next?.d,
        depth: Math.min(lv.d / tanHalf, maxDepth),
        flat: lv.flat,
        level: lv.region,
      });
    }
  });
  return rings;
}

const polyLength = (p: readonly Vec2[]) =>
  p.reduce(
    (s, q, i) =>
      i ? s + Math.hypot(q[0] - (p[i - 1] as Vec2)[0], q[1] - (p[i - 1] as Vec2)[1]) : 0,
    0,
  );

export function emitVcarve(
  b: PathBuilder,
  region: Region,
  tool: Pick<Tool, 'diameter' | 'angle' | 'stepDown' | 'stepOver'>,
  params: VcarveParams,
  warnings: string[],
): void {
  const tanHalf = Math.tan((((tool.angle ?? 90) / 2) * Math.PI) / 180);
  const rings = vcarveRings(region, tool, params, warnings);
  if (rings.length === 0) {
    if (region.length) warnings.push('The shapes are too thin to carve at this step');
    return;
  }
  const deepest = Math.max(...rings.map((r) => r.depth));
  const floors = passDepths(b.topZ, deepest, tool.stepDown);
  const maxLink = JOIN_GAP;
  let above = b.topZ; // everything above this Z has been cut

  for (const floor of floors) {
    const floorDepth = b.topZ - floor;
    type Work = { path: Vec2[]; closed: boolean; ring: VRing; z: number };
    const work: Work[] = [];
    for (const r of rings) {
      if (b.topZ - r.depth >= above - 1e-9) continue; // finished in an earlier pass
      const z = Math.max(b.topZ - r.depth, floor);
      // The next ring covers this one only if this pass cuts it at its exact depth.
      const nextExact = r.nextD !== undefined && r.nextD / tanHalf <= floorDepth + 1e-9;
      const whole =
        r.flat ||
        !nextExact ||
        (r.pieces.length === 1 && r.pieces[0]?.length === r.points.length + 1);
      if (whole) work.push({ path: r.points, closed: true, ring: r, z });
      else
        for (const p of r.pieces)
          if (polyLength(p) > 1e-6) work.push({ path: p, closed: false, ring: r, z });
    }
    let cur: Work | undefined;
    while (work.length) {
      // Nearest next piece (either end of an open piece).
      const at = b.xy;
      let best = 0;
      let bestD = Infinity;
      let flip = false;
      work.forEach((w, i) => {
        const ends: [Vec2, boolean][] = w.closed
          ? [[startNearest(w.path, at)[0] as Vec2, false]]
          : [
              [w.path[0] as Vec2, false],
              [w.path.at(-1) as Vec2, true],
            ];
        for (const [p, f] of ends) {
          const dd = at ? Math.hypot(p[0] - at[0], p[1] - at[1]) : 0;
          if (dd < bestD) {
            bestD = dd;
            best = i;
            flip = f;
          }
        }
      });
      const w = work.splice(best, 1)[0] as Work;
      const pts = w.closed ? startNearest(w.path, at) : flip ? [...w.path].reverse() : w.path;
      const start = pts[0] as Vec2;
      // Link at the shallower of the two depths, inside that ring's region: the cone stays
      // at least that ring's inset from every edge, so it cannot gouge.
      const shallow = cur && (cur.ring.d <= w.ring.d ? cur : w);
      if (at && cur && shallow && bestD <= maxLink && linkInside(at, start, shallow.ring.level)) {
        if (b.z !== undefined && b.z < shallow.z) b.plungeTo(shallow.z); // rise first if going shallower
        b.cutTo(start, shallow.z);
      } else {
        b.travelTo(start);
      }
      cutContour(b, pts, w.closed, b.z ?? b.topZ, w.z);
      cur = w;
    }
    above = floor;
  }
}
