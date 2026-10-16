import { z } from 'zod';

/**
 * Project document schema (plan.md §6).
 *
 * All lengths are millimetres (float64), whatever `units` says: `units` is the
 * display/editing unit only (CLAUDE.md, plan.md §5 rule 5).
 */

export const PROJECT_FORMAT = 'naqsh-project';
export const PROJECT_VERSION = '0.1';

const id = z.string().min(1);
const finite = z.number().finite();
const positive = finite.positive();
const nonNegative = finite.nonnegative();
const point = z.tuple([finite, finite]);

export const unitsSchema = z.enum(['mm', 'inch']);

export const stockSchema = z.strictObject({
  width: positive,
  height: positive,
  thickness: positive,
  origin: z.enum(['bottom-left', 'top-left', 'bottom-right', 'top-right', 'center']),
  zZero: z.enum(['top', 'bed']),
});

export const layerSchema = z.strictObject({
  id,
  name: z.string(),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const segmentSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), p: point }),
  z.strictObject({ type: z.literal('line'), p: point }),
  z.strictObject({ type: z.literal('quad'), c: point, p: point }),
  z.strictObject({ type: z.literal('cubic'), c1: point, c2: point, p: point }),
  z.strictObject({ type: z.literal('close') }),
]);

/**
 * Where a text vector came from, so it can be edited again. The outline in
 * `segments` is the text laid out at the origin, then placed by `matrix`
 * (the text tool's click point, plus any later move/rotate/scale). Edits that
 * change the outline directly (node edits, offsets, booleans) drop it.
 */
export const textSourceSchema = z.strictObject({
  content: z.string(),
  fontId: z.string(),
  size: positive,
  align: z.enum(['left', 'center', 'right']),
  matrix: z.tuple([finite, finite, finite, finite, finite, finite]),
});

export const vectorSchema = z.strictObject({
  id,
  layer: id,
  closed: z.boolean(),
  segments: z.array(segmentSchema),
  text: textSourceSchema.optional(),
});

export const reliefProfileSchema = z.enum(['flat', 'dome', 'angle', 'round']);
export const combineModeSchema = z.enum(['add', 'subtract', 'mergeHigh', 'mergeLow', 'zero']);

/**
 * Relief operations, applied in order to a grid that starts at 0 (plan.md
 * §4 "Relief"). The grid is derived from these ops, like toolpaths from
 * their parameters, so undo/redo of an op is undo/redo of the relief.
 */
export const reliefOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('fromVector'),
    vector: id,
    /**
     * flat: constant `height`; dome: smooth pillow peaking at `height`;
     * angle: slopes up at `angle` degrees from the edge, capped at `height`;
     * round: rounded edge of radius `height`, flat on top.
     */
    profile: reliefProfileSchema,
    height: finite,
    /** Slope for the angle profile, degrees (default 45). */
    angle: positive.max(89).optional(),
    /** Added under the profile (a raised base plate). Default 0. */
    base: finite.optional(),
    mode: combineModeSchema,
  }),
  z.strictObject({
    op: z.literal('fromImage'),
    /** Id of a grayscale image stored at images/<id>.gray in the project zip. */
    image: id,
    /** Image size in pixels. */
    px: z.number().int().positive(),
    py: z.number().int().positive(),
    /** Placement rectangle on the material (mm, bottom-left corner). */
    x: finite,
    y: finite,
    w: positive,
    h: positive,
    /** Height of white (or black when inverted), mm. */
    height: finite,
    invert: z.boolean().optional(),
    /** Blur radius before use, mm. */
    blur: nonNegative.optional(),
    mode: combineModeSchema,
  }),
  /**
   * Sweep a cross-section (an open vector: ends on the base, height measured
   * from the line between its ends) along a rail vector. With `endSection`
   * the shape blends from one to the other along the rail.
   */
  z.strictObject({
    op: z.literal('extrude'),
    rail: id,
    section: id,
    endSection: id.optional(),
    /** Width across the rail, mm. Default: the section's own width. */
    width: positive.optional(),
    mode: combineModeSchema,
  }),
  /** Turn a cross-section around a centre: its left end at the centre, right end at the rim. */
  z.strictObject({
    op: z.literal('spin'),
    section: id,
    centre: point,
    mode: combineModeSchema,
  }),
  /** Stretch a cross-section between two rails (left end on rail A). */
  z.strictObject({
    op: z.literal('twoRail'),
    railA: id,
    railB: id,
    section: id,
    /** Scale heights with the distance between the rails. Default false. */
    scaleHeight: z.boolean().optional(),
    mode: combineModeSchema,
  }),
  /** A repeating pattern over the material, or inside a closed shape. */
  z.strictObject({
    op: z.literal('texture'),
    pattern: z.enum(['lines', 'dimples', 'hammered', 'weave']),
    /** Repeat distance, mm. */
    spacing: positive,
    height: finite,
    /** Turn of the pattern, degrees counter-clockwise. Default 0. */
    angle: finite.optional(),
    /** Closed shape to limit it to. Default: the whole relief. */
    within: id.optional(),
    mode: combineModeSchema,
  }),
  /** One sculpting brush stroke: the brush centre's path, world mm. */
  z.strictObject({
    op: z.literal('sculpt'),
    tool: z.enum(['raise', 'lower', 'smooth']),
    radius: positive,
    /** mm for raise/lower; 0–1 blend for smooth. */
    strength: nonNegative,
    points: z.array(point).min(1),
  }),
  z.strictObject({
    op: z.literal('smooth'),
    radius: positive,
    passes: z.number().int().positive().max(20),
  }),
  /**
   * Fade heights out: × 1 at `from`, falling linearly to × 0 at `to`. line:
   * along the from→to direction (1 behind `from`, 0 past `to`); radial: with
   * distance from `from`, 0 at |to − from| and beyond.
   */
  z.strictObject({
    op: z.literal('fade'),
    from: point,
    to: point,
    kind: z.enum(['line', 'radial']),
    /** Closed shape to limit it to. Default: the whole relief. */
    within: id.optional(),
  }),
  /** Zero every cell on the other side of a closed shape (trim to it, or cut it out). */
  z.strictObject({
    op: z.literal('clip'),
    vector: id,
    keep: z.enum(['inside', 'outside']),
  }),
  z.strictObject({
    op: z.literal('scale'),
    factor: finite,
    /** Closed shape to limit it to. Default: the whole relief. */
    within: id.optional(),
  }),
  z.strictObject({ op: z.literal('offset'), amount: finite }),
  z.strictObject({ op: z.literal('invert') }),
]);

