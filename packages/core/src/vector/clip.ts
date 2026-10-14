import {
  ClipType,
  Clipper,
  Clipper64,
  ClipperOffset,
  EndType,
  FillRule,
  JoinType,
  type Path64,
  type Paths64,
} from 'clipper2-ts';
import { signedArea } from './flatten';
import type { Vec2 } from './path';

/**
 * Offsets and booleans via Clipper2 (`clipper2-ts`; plan.md T1.3; BSL-1.0, see
 * docs/THIRD_PARTY.md). Clipper works on integers, so coordinates are scaled
 * to 0.1 µm. A region is a list of closed rings; after any operation here,
 * outer rings are counter-clockwise (positive area, Y up) and holes clockwise.
 */

export type Ring = Vec2[];
export type Region = Ring[];
export type JoinStyle = 'round' | 'miter' | 'square';
export type BooleanOp = 'union' | 'intersect' | 'difference' | 'xor';
/**
 * How overlapping input rings are filled: `evenOdd` treats a ring inside
 * another as a hole whatever its direction (what designers expect from nested
 * vectors); `nonZero` uses winding direction.
 */
export type FillMode = 'evenOdd' | 'nonZero';

/** Clipper integer units per mm. */
export const CLIP_SCALE = 10_000;
/** Default max deviation of offset arcs from a true circle (mm). */
export const DEFAULT_ARC_TOLERANCE = 0.002;

const JOIN: Record<JoinStyle, JoinType> = {
  round: JoinType.Round,
  miter: JoinType.Miter,
  square: JoinType.Square,
};
const FILL: Record<FillMode, FillRule> = {
  evenOdd: FillRule.EvenOdd,
  nonZero: FillRule.NonZero,
};
const CLIP: Record<BooleanOp, ClipType> = {
  union: ClipType.Union,
  intersect: ClipType.Intersection,
  difference: ClipType.Difference,
  xor: ClipType.Xor,
};

const toPath = (points: readonly Vec2[]): Path64 =>
  points.map(([x, y]) => ({ x: Math.round(x * CLIP_SCALE), y: Math.round(y * CLIP_SCALE) }));

const toPaths = (rings: readonly (readonly Vec2[])[]): Paths64 => rings.map(toPath);

function fromPaths(paths: Paths64): Region {
  return paths
    .filter((p) => p.length >= 2)
    .map((p) => p.map((pt): Vec2 => [pt.x / CLIP_SCALE, pt.y / CLIP_SCALE]));
}

/** Normalises rings into a clean region (no self-overlaps, CCW outers, CW holes). */
export function normalize(rings: readonly (readonly Vec2[])[], fill: FillMode = 'evenOdd'): Region {
  return fromPaths(Clipper.union(toPaths(rings), FILL[fill]));
}

/** Boolean of two regions. */
export function booleanOp(
  op: BooleanOp,
  subject: readonly (readonly Vec2[])[],
  clip: readonly (readonly Vec2[])[],
  fill: FillMode = 'evenOdd',
): Region {
  // Normalise each side on its own first so the fill rule applies per operand.
  const a = Clipper.union(toPaths(subject), FILL[fill]);
  const b = Clipper.union(toPaths(clip), FILL[fill]);
  return fromPaths(Clipper.booleanOp(CLIP[op], a, b, FillRule.NonZero));
}

export interface OffsetOptions {
  join?: JoinStyle;
  /** Max deviation of round joins from a true arc (mm). */
  arcTolerance?: number;
  /** Miter limit as a multiple of |delta| (miter joins only). Default 2. */
  miterLimit?: number;
  fill?: FillMode;
}

/**
 * Offsets a region outward (`delta` > 0) or inward (`delta` < 0) by |delta| mm.
 * Shrinking past the region's thickness returns an empty region.
 */
export function offset(
  rings: readonly (readonly Vec2[])[],
  delta: number,
  options: OffsetOptions = {},
): Region {
  if (!Number.isFinite(delta)) throw new RangeError(`delta must be finite, got ${delta}`);
  const region = Clipper.union(toPaths(rings), FILL[options.fill ?? 'evenOdd']);
  if (delta === 0) return fromPaths(region);
  const co = new ClipperOffset(
    options.miterLimit ?? 2,
    (options.arcTolerance ?? DEFAULT_ARC_TOLERANCE) * CLIP_SCALE,
  );
  co.addPaths(region, JOIN[options.join ?? 'round'], EndType.Polygon);
  const out: Paths64 = [];
  co.execute(delta * CLIP_SCALE, out);
  // Re-union so results are normalised like every other region here.
  return fromPaths(Clipper.union(out, FillRule.NonZero));
}

/**
 * Clips open polylines to the inside of a region (e.g. raster pocket lines).
 * Returns the pieces that lie inside.
 */
export function clipLines(
  lines: readonly (readonly Vec2[])[],
  region: readonly (readonly Vec2[])[],
  fill: FillMode = 'nonZero',
): Vec2[][] {
  const c = new Clipper64();
  c.addOpenSubject(toPaths(lines));
  c.addClip(toPaths(region));
  const closed: Paths64 = [];
  const open: Paths64 = [];
  c.execute(ClipType.Intersection, FILL[fill], closed, open);
  return fromPaths(open);
}

/** Parts of open polylines that lie outside a region (the complement of `clipLines`). */
export function clipLinesOutside(
  lines: readonly (readonly Vec2[])[],
  region: readonly (readonly Vec2[])[],
  fill: FillMode = 'nonZero',
): Vec2[][] {
  const c = new Clipper64();
  c.addOpenSubject(toPaths(lines));
  c.addClip(toPaths(region));
  const closed: Paths64 = [];
  const open: Paths64 = [];
  c.execute(ClipType.Difference, FILL[fill], closed, open);
  return fromPaths(open);
}

/** Removes vertices that deviate less than `epsilon` mm from the outline. */
export function simplify(region: readonly (readonly Vec2[])[], epsilon: number): Region {
  return fromPaths(Clipper.simplifyPaths(toPaths(region), epsilon * CLIP_SCALE, true));
}

/** Total signed area (mm²): outers count positive, holes negative. */
export function regionArea(region: readonly (readonly Vec2[])[]): number {
  return region.reduce((sum, ring) => sum + signedArea(ring), 0);
}
