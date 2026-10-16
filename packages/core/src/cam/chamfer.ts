import type { Tool, Toolpath, Vector } from '../model/schema';
import type { PathBuilder } from './builder';
import { emitProfile, profileContours, type Contour } from './profile';

/**
 * Chamfer (plan.md T6.12): a 45°-style bevel along shapes, cut with a V-bit.
 *
 * The shape's line is the top edge of the bevel. A V-bit of included angle
 * θ whose tip runs at depth d cuts a cone of top radius d·tan(½θ); with the
 * tip offset `width` from the line on the chosen side and d = width /
 * tan(½θ), the cone's edge meets the line exactly at the surface and the
 * bevel falls away from the line at the bit's angle to depth d.
 */

export type ChamferParams = Extract<Toolpath, { type: 'chamfer' }>['params'];

/** Tip depth (mm) for a bevel of `width` with this bit (90° when the angle is missing). */
export function chamferDepth(tool: Pick<Tool, 'angle'>, width: number): number {
  const half = ((tool.angle ?? 90) * Math.PI) / 360;
  return width / Math.tan(half);
}

/** Tip paths: each closed shape offset by `width` to the chosen side, climb by default. */
export function chamferContours(
  vectors: readonly Vector[],
  params: ChamferParams,
  tolerance: number,
  warnings: string[],
): Contour[] {
  // An offset of the tool radius r puts the tip at r from the line, so a
  // "tool" of diameter 2·width puts it at `width`.
  return profileContours(
    vectors,
    { diameter: 2 * params.width },
    {
      side: params.side,
      depth: 1,
      ...(params.direction ? { direction: params.direction } : {}),
    },
    tolerance,
    warnings,
  );
}

export function emitChamfer(
  b: PathBuilder,
  contours: readonly Contour[],
  tool: Pick<Tool, 'diameter' | 'stepDown' | 'angle'>,
  params: ChamferParams,
  warnings: string[],
): void {
  if (params.width > tool.diameter / 2 + 1e-9) {
    warnings.push(
      `The chamfer (${params.width} mm wide) is wider than the V-bit's cone (${tool.diameter / 2} mm): the bevel will end in a step; use a larger bit`,
    );
  }
  emitProfile(b, contours, tool, { side: params.side, depth: chamferDepth(tool, params.width) });
}
