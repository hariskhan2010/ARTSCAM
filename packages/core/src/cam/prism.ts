import type { Tool, Toolpath } from '../model/schema';
import { booleanOp, normalize, offset, type Region } from '../vector/clip';
import type { Vec2 } from '../vector/path';
import type { PathBuilder } from './builder';
import {
  DEFAULT_VCARVE_STEP,
  emitVcarve,
  emitVRings,
  ringsFromLevels,
  type VcarveParams,
  type VLevel,
  type VRing,
} from './vcarve';

/**
 * Prism (bevel) carving and V-bit inlays (plan.md T6.12).
 *
 * Sunken prism: the shapes are carved in as V-grooves, depth = distance to
 * the edge / tan(½·angle), flat at `depth` — exactly a V-carve, so it reuses
 * emitVcarve.
 *
 * Raised prism: the shapes stand up as ridged prisms on a base cut D below
 * the top. With the V-bit's tip run along the shape's outline at depth D,
 * the cone leaves every point inside the shape at
 *
 *   z = −D + dIn / tan(½·angle)            (dIn = distance to the outline)
 *
 * — the prism's sloped faces, up to a sharp ridge on the centre line, or flat
 * at the stock top where the shape is wider than 2·D·tan(½·angle). A tip
 * anywhere outside the shape at depth ≤ D never cuts below that surface, so
 * the band round the shape (out to `margin`) is free to clear:
 *
 *   • rings at distance d from the band's outer edge, tip at d / tan(½·angle)
 *     (a V-carve of the band from its outer edge only), so nothing outside
 *     the band is cut and its outer wall slopes up at the bit's angle;
 *   • from d = D·tan(½·angle) on, a flat floor at D: the shape's own outline
 *     (which forms the faces) and rings stepping out from it.
 *
 * Ideal surface, with e = distance outside the shape and m = margin:
 *   inside: min(0, −D + dIn/tan),  0 ≤ e < m: −min(D, (m − e)/tan),  e ≥ m: 0.
 */

export type PrismParams = Extract<Toolpath, { type: 'prism' }>['params'];
export type InlayParams = Extract<Toolpath, { type: 'inlay' }>['params'];

/** Defaults for the plug (mm). */
export const DEFAULT_GLUE_GAP = 0.5;
export const DEFAULT_PLUG_EXTRA = 1;
/** Floor (mm) always left between the outer slope and the shape, so its outline is a ring. */
const MIN_FLOOR = 0.05;

type VTool = Pick<Tool, 'diameter' | 'angle' | 'stepDown' | 'stepOver'>;

const perimeter = (ring: readonly Vec2[]) =>
  ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length] as Vec2;
    return s + Math.hypot(q[0] - p[0], q[1] - p[1]);
  }, 0);

const tanHalfOf = (tool: Pick<Tool, 'angle'>) =>
  Math.tan((((tool.angle ?? 90) / 2) * Math.PI) / 180);

/** Width of the base cleared round raised shapes when no margin is given: the slope plus a bit radius. */
export function defaultMargin(depth: number, tool: Pick<Tool, 'diameter' | 'angle'>): number {
  return Math.min(depth * tanHalfOf(tool), tool.diameter / 2) + tool.diameter / 2;
}

interface RaisedOptions {
  depth: number;
  margin?: number | undefined;
  step?: number | undefined;
  direction?: VcarveParams['direction'];
}

