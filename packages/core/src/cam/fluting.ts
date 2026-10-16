import type { Tool, Toolpath, Vector } from '../model/schema';
import { flatten } from '../vector/flatten';
import type { Vec2 } from '../vector/path';
import { PathBuilder, cumulative, passDepths, pointAtDistance } from './builder';

/**
 * Fluting (plan.md T6.12): a groove along each vector, cut with a ball nose
 * or V-bit, that sinks gradually from the surface to full depth over
 * `rampIn`, runs at depth, and rises back to the surface over `rampOut`
 * before the end, so the flute tapers out at both ends like a carved reed.
 *
 * Deeper than the tool's depth per pass, the same profile is cut several
 * times, each pass clamped to its pass depth; open paths go back and forth.
 */

export type FlutingParams = Extract<Toolpath, { type: 'fluting' }>['params'];

export interface FlutePath {
  points: Vec2[];
  closed: boolean;
}

/** Max Z error (mm) of the straight moves approximating a smooth ramp. */
const SMOOTH_TOLERANCE = 0.01;

/** Ramp profile, 0 at t = 0 rising to 1 at t = 1 (clamped outside). */
export function easeRamp(t: number, shape: FlutingParams['shape'] = 'linear'): number {
  const u = Math.max(0, Math.min(1, t));
  return shape === 'smooth' ? (1 - Math.cos(Math.PI * u)) / 2 : u;
}

/** Inverse of easeRamp: the fraction t of a ramp at which it reaches u (0 ≤ u ≤ 1). */
export function rampFraction(u: number, shape: FlutingParams['shape'] = 'linear'): number {
  const v = Math.max(0, Math.min(1, u));
  return shape === 'smooth' ? Math.acos(1 - 2 * v) / Math.PI : v;
}

/**
 * Ramp lengths for a path of length L. When the two ramps are longer than
 * the path they are scaled down to share it, and the full depth is reached
 * only at the point where they meet.
 */
export function fluteRamps(
  L: number,
  params: Pick<FlutingParams, 'rampIn' | 'rampOut'>,
): { rampIn: number; rampOut: number; scaled: boolean } {
  const total = params.rampIn + params.rampOut;
  if (total <= L) return { rampIn: params.rampIn, rampOut: params.rampOut, scaled: false };
  const k = L / total;
  return { rampIn: params.rampIn * k, rampOut: params.rampOut * k, scaled: true };
}

/** Depth below the surface (mm, ≥ 0) at distance s along a path of length L. */
export function fluteDepth(
  s: number,
  L: number,
  params: Pick<FlutingParams, 'depth' | 'shape'>,
  ramps: { rampIn: number; rampOut: number },
): number {
  let f = 1;
  if (ramps.rampIn > 0) f = Math.min(f, easeRamp(s / ramps.rampIn, params.shape));
  if (ramps.rampOut > 0) f = Math.min(f, easeRamp((L - s) / ramps.rampOut, params.shape));
  return params.depth * f;
}

export function flutePaths(vectors: readonly Vector[], tolerance: number): FlutePath[] {
  const out: FlutePath[] = [];
  for (const v of vectors) {
    for (const p of flatten(v.segments, tolerance, v.closed)) {
      if (p.points.length >= 2) out.push({ points: p.points, closed: p.closed });
    }
  }
  return out;
}

/**
 * Distances along the path where the moves break: every vertex, the ends of
 * the ramps, and enough points inside a smooth ramp to follow its curve.
 */
export function fluteStations(
  cum: readonly number[],
  params: Pick<FlutingParams, 'depth' | 'shape'>,
  ramps: { rampIn: number; rampOut: number },
): number[] {
  const L = cum.at(-1) as number;
  const marks = new Set<number>(cum);
  marks.add(ramps.rampIn);
  marks.add(L - ramps.rampOut);
  const subdivide = (a: number, len: number) => {
    if (len <= 0) return;
    // Chord error of (1 - cos)/2 over a step h is about h²·depth·π² / (16·len²).
    const h = Math.sqrt((16 * SMOOTH_TOLERANCE) / (params.depth * Math.PI * Math.PI)) * len;
    const n = Math.max(4, Math.ceil(len / h));
    for (let i = 1; i < n; i++) marks.add(a + (len * i) / n);
  };
  if (params.shape === 'smooth') {
    subdivide(0, ramps.rampIn);
    subdivide(L - ramps.rampOut, ramps.rampOut);
  }
  return [...marks].filter((s) => s >= 0 && s <= L).sort((x, y) => x - y);
}

export function emitFluting(
  b: PathBuilder,
  paths: readonly FlutePath[],
  tool: Pick<Tool, 'stepDown'>,
  params: FlutingParams,
  warnings: string[],
): void {
  // Pass limits as depths below the surface, shallowest first.
  const limits = passDepths(0, params.depth, tool.stepDown).map((z) => -z);
  let scaled = false;
  for (const path of paths) {
    const cum = cumulative(path.points, path.closed);
    const L = cum.at(-1) as number;
    if (L < 1e-6) continue;
    const ramps = fluteRamps(L, params);
    scaled ||= ramps.scaled;
    const stations = fluteStations(cum, params, ramps);
    const at = (s: number) => pointAtDistance(path.points, cum, path.closed, s);

    b.travelTo(at(0));
    let forward = true;
    for (const limit of limits) {
      // Where a shallower pass's clamp meets the ramps, so its moves follow the
      // ramp down to the pass depth instead of cutting a straight chord.
      const t = rampFraction(limit / params.depth, params.shape);
      const pass =
        limit < params.depth
          ? [...new Set([...stations, ramps.rampIn * t, L - ramps.rampOut * t])].sort(
              (x, y) => x - y,
            )
          : stations;
      const order = forward ? pass : [...pass].reverse();
      for (const s of order) {
        b.cutTo(at(s), b.topZ - Math.min(limit, fluteDepth(s, L, params, ramps)));
      }
      // Open paths go back and forth; a closed loop ends where it started.
      if (!path.closed) forward = !forward;
    }
  }
  if (scaled) {
    warnings.push(
      'The ramps are longer than a shape, so they were shortened to meet in the middle',
    );
  }
}
