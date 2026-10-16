import { multiply, transformSegments, type Matrix } from '../vector/path';
import type { Command } from './history';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type Layer,
  type Machine,
  type Project,
  type ReliefOp,
  type Segment,
  type Stock,
  type TextSource,
  type Tool,
  type Toolpath,
  type Units,
  type Vector,
} from './schema';

/**
 * Document commands (CLAUDE.md: all mutations go through commands). Each one
 * returns a new project and leaves its input untouched; a command that would
 * change nothing returns the same object so History records no step.
 */

export type ProjectCommand = Command<Project>;

/** A blank project: 300 × 200 × 18 mm stock, one layer, GRBL machine. */
export function newProject(overrides: Partial<Pick<Project, 'units' | 'stock'>> = {}): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    units: overrides.units ?? 'mm',
    stock: overrides.stock ?? {
      width: 300,
      height: 200,
      thickness: 18,
      origin: 'bottom-left',
      zZero: 'top',
    },
    layers: [{ id: 'L1', name: 'Design', visible: true, locked: false }],
    vectors: [],
    reliefs: [],
    tools: [],
    toolpaths: [],
    machine: { post: 'grbl', travel: [800, 800, 100], maxFeed: 5000, safeZ: 5 },
  };
}

/** Smallest unused id of the form `${prefix}${n}`. */
export function nextId(prefix: string, taken: Iterable<{ id: string }>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(t.id);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Ids for `count` new items, all unused and distinct. */
export function nextIds(prefix: string, taken: Iterable<{ id: string }>, count: number): string[] {
  const pool = [...taken];
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = nextId(prefix, pool);
    ids.push(id);
    pool.push({ id });
  }
  return ids;
}

export type NewVector = Omit<Vector, 'id'> & { id?: string };

export function addVectors(vectors: readonly NewVector[], label = 'Add vector'): ProjectCommand {
  return {
    label,
    apply: (p) => {
      if (vectors.length === 0) return p;
      const ids = nextIds('v', p.vectors, vectors.length);
      return {
        ...p,
        vectors: [
          ...p.vectors,
          ...vectors.map((v, i) => ({ ...v, id: v.id ?? (ids[i] as string) })),
        ],
      };
    },
  };
}

/** Ids of the vectors a relief op is built from. */
export function reliefOpVectors(op: ReliefOp): string[] {
  switch (op.op) {
    case 'fromVector':
      return [op.vector];
    case 'extrude':
      return [op.rail, op.section, ...(op.endSection ? [op.endSection] : [])];
    case 'spin':
      return [op.section];
    case 'twoRail':
      return [op.railA, op.railB, op.section];
    case 'texture':
      return op.within ? [op.within] : [];
    default:
      return [];
  }
}

export function deleteVectors(ids: readonly string[]): ProjectCommand {
  return {
    label: ids.length === 1 ? 'Delete vector' : 'Delete vectors',
    apply: (p) => {
      const drop = new Set(ids);
      if (!p.vectors.some((v) => drop.has(v.id))) return p;
      // Toolpaths and relief ops must not point at deleted vectors.
      // Drop toolpaths that lost all their shapes; 3D toolpaths with no boundary stay.
      const toolpaths = p.toolpaths
        .filter((tp) => tp.vectors.length === 0 || tp.vectors.some((v) => !drop.has(v)))
        .map((tp) => ({ ...tp, vectors: tp.vectors.filter((v) => !drop.has(v)) })) as Toolpath[];
      const reliefs = p.reliefs.map((r) => ({
        ...r,
        ops: r.ops.filter((op) => !reliefOpVectors(op).some((v) => drop.has(v))),
      }));
      return { ...p, vectors: p.vectors.filter((v) => !drop.has(v.id)), toolpaths, reliefs };
    },
  };
}

/** Applies an affine transform (move, scale, rotate, mirror) to vectors. */
export function transformVectors(
  ids: readonly string[],
  m: Matrix,
  label = 'Transform',
): ProjectCommand {
  return {
    label,
    apply: (p) => {
      const set = new Set(ids);
      if (!p.vectors.some((v) => set.has(v.id))) return p;
      if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0)
        return p;
      return {
        ...p,
        vectors: p.vectors.map((v) => (set.has(v.id) ? transformVector(v, m) : v)),
      };
    },
  };
}

/** A vector moved by `m`; a text vector's placement follows. */
function transformVector<V extends Omit<Vector, 'id'>>(v: V, m: Matrix): V {
  const segments = transformSegments(v.segments, m);
  return v.text
    ? { ...v, segments, text: { ...v.text, matrix: [...multiply(m, v.text.matrix)] } }
    : { ...v, segments };
}