export const reliefSchema = z.strictObject({
  id,
  /** Grid spacing in mm per cell. */
  resolution: positive,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  /** Path of the little-endian Float32 height grid inside the project zip. */
  data: z.string().min(1),
  ops: z.array(reliefOpSchema),
  /**
   * Which face it is carved into. A back relief is designed seen from the
   * front (so it lines up with the front), and machined after turning the
   * material over left to right. Default front.
   */
  side: z.enum(['front', 'back']).optional(),
});

export const toolSchema = z.strictObject({
  id,
  /** Display name in the tool library, e.g. "6 mm flat end mill". */
  name: z.string().optional(),
  type: z.enum(['flat', 'ballnose', 'vbit', 'taperedball']),
  diameter: positive,
  /** Included angle in degrees (V-bit, tapered ball). */
  angle: positive.max(180).optional(),
  /** Tip diameter (mm) of a tapered ball nose. */
  tipDiameter: positive.optional(),
  flutes: z.number().int().positive().optional(),
  /** Max depth per pass (mm). */
  stepDown: positive,
  /** Distance between adjacent passes (mm). */
  stepOver: positive,
  /** mm/min */
  feed: positive,
  /** mm/min */
  plunge: positive,
  rpm: positive,
});

const cutDirection = z.enum(['climb', 'conventional']);

export const toolpathSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id,
    name: z.string().optional(),
    type: z.literal('profile'),
    tool: id,
    vectors: z.array(id).min(1),
    params: z.strictObject({
      side: z.enum(['outside', 'inside', 'on']),
      depth: positive,
      tabs: z
        .strictObject({
          count: z.number().int().nonnegative(),
          width: positive,
          height: positive,
        })
        .optional(),
      /** Ramp into each pass along the path over this length (mm) instead of plunging. */
      ramp: z.strictObject({ length: positive }).optional(),
      /** Default climb (for a clockwise spindle). */
      direction: cutDirection.optional(),
      /** Material left on the wall for a finishing pass (mm). Default 0. */
      allowance: nonNegative.optional(),
    }),
  }),
  z.strictObject({
    id,
    name: z.string().optional(),
    type: z.literal('pocket'),
    tool: id,
    vectors: z.array(id).min(1),
    params: z.strictObject({
      depth: positive,
      /** Concentric offsets, or zig-zag raster lines plus a finishing contour. */
      strategy: z.enum(['offset', 'raster']),
      /** Raster line angle in degrees (0 = along X). */
      angle: finite.optional(),
      direction: cutDirection.optional(),
      allowance: nonNegative.optional(),
    }),
  }),
  z.strictObject({
    id,
    name: z.string().optional(),
    type: z.literal('vcarve'),
    tool: id,
    vectors: z.array(id).min(1),
    params: z.strictObject({
      /** Deepest cut (mm); wider areas get a flat bottom here. Default: the bit's full cone depth. */
      depth: positive,
      /** Spacing (mm) between carving rings. Smaller is truer to the ideal V surface. Default 0.1. */
      step: positive.optional(),
      direction: cutDirection.optional(),
    }),
  }),
  z.strictObject({
    id,
    name: z.string().optional(),
    type: z.literal('rough3d'),
    tool: id,
    relief: id,
    /** Optional boundary shapes; empty = the whole material. */
    vectors: z.array(id),
    params: z.strictObject({
      /** Material left above the relief for the finishing pass (mm). Default 0.5. */
      allowance: nonNegative.optional(),
    }),
  }),
  z.strictObject({
    id,
    name: z.string().optional(),
    type: z.literal('finish3d'),
    tool: id,
    relief: id,
    vectors: z.array(id),
    params: z.strictObject({
      /** Raster direction: lines along X, along Y, or both (X then Y). */
      pattern: z.enum(['x', 'y', 'xy']),
      /** Distance between raster lines (mm). Default: the tool's step-over. */
      stepOver: positive.optional(),
    }),
  }),
  z.strictObject({
    id,
    name: z.string().optional(),
    type: z.literal('drill'),
    tool: id,
    vectors: z.array(id).min(1),
    params: z.strictObject({
      depth: positive,
      /** Peck depth (mm); retract to clear chips after each peck. Omit for one plunge. */
      peck: positive.optional(),
      /** Pause at the bottom of each hole (seconds). */
      dwell: positive.optional(),
    }),
  }),
]);

