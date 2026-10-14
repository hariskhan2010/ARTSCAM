import type { Tool, Toolpath, Vector } from '../model/schema';
import { offset } from '../vector/clip';
import { flatten, signedArea } from '../vector/flatten';
import type { Vec2 } from '../vector/path';
import { PathBuilder, cumulative, cutContour, passDepths, tabSpans } from './builder';

/**
 * Profile toolpath (plan.md T2.2): cut along, outside or inside vectors in
 * depth passes, with optional ramp entry and holding tabs.
 *
 * Direction: with a clockwise spindle (M3), climb milling keeps the finished
 * wall on the tool's right. Offset rings come out counter-clockwise for outers
 * and clockwise for holes, which is climb for inside cuts; outside cuts are
 * reversed.
 */

export type ProfileParams = Extract<Toolpath, { type: 'profile' }>['params'];

export interface Contour {
  points: Vec2[];
  closed: boolean;
  /** Source vector id. */
  vector: string;
}

export function profileContours(
  vectors: readonly Vector[],
  tool: Pick<Tool, 'diameter'>,
  params: ProfileParams,
  tolerance: number,
  warnings: string[],
): Contour[] {
  const r = tool.diameter / 2;
  const climb = (params.direction ?? 'climb') === 'climb';
  const out: Contour[] = [];
  for (const v of vectors) {
    const polys = flatten(v.segments, tolerance, v.closed);
    if (params.side === 'on' || !v.closed) {
      if (params.side !== 'on')
        warnings.push(`An open shape (${v.id}) has no ${params.side}, so it is cut on the line`);
      for (const p of polys)
        if (p.points.length >= 2) out.push({ points: p.points, closed: p.closed, vector: v.id });
      continue;
    }
    const d = r + (params.allowance ?? 0);
    const rings = offset(
      polys.map((p) => p.points),
      params.side === 'outside' ? d : -d,
    );
    if (rings.length === 0) {
      warnings.push(
        `A shape (${v.id}) is too small for this tool to cut inside, so it was skipped`,
      );
      continue;
    }
    const reverse = params.side === 'outside' ? climb : !climb;
    for (const ring of rings)
      out.push({ points: reverse ? [...ring].reverse() : ring, closed: true, vector: v.id });
  }
  // Smaller loops first: inner features before the part is released.
  return out.sort((a, b) => Math.abs(contourArea(a)) - Math.abs(contourArea(b)));
}

const contourArea = (c: Contour) => (c.closed ? signedArea(c.points) : 0);

/** Emits all depth passes of a profile into the builder. */
export function emitProfile(
  b: PathBuilder,
  contours: readonly Contour[],
  tool: Pick<Tool, 'diameter' | 'stepDown'>,
  params: ProfileParams,
): void {
  const depths = passDepths(b.topZ, params.depth, tool.stepDown);
  const bottom = b.topZ - params.depth;
  for (const c of contours) {
    if (!c.closed) {
      // Open paths: zig-zag back and forth, one pass per depth.
      let pts = c.points;
      b.travelTo(pts[0] as Vec2);
      for (const z of depths) {
        cutContour(b, pts, false, b.z ?? b.topZ, z);
        pts = [...pts].reverse();
      }
      continue;
    }
    const L = cumulative(c.points, true).at(-1) as number;
    const tabs = params.tabs
      ? {
          spans: tabSpans(L, params.tabs.count, params.tabs.width, tool.diameter),
          topZ: bottom + params.tabs.height,
        }
      : undefined;
    b.travelTo(c.points[0] as Vec2);
    let zFrom = b.topZ;
    depths.forEach((z, i) => {
      cutContour(b, c.points, true, zFrom, z, {
        ...(params.ramp ? { ramp: params.ramp.length, cleanup: i === depths.length - 1 } : {}),
        ...(tabs && tabs.spans.length ? { tabs } : {}),
      });
      zFrom = z;
    });
  }
}