/** Replaces a text vector's source and outline (the outline laid out by the app). */
export function setVectorText(
  id: string,
  text: TextSource,
  segments: readonly Segment[],
): ProjectCommand {
  return {
    label: 'Edit text',
    apply: (p) => {
      if (!p.vectors.some((x) => x.id === id)) return p;
      return {
        ...p,
        vectors: p.vectors.map((x) => (x.id === id ? { ...x, segments: [...segments], text } : x)),
      };
    },
  };
}

/** Replaces one vector's segments (node edits). */
export function setVectorSegments(
  id: string,
  segments: readonly Segment[],
  closed?: boolean,
  label = 'Edit nodes',
): ProjectCommand {
  return {
    label,
    apply: (p) => {
      const v = p.vectors.find((x) => x.id === id);
      if (!v) return p;
      return {
        ...p,
        // The outline no longer comes from the text, so it becomes a plain shape.
        vectors: p.vectors.map((x) =>
          x.id === id
            ? { id: x.id, layer: x.layer, closed: closed ?? x.closed, segments: [...segments] }
            : x,
        ),
      };
    },
  };
}

/** Copies vectors with new ids (optionally transformed). */
export function duplicateVectors(ids: readonly string[], m?: Matrix): ProjectCommand {
  return {
    label: 'Duplicate',
    apply: (p) => {
      const src = p.vectors.filter((v) => ids.includes(v.id));
      if (src.length === 0) return p;
      return addVectors(
        src.map((v) => {
          const copy: NewVector = {
            layer: v.layer,
            closed: v.closed,
            segments: v.segments,
            ...(v.text && { text: v.text }),
          };
          return m ? transformVector(copy, m) : copy;
        }),
        'Duplicate',
      ).apply(p);
    },
  };
}

export function moveVectorsToLayer(ids: readonly string[], layer: string): ProjectCommand {
  return {
    label: 'Move to layer',
    apply: (p) => {
      if (!p.layers.some((l) => l.id === layer)) return p;
      const set = new Set(ids);
      if (!p.vectors.some((v) => set.has(v.id) && v.layer !== layer)) return p;
      return { ...p, vectors: p.vectors.map((v) => (set.has(v.id) ? { ...v, layer } : v)) };
    },
  };
}

export function addLayer(name: string): ProjectCommand {
  return {
    label: 'Add layer',
    apply: (p) => ({
      ...p,
      layers: [...p.layers, { id: nextId('L', p.layers), name, visible: true, locked: false }],
    }),
  };
}

