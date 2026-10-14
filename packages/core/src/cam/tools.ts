import type { Tool, Units } from '../model/schema';
import { MM_PER_INCH, formatFixed, fromMm } from '../model/units';

/**
 * Tool library (plan.md T2.1). Tools are stored in the project (`tools`), so
 * they travel with the file. Presets are starting points for common router
 * bits in wood; feeds are conservative for a hobby GRBL machine.
 */

export type ToolPreset = Omit<Tool, 'id'>;

const IN = MM_PER_INCH;

export const TOOL_PRESETS: readonly ToolPreset[] = [
  {
    name: '1/8" flat end mill',
    type: 'flat',
    diameter: IN / 8,
    flutes: 2,
    stepDown: 1.5,
    stepOver: 1.2,
    feed: 1000,
    plunge: 300,
    rpm: 18000,
  },
  {
    name: '1/4" flat end mill',
    type: 'flat',
    diameter: IN / 4,
    flutes: 2,
    stepDown: 3,
    stepOver: 2.5,
    feed: 1500,
    plunge: 400,
    rpm: 18000,
  },
  {
    name: '3 mm flat end mill',
    type: 'flat',
    diameter: 3,
    flutes: 2,
    stepDown: 1.5,
    stepOver: 1.2,
    feed: 1000,
    plunge: 300,
    rpm: 18000,
  },
  {
    name: '6 mm flat end mill',
    type: 'flat',
    diameter: 6,
    flutes: 2,
    stepDown: 3,
    stepOver: 2.4,
    feed: 1500,
    plunge: 400,
    rpm: 18000,
  },
  {
    name: '1/8" ball nose',
    type: 'ballnose',
    diameter: IN / 8,
    flutes: 2,
    stepDown: 1,
    stepOver: 0.3,
    feed: 1200,
    plunge: 300,
    rpm: 18000,
  },
  {
    name: '6 mm ball nose',
    type: 'ballnose',
    diameter: 6,
    flutes: 2,
    stepDown: 2,
    stepOver: 0.6,
    feed: 1500,
    plunge: 400,
    rpm: 18000,
  },
  {
    name: '60° V-bit, 1/2"',
    type: 'vbit',
    diameter: IN / 2,
    angle: 60,
    flutes: 2,
    stepDown: 2,
    stepOver: 0.5,
    feed: 1200,
    plunge: 300,
    rpm: 18000,
  },
  {
    name: '90° V-bit, 1/2"',
    type: 'vbit',
    diameter: IN / 2,
    angle: 90,
    flutes: 2,
    stepDown: 2,
    stepOver: 0.5,
    feed: 1200,
    plunge: 300,
    rpm: 18000,
  },
  {
    name: 'Tapered ball 1 mm tip, 10°',
    type: 'taperedball',
    diameter: 3.175,
    angle: 10,
    tipDiameter: 1,
    flutes: 2,
    stepDown: 1,
    stepOver: 0.15,
    feed: 1000,
    plunge: 250,
    rpm: 18000,
  },
];

/** Problems that make a tool unusable (empty when fine). */
export function toolProblems(tool: Omit<Tool, 'id'>): string[] {
  const out: string[] = [];
  if ((tool.type === 'vbit' || tool.type === 'taperedball') && tool.angle === undefined) {
    out.push(`A ${tool.type === 'vbit' ? 'V-bit' : 'tapered ball'} needs an included angle`);
  }
  if (tool.type === 'taperedball') {
    if (tool.tipDiameter === undefined) out.push('A tapered ball needs a tip diameter');
    else if (tool.tipDiameter > tool.diameter)
      out.push('Tip diameter is larger than the tool diameter');
  }
  if (tool.stepOver > tool.diameter)
    out.push('Step-over is larger than the tool diameter: passes would leave ridges');
  if (tool.plunge > tool.feed) out.push('Plunge rate is faster than the feed rate');
  return out;
}

/** Human label, e.g. "6 mm flat end mill" or a generated one in the display unit. */
export function toolLabel(tool: Omit<Tool, 'id'>, units: Units = 'mm'): string {
  if (tool.name) return tool.name;
  const d = formatFixed(fromMm(tool.diameter, units), units === 'mm' ? 3 : 4, true);
  const kind = {
    flat: 'flat',
    ballnose: 'ball nose',
    vbit: `${tool.angle ?? '?'}° V-bit`,
    taperedball: 'tapered ball',
  }[tool.type];
  return `${d}${units === 'mm' ? ' mm' : '"'} ${kind}`;
}

/**
 * Cutting radius of a tool at height h above its tip (mm). Flat: constant;
 * ball: spherical; V-bit: cone; tapered ball: ball tip then cone.
 */
export function radiusAt(
  tool: Pick<Tool, 'type' | 'diameter' | 'angle' | 'tipDiameter'>,
  h: number,
): number {
  const R = tool.diameter / 2;
  if (h <= 0) return tool.type === 'flat' ? R : 0;
  switch (tool.type) {
    case 'flat':
      return R;
    case 'ballnose':
      return h >= R ? R : Math.sqrt(R * R - (R - h) * (R - h));
    case 'vbit': {
      const half = ((tool.angle ?? 90) * Math.PI) / 360;
      return Math.min(R, h * Math.tan(half));
    }
    case 'taperedball': {
      const half = ((tool.angle ?? 10) * Math.PI) / 360;
      const r = (tool.tipDiameter ?? 1) / 2;
      // Ball of radius r tangent to the cone with half-angle `half`.
      const hTangent = r * (1 - Math.sin(half));
      if (h <= hTangent) return Math.sqrt(r * r - (r - h) * (r - h));
      const rTangent = r * Math.cos(half);
      return Math.min(R, rTangent + (h - hTangent) * Math.tan(half));
    }
  }
}

/** Height above the tip at which the tool surface reaches radius d (∞ beyond the tool). */
export function heightAt(
  tool: Pick<Tool, 'type' | 'diameter' | 'angle' | 'tipDiameter'>,
  d: number,
): number {
  const R = tool.diameter / 2;
  if (d > R + 1e-12) return Infinity;
  switch (tool.type) {
    case 'flat':
      return 0;
    case 'ballnose':
      return R - Math.sqrt(Math.max(0, R * R - d * d));
    case 'vbit': {
      const half = ((tool.angle ?? 90) * Math.PI) / 360;
      return d / Math.tan(half);
    }
    case 'taperedball': {
      const half = ((tool.angle ?? 10) * Math.PI) / 360;
      const r = (tool.tipDiameter ?? 1) / 2;
      const rTangent = r * Math.cos(half);
      if (d <= rTangent) return r - Math.sqrt(Math.max(0, r * r - d * d));
      const hTangent = r * (1 - Math.sin(half));
      return hTangent + (d - rTangent) / Math.tan(half);
    }
  }
}