export const machineSchema = z.strictObject({
  post: z.enum(['grbl', 'mach3', 'linuxcnc', 'generic']),
  /** Travel in X, Y, Z (mm). */
  travel: z.tuple([positive, positive, positive]),
  /** mm/min */
  maxFeed: positive,
  safeZ: nonNegative,
  /** Rapid (G0) rate in mm/min, for time estimates. Default: maxFeed. */
  rapidFeed: positive.optional(),
  /** Per-axis acceleration X, Y, Z in mm/s², for time estimates. Default 500, 500, 200. */
  acceleration: z.tuple([positive, positive, positive]).optional(),
  /** GRBL junction deviation (mm), for time estimates. Default 0.01. */
  junctionDeviation: positive.optional(),
});

const projectShape = z.strictObject({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  units: unitsSchema,
  stock: stockSchema,
  layers: z.array(layerSchema),
  vectors: z.array(vectorSchema),
  reliefs: z.array(reliefSchema),
  tools: z.array(toolSchema),
  toolpaths: z.array(toolpathSchema),
  machine: machineSchema,
});

/** Expected location of a relief's binary grid in the project zip. */
export function reliefDataPath(reliefId: string): string {
  return `reliefs/${reliefId}.f32`;
}

/** Full project schema, including id uniqueness and cross-reference checks. */
export const projectSchema = projectShape.superRefine((p, ctx) => {
  const uniqueIds = (key: 'layers' | 'vectors' | 'reliefs' | 'tools' | 'toolpaths') => {
    const seen = new Set<string>();
    p[key].forEach((item, i) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [key, i, 'id'],
          message: `Duplicate id "${item.id}"`,
        });
      }
      seen.add(item.id);
    });
    return seen;
  };
  const layers = uniqueIds('layers');
  const vectors = uniqueIds('vectors');
  uniqueIds('reliefs');
  const tools = uniqueIds('tools');
  uniqueIds('toolpaths');

  const missing = (path: (string | number)[], kind: string, ref: string) =>
    ctx.addIssue({ code: 'custom', path, message: `Unknown ${kind} "${ref}"` });

  p.vectors.forEach((v, i) => {
    if (!layers.has(v.layer)) missing(['vectors', i, 'layer'], 'layer', v.layer);
  });
  p.reliefs.forEach((r, i) => {
    if (r.data !== reliefDataPath(r.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reliefs', i, 'data'],
        message: `Relief data must be "${reliefDataPath(r.id)}"`,
      });
    }
    r.ops.forEach((op, j) => {
      if (op.op === 'fromVector' && !vectors.has(op.vector)) {
        missing(['reliefs', i, 'ops', j, 'vector'], 'vector', op.vector);
      }
    });
  });
  p.toolpaths.forEach((tp, i) => {
    if (!tools.has(tp.tool)) missing(['toolpaths', i, 'tool'], 'tool', tp.tool);
    if ('relief' in tp && !p.reliefs.some((r) => r.id === tp.relief)) {
      missing(['toolpaths', i, 'relief'], 'relief', tp.relief);
    }
    tp.vectors.forEach((v, j) => {
      if (!vectors.has(v)) missing(['toolpaths', i, 'vectors', j], 'vector', v);
    });
  });
});

export type Units = z.infer<typeof unitsSchema>;
export type Stock = z.infer<typeof stockSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type TextSource = z.infer<typeof textSourceSchema>;
export type Vector = z.infer<typeof vectorSchema>;
export type ReliefOp = z.infer<typeof reliefOpSchema>;
export type Relief = z.infer<typeof reliefSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type Toolpath = z.infer<typeof toolpathSchema>;
export type Machine = z.infer<typeof machineSchema>;
export type Project = z.infer<typeof projectSchema>;
