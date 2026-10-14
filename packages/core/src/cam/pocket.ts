import type { Tool, Toolpath, Vector } from '../model/schema';
import { clipLines, normalize, offset, simplify, type Region } from '../vector/clip';
import { flatten } from '../vector/flatten';
import { applyMatrix, rotation, type Vec2 } from '../vector/path';
import { PathBuilder, cutContour, passDepths } from './builder';

/**
 * Pocket toolpath (plan.md T2.3): clear the area inside closed vectors down
 * to a depth. Vectors inside other vectors are islands (even-odd per vector,
 * union across vectors). Strategies: concentric offsets (centre outward), or
 * zig-zag raster lines followed by a finishing pass around the walls.
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

export function emitPocket(
  b: PathBuilder,
  region: Region,
  tool: Pick<Tool, 'diameter' | 'stepDown' | 'stepOver'>,
  params: PocketParams,
  warnings: string[],
): void {
  const centres = offset(region, -(tool.diameter / 2 + (params.allowance ?? 0)));
  if (centres.length === 0) {
    if (region.length) warnings.push('The tool is too large to fit inside the pocket; nothing cut');
    return;
  }
  const template = pocketPieces(centres, tool, params);
  const maxLink = 2 * tool.diameter;
  for (const z of passDepths(b.topZ, params.depth, tool.stepDown)) {
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