/** Rings that leave `shape` standing as a raised prism (see the note at the top). */
export function raisedPrismRings(
  shape: Region,
  tool: VTool,
  opts: RaisedOptions,
  warnings: string[],
): VRing[] {
  if (shape.length === 0) return [];
  const tanHalf = tanHalfOf(tool);
  const step = opts.step ?? DEFAULT_VCARVE_STEP;
  const climb = (opts.direction ?? 'climb') === 'climb';
  const margin = opts.margin ?? defaultMargin(opts.depth, tool);
  // The cone reaches at most its own radius from the tip: deeper, the shank
  // would cut the faces flat.
  let dMax = Math.min(opts.depth * tanHalf, tool.diameter / 2);
  if (dMax < opts.depth * tanHalf - 1e-9) {
    warnings.push(
      `This V-bit reaches at most ${(dMax / tanHalf).toFixed(2)} mm deep; the base is cut at that depth`,
    );
  }
  if (dMax > margin - MIN_FLOOR) {
    dMax = margin - MIN_FLOOR;
    if (dMax <= 0) {
      warnings.push('The margin is too narrow to carve anything');
      return [];
    }
    warnings.push(
      `The margin is too narrow for this depth; the base is cut ${(dMax / tanHalf).toFixed(2)} mm deep`,
    );
  }
  const depth = dMax / tanHalf;

  const outer = offset(shape, margin);
  const levels: VLevel[] = [];
  // Sloped outer wall: a V-carve of the band from its outer edge. Its rings
  // never enter the shape (every point of it is ≥ margin from the outer edge);
  // links also stay out of it.
  for (let d = step; d < dMax - 1e-9; d += step) {
    const region = offset(outer, -d);
    if (region.length === 0) break;
    const level = booleanOp('difference', region, shape);
    levels.push({ d, region, level, depth: d / tanHalf, flat: false });
  }
  // Flat floor at full depth: the shape's outline first, then rings stepping out.
  const floor = booleanOp('difference', offset(outer, -dMax), shape);
  for (let k = 0; k <= 10_000; k++) {
    // Rings shorter than a step-over are crumbs where the floor is just
    // 2·k·step-over wide: the rings either side already cut there.
    // Links still use the whole inset, so they never cross a dropped hole.
    const level = k ? offset(floor, -k * tool.stepOver) : floor;
    const region = k ? level.filter((r) => perimeter(r) >= tool.stepOver) : level;
    if (region.length === 0) break;
    levels.push({ d: dMax + k * tool.stepOver, region, level, depth, flat: true });
  }
  return ringsFromLevels(levels, climb);
}

const vcarveParams = (p: {
  depth: number;
  step?: number | undefined;
  direction?: VcarveParams['direction'];
}): VcarveParams => ({
  depth: p.depth,
  ...(p.step !== undefined ? { step: p.step } : {}),
  ...(p.direction !== undefined ? { direction: p.direction } : {}),
});

export function emitPrism(
  b: PathBuilder,
  region: Region,
  tool: VTool,
  params: PrismParams,
  warnings: string[],
): void {
  if (params.mode === 'sunken') {
    emitVcarve(b, region, tool, vcarveParams(params), warnings);
    return;
  }
  emitVRings(b, raisedPrismRings(region, tool, params, warnings), tool);
}

/** The region mirrored left to right about the centre of its bounding box. */
export function mirrorRegionX(region: Region): Region {
  let lo = Infinity;
  let hi = -Infinity;
  for (const ring of region)
    for (const [x] of ring) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  return normalize(region.map((ring) => ring.map(([x, y]): Vec2 => [lo + hi - x, y])));
}

/**
 * V-bit inlay geometry. With t = tan(½·angle), D = depth, g = glue gap and
 * s = plug extra:
 *
 * Pocket: a V-carve of the shape S to D. Its cross-section u below the top
 * is S inset by u·t, flat at D.
 *
 * Plug: S mirrored (it is turned over to fit), grown by s·t, carved as a
 * raised prism on a base Dp = D − g + s deep. Its cross-section u below its
 * top is S inset by (D − g − u)·t. Turned over with its top q into the
 * pocket, that slice sits q − u deep, where the pocket is S inset by
 * (q − u)·t: the two match at every u when q = D − g. So the walls meet with
 * a gap g under the plug's top for glue, and the plug's base stands s above
 * the surface (sawn off after gluing). At the glue line (D − g below the
 * plug's top, s above its base) the plug is exactly S: as wide as the
 * pocket's top.
 */
export function inlayPlug(
  region: Region,
  tool: Pick<Tool, 'angle'>,
  params: InlayParams,
): { shape: Region; depth: number } {
  const gap = params.glueGap ?? DEFAULT_GLUE_GAP;
  const extra = params.plugExtra ?? DEFAULT_PLUG_EXTRA;
  const mirrored = mirrorRegionX(region);
  return {
    shape: extra > 0 ? offset(mirrored, extra * tanHalfOf(tool)) : mirrored,
    depth: params.depth - gap + extra,
  };
}

export function emitInlay(
  b: PathBuilder,
  region: Region,
  tool: VTool,
  params: InlayParams,
  warnings: string[],
): void {
  if (params.part === 'pocket') {
    emitVcarve(b, region, tool, vcarveParams(params), warnings);
    return;
  }
  if ((params.glueGap ?? DEFAULT_GLUE_GAP) >= params.depth) {
    warnings.push('The glue gap must be less than the pocket depth');
    return;
  }
  const plug = inlayPlug(region, tool, params);
  warnings.push(
    'Plug: carved mirrored left to right. Turn it over, glue it into the pocket, then saw off the waste above the surface',
  );
  emitVRings(
    b,
    raisedPrismRings(plug.shape, tool, { ...params, depth: plug.depth }, warnings),
    tool,
  );
}
