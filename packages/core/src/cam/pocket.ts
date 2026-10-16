import type { Tool, Toolpath, Vector } from '../model/schema';
import {
  booleanOp,
  clipLines,
  normalize,
  offset,
  regionArea,
  simplify,
  type Region,
} from '../vector/clip';
import { flatten, signedArea } from '../vector/flatten';
import { applyMatrix, rotation, type Vec2 } from '../vector/path';
import { PathBuilder, cutContour, passDepths } from './builder';

/**
 * Pocket toolpath (plan.md T2.3): clear the area inside closed vectors down
 * to a depth. Vectors inside other vectors are islands (even-odd per vector,
 * union across vectors). Strategies: concentric offsets (centre outward), or
 * zig-zag raster lines followed by a finishing pass around the walls.
 *
 * Rest machining (T6.12): after a larger tool has cleared the pocket, a
 * smaller one cuts only where the larger one could not reach (the corners
 * and narrow gaps).
 */

export type PocketParams = Extract<Toolpath, { type: 'pocket' }>['params'];

/**
 * Area to clear. All selected closed vectors are combined even-odd, so a
 * vector inside another is an island (and one inside that is pocketed again).
 */
export function pocketRegion(
  vectors: readonly Vector[],
  tolerance: number,
  warnings: string[],
): Region {
  const rings: Vec2[][] = [];
  for (const v of vectors) {
    if (!v.closed) {
      warnings.push(`An open shape (${v.id}) was skipped: only closed shapes can be pocketed`);
      continue;
    }
    for (const p of flatten(v.segments, tolerance, true)) rings.push(p.points);
  }
  return normalize(rings, 'evenOdd');
}

/** Rotates a ring list so each ring starts at its vertex nearest to `from`. */
export function startNearest(ring: Vec2[], from: Vec2 | undefined): Vec2[] {
  if (!from || ring.length === 0) return ring;
  let best = 0;
  let bestD = Infinity;
  ring.forEach((p, i) => {
    const d = Math.hypot(p[0] - from[0], p[1] - from[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return [...ring.slice(best), ...ring.slice(0, best)];
}

/** True when the straight move a→b stays inside the tool-centre region. */
export function linkInside(a: Vec2, b: Vec2, centres: Region): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-9) return true;
  const inside = clipLines([[a, b]], centres);
  const total = inside.reduce((s, seg) => {
    let l = 0;
    for (let i = 1; i < seg.length; i++) {
      const p = seg[i - 1] as Vec2;
      const q = seg[i] as Vec2;
      l += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    return s + l;
  }, 0);
  return total >= len - 1e-3;
}

type Piece = { points: Vec2[]; closed: boolean };

/** Max deviation (mm) allowed on inner roughing loops (walls are finished by the outer loop). */
const ROUGH_TOLERANCE = 0.02;

/** Cut order for one depth level, in world coordinates. */
export function pocketPieces(
  centres: Region,
  tool: Pick<Tool, 'stepOver'>,
  params: PocketParams,
): Piece[] {
  const climb = (params.direction ?? 'climb') === 'climb';
  const orient = (ring: Vec2[]) => (climb ? ring : [...ring].reverse());
  if (params.strategy === 'offset') {
    const levels: Region[] = [];
    for (let k = 0; ; k++) {
      // Roughing loops do not need wall-finish precision; a coarser arc
      // tolerance keeps the file small. The k = 0 loop finishes the walls.
      const level =
        k === 0
          ? centres
          : simplify(
              offset(centres, -k * tool.stepOver, { arcTolerance: ROUGH_TOLERANCE }),
              ROUGH_TOLERANCE,
            );
      if (level.length === 0 || k > 10_000) break;
      levels.push(level);
    }
    // Centre outward: the innermost loops first, the wall-finishing loop last.
    return levels
      .reverse()
      .flatMap((level) => level.map((ring) => ({ points: orient(ring), closed: true })));
  }

  // Raster: lines along `angle`, clipped to the centre region, zig-zag order.
  const angle = ((params.angle ?? 0) * Math.PI) / 180;
  const toLocal = rotation(-angle);
  const toWorld = rotation(angle);
  const local = centres.map((r) => r.map((p) => applyMatrix(toLocal, p)));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of local)
    for (const [x, y] of r) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  const pieces: Piece[] = [];
  if (Number.isFinite(minY)) {
    const n = Math.max(1, Math.ceil((maxY - minY) / tool.stepOver));
    const step = (maxY - minY) / n;
    for (let i = 0; i <= n; i++) {
      // Nudge the outermost lines inside so they are not tangent to the boundary.
      const y = i === 0 ? minY + 1e-4 : i === n ? maxY - 1e-4 : minY + i * step;
      const segs = clipLines(
        [
          [
            [minX - 1, y],
            [maxX + 1, y],
          ],
        ],
        local,
      )
        .map((s) => [...s].sort((a, b) => a[0] - b[0]))
        .sort((a, b) => (a[0] as Vec2)[0] - (b[0] as Vec2)[0]);
      const ordered = i % 2 === 0 ? segs : segs.map((s) => [...s].reverse()).reverse();
      for (const s of ordered)
        pieces.push({ points: s.map((p) => applyMatrix(toWorld, p)), closed: false });
    }
  }
  // Finishing pass around walls and islands.
  for (const ring of centres) pieces.push({ points: orient(ring), closed: true });
  return pieces;
}

/**
 * Reach of a larger tool is grown by this much (mm) so that walls it did
 * reach leave no hairline slivers to clean up.
 */
const REST_SLACK = 0.01;
/** Rest areas smaller than this (mm²) are rounding noise. */
const REST_MIN_AREA = 1e-3;

/**
 * The part of `region` a round tool of radius `bigR` cannot reach: the
 * region minus its morphological opening (inset by bigR, then outset by bigR).
 */
export function restRegion(region: Region, bigR: number): Region {
  const reached = offset(offset(region, -bigR), bigR + REST_SLACK);
  const rest = booleanOp('difference', region, reached);
  return rest.length && regionArea(rest) > REST_MIN_AREA ? rest : [];
}

/**
 * Tool-centre region for rest machining: centres of the small tool (radius
 * r) whose cut touches what the larger tool (radius bigR) left behind.
 */
export function restCentres(
  region: Region,
  centres: Region,
  r: number,
  bigR: number,
  allowance = 0,
): Region {
  const target = allowance > 0 ? offset(region, -allowance) : region;
  const rest = restRegion(target, bigR);
  if (rest.length === 0) return [];
  const out = booleanOp('intersect', centres, offset(rest, r));
  return out.length && regionArea(out) > REST_MIN_AREA ? out : [];
}

/** Even-odd point-in-ring test. */
function insideRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2;
    const c = ring[j] as Vec2;
    if (
      a[1] > p[1] !== c[1] > p[1] &&
      p[0] < a[0] + ((p[1] - a[1]) * (c[0] - a[0])) / (c[1] - a[1])
    )
      inside = !inside;
  }
  return inside;
}