export function updateLayer(id: string, patch: Partial<Omit<Layer, 'id'>>): ProjectCommand {
  return {
    label: 'Edit layer',
    apply: (p) => {
      const l = p.layers.find((x) => x.id === id);
      if (!l || Object.entries(patch).every(([k, v]) => l[k as keyof Layer] === v)) return p;
      return { ...p, layers: p.layers.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    },
  };
}

/** Deletes a layer and its vectors. The last layer cannot be deleted. */
export function deleteLayer(id: string): ProjectCommand {
  return {
    label: 'Delete layer',
    apply: (p) => {
      if (p.layers.length <= 1 || !p.layers.some((l) => l.id === id)) return p;
      const doomed = p.vectors.filter((v) => v.layer === id).map((v) => v.id);
      const q = deleteVectors(doomed).apply(p);
      return { ...q, layers: q.layers.filter((l) => l.id !== id) };
    },
  };
}

export function setStock(stock: Stock): ProjectCommand {
  return { label: 'Stock setup', apply: (p) => ({ ...p, stock }) };
}

export function setUnits(units: Units): ProjectCommand {
  return { label: 'Units', apply: (p) => (p.units === units ? p : { ...p, units }) };
}

export function setMachine(machine: Machine): ProjectCommand {
  return { label: 'Machine setup', apply: (p) => ({ ...p, machine }) };
}

// --- Tools (T2.1) -------------------------------------------------------------

export type NewTool = Omit<Tool, 'id'> & { id?: string };

export function addTool(tool: NewTool): ProjectCommand {
  return {
    label: 'Add tool',
    apply: (p) => ({ ...p, tools: [...p.tools, { ...tool, id: tool.id ?? nextId('t', p.tools) }] }),
  };
}

export function updateTool(id: string, tool: Omit<Tool, 'id'>): ProjectCommand {
  return {
    label: 'Edit tool',
    apply: (p) =>
      p.tools.some((t) => t.id === id)
        ? { ...p, tools: p.tools.map((t) => (t.id === id ? { ...tool, id } : t)) }
        : p,
  };
}

/** Deletes a tool. Refuses (no change) while a toolpath uses it. */
export function deleteTool(id: string): ProjectCommand {
  return {
    label: 'Delete tool',
    apply: (p) =>
      !p.tools.some((t) => t.id === id) ||
      p.toolpaths.some(
        (tp) => tp.tool === id || (tp.type === 'rest3d' && tp.params.restFrom === id),
      )
        ? p
        : { ...p, tools: p.tools.filter((t) => t.id !== id) },
  };
}

// --- Toolpaths (M2) ---------------------------------------------------------

export type NewToolpath = Toolpath extends infer T
  ? T extends Toolpath
    ? Omit<T, 'id'> & { id?: string }
    : never
  : never;

export function addToolpath(toolpath: NewToolpath): ProjectCommand {
  return {
    label: 'Add toolpath',
    apply: (p) => ({
      ...p,
      toolpaths: [
        ...p.toolpaths,
        { ...toolpath, id: toolpath.id ?? nextId('tp', p.toolpaths) } as Toolpath,
      ],
    }),
  };
}

export function updateToolpath(toolpath: Toolpath): ProjectCommand {
  return {
    label: 'Edit toolpath',
    apply: (p) =>
      p.toolpaths.some((t) => t.id === toolpath.id)
        ? { ...p, toolpaths: p.toolpaths.map((t) => (t.id === toolpath.id ? toolpath : t)) }
        : p,
  };
}

export function deleteToolpath(id: string): ProjectCommand {
  return {
    label: 'Delete toolpath',
    apply: (p) =>
      p.toolpaths.some((t) => t.id === id)
        ? { ...p, toolpaths: p.toolpaths.filter((t) => t.id !== id) }
        : p,
  };
}

// --- Reliefs (M4) -------------------------------------------------------------

/** A new empty relief covering the material at `resolution` mm per cell. */
export function addRelief(
  resolution: number,
  id?: string,
  side: 'front' | 'back' = 'front',
): ProjectCommand {
  return {
    label: side === 'back' ? 'New back relief' : 'New relief',
    apply: (p) => {
      if (!(resolution > 0)) return p;
      const rid = id ?? nextId('r', p.reliefs);
      const cols = Math.max(1, Math.ceil(p.stock.width / resolution));
      const rows = Math.max(1, Math.ceil(p.stock.height / resolution));
      return {
        ...p,
        reliefs: [
          ...p.reliefs,
          {
            id: rid,
            resolution,
            cols,
            rows,
            data: `reliefs/${rid}.f32`,
            ops: [],
            ...(side === 'back' && { side }),
          },
        ],
      };
    },
  };
}

export function deleteRelief(id: string): ProjectCommand {
  return {
    label: 'Delete relief',
    apply: (p) =>
      p.reliefs.some((r) => r.id === id)
        ? { ...p, reliefs: p.reliefs.filter((r) => r.id !== id) }
        : p,
  };
}

const RELIEF_OP_LABEL: Record<ReliefOp['op'], string> = {
  fromVector: 'Shape to relief',
  fromImage: 'Image to relief',
  extrude: 'Extrude',
  spin: 'Spin',
  twoRail: 'Two-rail sweep',
  texture: 'Texture',
  sculpt: 'Sculpt',
  smooth: 'Smooth relief',
  scale: 'Scale relief',
  offset: 'Offset relief',
  invert: 'Invert relief',
};

/** Appends an op, or replaces the op at `index`. */
export function setReliefOp(reliefId: string, op: ReliefOp, index?: number): ProjectCommand {
  return {
    label: RELIEF_OP_LABEL[op.op],
    apply: (p) => {
      const r = p.reliefs.find((x) => x.id === reliefId);
      if (!r) return p;
      const ops =
        index === undefined ? [...r.ops, op] : r.ops.map((o, i) => (i === index ? op : o));
      return { ...p, reliefs: p.reliefs.map((x) => (x.id === reliefId ? { ...x, ops } : x)) };
    },
  };
}

export function removeReliefOp(reliefId: string, index: number): ProjectCommand {
  return {
    label: 'Remove relief step',
    apply: (p) => {
      const r = p.reliefs.find((x) => x.id === reliefId);
      if (!r || !r.ops[index]) return p;
      const ops = r.ops.filter((_, i) => i !== index);
      return { ...p, reliefs: p.reliefs.map((x) => (x.id === reliefId ? { ...x, ops } : x)) };
    },
  };
}
