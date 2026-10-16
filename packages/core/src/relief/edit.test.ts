import { describe, expect, it } from 'vitest';
import { addRelief, addVectors, deleteVectors, newProject, setReliefOp } from '../model/commands';
import { projectSchema, type Project, type ReliefOp } from '../model/schema';
import { rectangle } from '../vector/shapes';
import { evaluateRelief, type Grid } from './relief';

/** Box shape: x 20–50, y 20–40 on a 100 × 60 material, 0.25 mm cells. */
function project(ops: ReliefOp[]): Project {
  let p: Project = newProject({
    stock: { width: 100, height: 60, thickness: 20, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([
    { id: 'box', layer: 'L1', closed: true, segments: rectangle(20, 20, 30, 20) },
  ]).apply(p);
  p = addRelief(0.25, 'r').apply(p);
  for (const op of ops) p = setReliefOp('r', op).apply(p);
  return projectSchema.parse(p);
}

function build(ops: ReliefOp[]): Grid {
  const p = project(ops);
  return evaluateRelief(p.reliefs[0]!, p);
}

/** Index of the cell whose centre is nearest (x, y). */
const idx = (g: Grid, x: number, y: number) =>
  Math.round(y / g.resolution - 0.5) * g.cols + Math.round(x / g.resolution - 0.5);

/** Cell centre of the cell nearest (x, y). */
const centre = (g: Grid, x: number, y: number): [number, number] => {
  const i = idx(g, x, y);
  return [((i % g.cols) + 0.5) * g.resolution, (Math.floor(i / g.cols) + 0.5) * g.resolution];
};

/** Expected grid: `fn(height, x, y)` at every cell centre, rounded to float32. */
function expected(g: Grid, fn: (h: number, x: number, y: number) => number): Float32Array {
  return g.z.map((h, i) =>
    fn(h, ((i % g.cols) + 0.5) * g.resolution, (Math.floor(i / g.cols) + 0.5) * g.resolution),
  );
}

/** Number of cells that differ (bit for bit). */
function mismatches(a: Float32Array, b: Float32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) n++;
  return n + Math.abs(a.length - b.length);
}

const inBox = (x: number, y: number) => x > 20 && x < 50 && y > 20 && y < 40;

// A non-uniform starting relief: 4 mm everywhere plus ridges.
const BASE: ReliefOp[] = [
  { op: 'offset', amount: 4 },
  { op: 'texture', pattern: 'lines', spacing: 3, height: 1, angle: 30, mode: 'add' },
];

describe('relief edits (T6.9)', () => {
  it('linear fade: 1 behind the start, 0 past the end, linear between', () => {
    const before = build(BASE);
    const g = build([...BASE, { op: 'fade', from: [20, 30], to: [80, 30], kind: 'line' }]);
    for (const [x, y] of [
      [10, 5],
      [20, 30],
      [35, 12],
      [50, 30],
      [62, 55],
      [79.9, 1],
      [80.2, 30],
      [95, 40],
    ] as const) {
      const [cx] = centre(g, x, y);
      const f = Math.min(1, Math.max(0, 1 - (cx - 20) / 60));
      const i = idx(g, x, y);
      expect(g.z[i], `${x},${y}`).toBe(Math.fround(before.z[i]! * f));
    }
    // Halfway along: half the height.
    const flat = build([
      { op: 'offset', amount: 4 },
      { op: 'fade', from: [0, 0], to: [100, 0], kind: 'line' },
    ]);
    expect(flat.z[idx(flat, 49.875, 30)]! + flat.z[idx(flat, 50.125, 30)]!).toBeCloseTo(4, 5);
    expect(flat.z[idx(flat, 50.125, 30)]).toBeCloseTo(4 * (1 - 50.125 / 100), 5);
  });

  it('linear fade follows the from→to direction (diagonal)', () => {
    const g = build([
      { op: 'offset', amount: 2 },
      { op: 'fade', from: [10, 10], to: [40, 50], kind: 'line' },
    ]);
    const [cx, cy] = centre(g, 30, 20);
    const t = ((cx - 10) * 30 + (cy - 10) * 40) / (50 * 50);
    expect(g.z[idx(g, 30, 20)]).toBe(Math.fround(2 * (1 - t)));
  });

  it('radial fade: 1 at the centre, 0 at the radius and beyond', () => {
    const before = build(BASE);
    const g = build([...BASE, { op: 'fade', from: [50, 30], to: [50, 50], kind: 'radial' }]);
    for (const [x, y] of [
      [50, 30],
      [60, 30],
      [50, 40],
      [35, 20],
      [65, 45],
      [50, 51],
      [5, 5],
    ] as const) {
      const [cx, cy] = centre(g, x, y);
      const f = Math.max(0, 1 - Math.hypot(cx - 50, cy - 30) / 20);
      const i = idx(g, x, y);
      expect(g.z[i], `${x},${y}`).toBe(Math.fround(before.z[i]! * f));
    }
  });

  it('fade within a shape leaves every cell outside it untouched', () => {
    const before = build(BASE);
    const g = build([
      ...BASE,
      { op: 'fade', from: [20, 30], to: [50, 30], kind: 'line', within: 'box' },
    ]);
    let changed = 0;
    const want = expected(before, (h, x, y) => {
      if (!inBox(x, y)) return h;
      changed++;
      return h * (1 - (x - 20) / 30);
    });
    expect(mismatches(g.z, want)).toBe(0);
    expect(changed).toBe(120 * 80);
  });

  it('clip: keep inside zeroes the outside; keep outside zeroes the inside', () => {
    const before = build(BASE);
    const inside = build([...BASE, { op: 'clip', vector: 'box', keep: 'inside' }]);
    const outside = build([...BASE, { op: 'clip', vector: 'box', keep: 'outside' }]);
    expect(
      mismatches(
        inside.z,
        expected(before, (h, x, y) => (inBox(x, y) ? h : 0)),
      ),
    ).toBe(0);
    expect(
      mismatches(
        outside.z,
        expected(before, (h, x, y) => (inBox(x, y) ? 0 : h)),
      ),
    ).toBe(0);
  });

  it('scale inside a shape: inside cells × factor, outside cells bit-identical', () => {
    const before = build(BASE);
    const g = build([...BASE, { op: 'scale', factor: 0.3, within: 'box' }]);
    expect(
      mismatches(
        g.z,
        expected(before, (h, x, y) => (inBox(x, y) ? h * 0.3 : h)),
      ),
    ).toBe(0);
    // Without a shape it still scales everything (older projects).
    const all = build([...BASE, { op: 'scale', factor: 0.3 }]);
    expect(all.z[idx(all, 5, 5)]).toBe(Math.fround(before.z[idx(before, 5, 5)]! * 0.3));
  });

  it('open or missing shapes are reported', () => {
    expect(() => build([{ op: 'clip', vector: 'nope', keep: 'inside' }])).toThrow(/unknown/);
    let p = project([]);
    p = addVectors([
      {
        id: 'open',
        layer: 'L1',
        closed: false,
        segments: [
          { type: 'move', p: [0, 0] },
          { type: 'line', p: [10, 10] },
        ],
      },
    ]).apply(p);
    p = setReliefOp('r', { op: 'clip', vector: 'open', keep: 'inside' }).apply(p);
    expect(() => evaluateRelief(p.reliefs[0]!, p)).toThrow(/closed/);
    expect(() => build([{ op: 'fade', from: [5, 5], to: [5, 5], kind: 'line' }])).toThrow(
      /two different points/,
    );
  });

  it('deleting the shape removes the steps that use it', () => {
    let p = project([
      { op: 'offset', amount: 1 },
      { op: 'fade', from: [0, 0], to: [10, 0], kind: 'radial', within: 'box' },
      { op: 'fade', from: [0, 0], to: [10, 0], kind: 'line' },
      { op: 'clip', vector: 'box', keep: 'outside' },
      { op: 'scale', factor: 2, within: 'box' },
      { op: 'scale', factor: 2 },
    ]);
    p = deleteVectors(['box']).apply(p);
    expect(p.reliefs[0]!.ops.map((o) => o.op)).toEqual(['offset', 'fade', 'scale']);
    expect(projectSchema.safeParse(p).success).toBe(true);
  });
});