/** Splits a region into separate areas: each outer ring with the holes inside it. */
export function separateAreas(region: Region): Region[] {
  const outers = region.filter((r) => signedArea(r) > 0);
  const areas: Region[] = outers.map((r) => [r]);
  for (const hole of region.filter((r) => signedArea(r) <= 0)) {
    // The smallest outer ring around the hole owns it.
    let best = -1;
    outers.forEach((o, i) => {
      if (
        insideRing(hole[0] as Vec2, o) &&
        (best < 0 || signedArea(o) < signedArea(outers[best] as Vec2[]))
      )
        best = i;
    });
    if (best >= 0) (areas[best] as Region).push(hole);
  }
  return areas;
}

export function emitPocket(
  b: PathBuilder,
  region: Region,
  tool: Pick<Tool, 'diameter' | 'stepDown' | 'stepOver'>,
  params: PocketParams,
  warnings: string[],
  /** The larger tool used first (rest machining), when `params.restFrom` is set. */
  restTool?: Pick<Tool, 'diameter'>,
): void {
  const allowance = params.allowance ?? 0;
  let centres = offset(region, -(tool.diameter / 2 + allowance));
  if (centres.length === 0) {
    if (region.length) warnings.push('The tool is too large to fit inside the pocket; nothing cut');
    return;
  }
  if (restTool) {
    if (restTool.diameter <= tool.diameter + 1e-9) {
      warnings.push(
        'Clean corners after: the first tool is not larger than this one, so there is nothing left for this one to reach; nothing cut',
      );
      return;
    }
    centres = restCentres(region, centres, tool.diameter / 2, restTool.diameter / 2, allowance);
    if (centres.length === 0) {
      if (region.length) warnings.push('The first tool reaches the whole pocket; nothing to clean');
      return;
    }
    // The leftovers are separate corners and gaps: finish each one to full
    // depth before moving on, nearest next.
    const depths = passDepths(b.topZ, params.depth, tool.stepDown);
    const left = separateAreas(centres);
    while (left.length) {
      const from = b.xy ?? [0, 0];
      let next = 0;
      left.forEach((area, i) => {
        const p = (area[0] as Vec2[])[0] as Vec2;
        const q = ((left[next] as Region)[0] as Vec2[])[0] as Vec2;
        if (Math.hypot(p[0] - from[0], p[1] - from[1]) < Math.hypot(q[0] - from[0], q[1] - from[1]))
          next = i;
      });
      emitPocketCentres(b, left.splice(next, 1)[0] as Region, tool, params, depths);
    }
    return;
  }
  emitPocketCentres(b, centres, tool, params, passDepths(b.topZ, params.depth, tool.stepDown));
}

/**
 * Clears a tool-centre region at each of the given depths (absolute Z),
 * staying down for short links through already-cleared material.
 */
export function emitPocketCentres(
  b: PathBuilder,
  centres: Region,
  tool: Pick<Tool, 'diameter' | 'stepOver'>,
  params: PocketParams,
  depths: readonly number[],
): void {
  const template = pocketPieces(centres, tool, params);
  const maxLink = 2 * tool.diameter;
  for (const z of depths) {
    for (const piece of template) {
      const pts = piece.closed ? startNearest(piece.points, b.xy) : piece.points;
      const start = pts[0] as Vec2;
      const here = b.xy;
      const atDepth = b.z !== undefined && Math.abs(b.z - z) < 1e-9;
      if (
        here &&
        atDepth &&
        Math.hypot(start[0] - here[0], start[1] - here[1]) <= maxLink &&
        linkInside(here, start, centres)
      ) {
        b.cutTo(start, z); // stay down: short link through already-cleared material
      } else {
        b.travelTo(start);
      }
      cutContour(b, pts, piece.closed, b.z ?? b.topZ, z);
    }
  }
}
