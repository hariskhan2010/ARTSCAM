import type { Tool, Toolpath } from '../model/schema';
import { offset, type Region } from '../vector/clip';
import type { Vec2 } from '../vector/path';
import { PathBuilder, cutContour, passDepths } from './builder';
import { linkInside, startNearest } from './pocket';

/**
 * V-carving (plan.md T3.4). A V-bit whose tip runs along the outline inset by
 * distance d, at depth d / tan(½·angle), touches the outline exactly. Cutting
 * rings at d = step, 2·step, … therefore carves the ideal V surface
 * (depth = distance to the nearest edge / tan(½·angle)); the only material
 * left is a sliver along the centre line, at most `step` wide. When rings stop
 * fitting, the ring spacing is halved a few times to close in on the centre
 * line. Where the shape is wider than the depth allows, the bottom is cut
 * flat at `depth` with rings spaced by the tool's step-over.
 */

export type VcarveParams = Extract<Toolpath, { type: 'vcarve' }>['params'];

export const DEFAULT_VCARVE_STEP = 0.1;
/** Times the last ring spacing is halved to approach the centre line. */
const REFINE = 3;

export interface VRing {
  points: Vec2[];
  /** Inset distance from the outline (mm). */
  d: number;
  /** Depth below the stock top (mm). */
  depth: number;
  /** Ring is part of the flat bottom. */
  flat: boolean;
  /** The region this ring belongs to (inset by d): links inside it cannot gouge. */
  level: Region;
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
  const orient = (ring: Vec2[]) => (climb ? ring : [...ring].reverse());
  // The cone can reach at most its own radius from the edge.
  const coneD = tool.diameter / 2;
  const dMax = Math.min(params.depth * tanHalf, coneD);
  const maxDepth = dMax / tanHalf;
  if (params.depth > maxDepth + 1e-9) {
    warnings.push(
      `This V-bit reaches at most ${maxDepth.toFixed(2)} mm deep; wider areas are cut flat at that depth`,
    );
  }

  const rings: VRing[] = [];
  const add = (level: Region, d: number, flat = false) => {
    for (const ring of level) {
      rings.push({ points: orient(ring), d, depth: Math.min(d / tanHalf, maxDepth), flat, level });
    }
  };

  let d = step;
  let lastGood = 0;
  for (; d <= dMax + 1e-9; d += step) {
    const level = offset(region, -d);
    if (level.length === 0) break;
    add(level, d);
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
        add(level, mid);
        lo = mid;
      } else hi = mid;
    }
  } else {
    // Still material at full depth: flat bottom, cleared inward.
    for (let k = 1; ; k++) {
      const level = offset(region, -(dMax + k * tool.stepOver));
      if (level.length === 0 || k > 10_000) break;
      add(level, dMax + k * tool.stepOver, true);
    }
  }
  // Stable order: by inset distance, then as generated.
  return rings.sort((a, b) => a.d - b.d);
}

export function emitVcarve(
  b: PathBuilder,
  region: Region,
  tool: Pick<Tool, 'diameter' | 'angle' | 'stepDown' | 'stepOver'>,
  params: VcarveParams,
  warnings: string[],
): void {
  const rings = vcarveRings(region, tool, params, warnings);
  if (rings.length === 0) {
    if (region.length) warnings.push('The shapes are too thin to carve at this step');
    return;
  }
  const deepest = Math.max(...rings.map((r) => r.depth));
  const levels = passDepths(b.topZ, deepest, tool.stepDown);
  let above = b.topZ; // everything above this Z has been cut
  const maxLink = 4 * (params.step ?? DEFAULT_VCARVE_STEP) + tool.stepOver;
  for (const floor of levels) {
    let prev: Region | undefined; // region of the ring the tool is on
    for (const r of rings) {
      const zRing = b.topZ - r.depth;
      if (zRing >= above - 1e-9) continue; // done in an earlier pass
      const z = Math.max(zRing, floor);
      const pts = startNearest(r.points, b.xy);
      const start = pts[0] as Vec2;
      const here = b.xy;
      if (
        here &&
        prev &&
        b.z !== undefined &&
        b.z < b.topZ &&
        Math.hypot(start[0] - here[0], start[1] - here[1]) <= maxLink &&
        linkInside(here, start, prev)
      ) {
        // Stay in the material: the link runs at the previous ring's depth and stays inside
        // that ring's region, so the cone never reaches an edge.
        b.cutTo(start, Math.max(b.z, z));
      } else {
        b.travelTo(start);
      }
      cutContour(b, pts, true, b.z ?? b.topZ, z);
      prev = r.level;
    }
    above = floor;
  }
}
