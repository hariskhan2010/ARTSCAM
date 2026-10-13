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

export const vectorSchema = z.strictObject({
  id,
  layer: id,
  closed: z.boolean(),
  segments: z.array(segmentSchema),
});

export const reliefProfileSchema = z.enum(['flat', 'dome', 'angle', 'round']);
export const combineModeSchema = z.enum(['add', 'subtract', 'mergeHigh', 'mergeLow']);

export const reliefOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('fromVector'),
    vector: id,
    profile: reliefProfileSchema,
    height: finite,
    mode: combineModeSchema,
  }),
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
});

export const toolSchema = z.strictObject({
  id,
  type: z.enum(['flat', 'ballnose', 'vbit', 'taperedball']),
  diameter: positive,
  /** Included angle in degrees (V-bit, tapered ball). */
  angle: positive.max(180).optional(),
  stepDown: positive,
  stepOver: positive,
  /** mm/min */
  feed: positive,
  /** mm/min */
  plunge: positive,
  rpm: positive,
});

export const toolpathSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id,
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
      if (!vectors.has(op.vector)) missing(['reliefs', i, 'ops', j, 'vector'], 'vector', op.vector);
    });
  });
  p.toolpaths.forEach((tp, i) => {
    if (!tools.has(tp.tool)) missing(['toolpaths', i, 'tool'], 'tool', tp.tool);
    tp.vectors.forEach((v, j) => {
      if (!vectors.has(v)) missing(['toolpaths', i, 'vectors', j], 'vector', v);
    });
  });
});

export type Units = z.infer<typeof unitsSchema>;
export type Stock = z.infer<typeof stockSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type Vector = z.infer<typeof vectorSchema>;
export type ReliefOp = z.infer<typeof reliefOpSchema>;
export type Relief = z.infer<typeof reliefSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type Toolpath = z.infer<typeof toolpathSchema>;
export type Machine = z.infer<typeof machineSchema>;
export type Project = z.infer<typeof projectSchema>;
