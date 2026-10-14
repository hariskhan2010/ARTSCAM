import { describe, expect, it } from 'vitest';
import { addVectors, newProject } from '../model/commands';
import type { Project, Relief, ReliefOp } from '../model/schema';
import { flatten } from '../vector/flatten';
import { ellipse, rectangle } from '../vector/shapes';
import {
  distanceInside,
  evaluateRelief,
  gridRange,
  rasterize,
  reliefSize,
  type Grid,
} from './relief';

const RES = 0.25;

function setup(
  ops: ReliefOp[],
  extra: Parameters<typeof addVectors>[0] = [],
): { p: Project; relief: Relief } {
  let p = newProject({
    stock: { width: 120, height: 80, thickness: 18, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([
    { id: 'circle', layer: 'L1', closed: true, segments: ellipse(40, 40, 20) },
    { id: 'square', layer: 'L1', closed: true, segments: rectangle(70, 20, 40, 40) },
    ...extra,
  ]).apply(p);
  const { cols, rows } = reliefSize(p.stock, RES);
  return { p, relief: { id: 'r1', resolution: RES, cols, rows, data: 'reliefs/r1.f32', ops } };
}

/** Height at world point (x, y). */
const at = (g: Grid, x: number, y: number) =>
  g.z[Math.floor(y / g.resolution) * g.cols + Math.floor(x / g.resolution)]!;

describe('relief engine (T4.1)', () => {
  it('sizes the grid to cover the material', () => {
    expect(reliefSize({ width: 120, height: 80 }, 0.25)).toEqual({ cols: 480, rows: 320 });
    expect(reliefSize({ width: 10.1, height: 1 }, 1)).toEqual({ cols: 11, rows: 1 });
  });

  it('distance transform matches the true distance to a circle edge within a cell', () => {
    const { p, relief } = setup([]);
    const g: Grid = {
      cols: relief.cols,
      rows: relief.rows,
      resolution: RES,
      z: new Float32Array(0),
    };
    const rings = flatten(p.vectors[0]!.segments, 0.01, true).map((x) => x.points);
    const mask = rasterize(rings, g);
    const dist = distanceInside(mask, g, rings);
    let worst = 0;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        if (!mask[i]) continue;
        const truth = 20 - Math.hypot((c + 0.5) * RES - 40, (r + 0.5) * RES - 40);
        worst = Math.max(worst, Math.abs(dist[i]! - truth));
      }
    expect(worst).toBeLessThanOrEqual(RES);
  });

  it('dome: a smooth pillow peaking at the height (hemisphere on a circle)', () => {
    const { p, relief } = setup([
      { op: 'fromVector', vector: 'circle', profile: 'dome', height: 10, mode: 'add' },
    ]);
    const g = evaluateRelief(relief, p);
    expect(at(g, 40, 40)).toBeCloseTo(10, 0);
    // On a circle the dome is a scaled hemisphere: h = H·sqrt(1 − (ρ/R)²).
    for (const rho of [5, 10, 15]) {
      expect(at(g, 40 + rho, 40)).toBeCloseTo(10 * Math.sqrt(1 - (rho / 20) ** 2), 0);
    }
    expect(at(g, 5, 5)).toBe(0); // outside
  });

  it('angle: slopes at the angle from the edge and is capped at the height', () => {
    const { p, relief } = setup([
      { op: 'fromVector', vector: 'square', profile: 'angle', height: 5, angle: 45, mode: 'add' },
    ]);
    const g = evaluateRelief(relief, p);
    expect(at(g, 72, 40)).toBeCloseTo(2, 0); // 2 mm in from the left edge
    expect(at(g, 90, 40)).toBeCloseTo(5, 5); // capped plateau
  });

  it('round: quarter-circle edge of radius = height, flat on top', () => {
    const { p, relief } = setup([
      { op: 'fromVector', vector: 'square', profile: 'round', height: 3, mode: 'add' },
    ]);
    const g = evaluateRelief(relief, p);
    expect(at(g, 71, 40)).toBeCloseTo(Math.sqrt(9 - 4), 0); // d = 1
    expect(at(g, 90, 40)).toBeCloseTo(3, 5);
  });

  it('flat with a base, and the combine modes', () => {
    const flat = (
      height: number,
      mode: Extract<ReliefOp, { op: 'fromVector' }>['mode'],
    ): ReliefOp => ({
      op: 'fromVector',
      vector: 'circle',
      profile: 'flat',
      height,
      mode,
    });
    const run = (ops: ReliefOp[]) => {
      const { p, relief } = setup(ops);
      return at(evaluateRelief(relief, p), 40, 40);
    };
    expect(run([flat(4, 'add'), flat(3, 'add')])).toBeCloseTo(7, 5);
    expect(run([flat(4, 'add'), flat(3, 'subtract')])).toBeCloseTo(1, 5);
    expect(run([flat(4, 'add'), flat(3, 'mergeHigh')])).toBeCloseTo(4, 5);
    expect(run([flat(4, 'add'), flat(3, 'mergeLow')])).toBeCloseTo(3, 5);
    expect(run([flat(4, 'add'), flat(3, 'zero')])).toBe(0);
    expect(
      run([
        { op: 'fromVector', vector: 'circle', profile: 'flat', height: 2, base: 1, mode: 'add' },
      ]),
    ).toBeCloseTo(3, 5);
  });

  it('smooth softens edges, scale/offset/invert transform heights', () => {
    const base: ReliefOp = {
      op: 'fromVector',
      vector: 'square',
      profile: 'flat',
      height: 4,
      mode: 'add',
    };
    const { p, relief } = setup([base, { op: 'smooth', radius: 2, passes: 3 }]);
    const g = evaluateRelief(relief, p);
    const edge = at(g, 70.1, 40);
    expect(edge).toBeGreaterThan(0.5);
    expect(edge).toBeLessThan(3.5);
    expect(at(g, 90, 40)).toBeCloseTo(4, 3); // middle unchanged

    const s = setup([base, { op: 'scale', factor: 0.5 }, { op: 'offset', amount: 1 }]);
    const gs = evaluateRelief(s.relief, s.p);
    expect(at(gs, 90, 40)).toBeCloseTo(3, 5);
    expect(at(gs, 5, 5)).toBeCloseTo(1, 5);

    const inv = setup([base, { op: 'invert' }]);
    const gi = evaluateRelief(inv.relief, inv.p);
    expect(at(gi, 90, 40)).toBe(0);
    expect(at(gi, 5, 5)).toBe(4);
  });

  it('image → relief: brightness becomes height in the placement rectangle', () => {
    // 2×1 image: left black, right white.
    const images = { img: new Uint8Array([0, 255]) };
    const op: ReliefOp = {
      op: 'fromImage',
      image: 'img',
      px: 2,
      py: 1,
      x: 0,
      y: 0,
      w: 40,
      h: 20,
      height: 6,
      mode: 'add',
    };
    const { p, relief } = setup([op]);
    const g = evaluateRelief(relief, p, images);
    expect(at(g, 2, 10)).toBeCloseTo(0, 5);
    expect(at(g, 38, 10)).toBeCloseTo(6, 5);
    expect(at(g, 20, 10)).toBeCloseTo(3, 0);
    expect(at(g, 60, 10)).toBe(0); // outside the image

    const inv = setup([{ ...op, invert: true }]);
    expect(at(evaluateRelief(inv.relief, inv.p, images), 2, 10)).toBeCloseTo(6, 5);
    expect(() => evaluateRelief(relief, p, {})).toThrow(/Missing image/);
  });

  it('is fast enough for a full sheet: 1200 × 800 dome in under 2 s', () => {
    let p = newProject({
      stock: { width: 300, height: 200, thickness: 18, origin: 'bottom-left', zZero: 'top' },
    });
    p = addVectors([
      { id: 'o', layer: 'L1', closed: true, segments: ellipse(150, 100, 140, 90) },
    ]).apply(p);
    const { cols, rows } = reliefSize(p.stock, 0.25);
    const t = performance.now();
    const g = evaluateRelief(
      {
        id: 'r',
        resolution: 0.25,
        cols,
        rows,
        data: 'reliefs/r.f32',
        ops: [{ op: 'fromVector', vector: 'o', profile: 'dome', height: 12, mode: 'add' }],
      },
      p,
    );
    expect(performance.now() - t).toBeLessThan(2000);
    expect(gridRange(g.z).max).toBeCloseTo(12, 0);
  });
});

describe('relief files (T4.2–T4.3)', () => {
  it('saves image reliefs with their images and loads them back', async () => {
    const { loadProject, saveProject } = await import('../model/projectFile');
    const { p, relief } = setup([
      {
        op: 'fromImage',
        image: 'img',
        px: 2,
        py: 1,
        x: 0,
        y: 0,
        w: 40,
        h: 20,
        height: 6,
        mode: 'add',
      },
    ]);
    const images = { img: new Uint8Array([0, 255]) };
    const project = { ...p, reliefs: [relief] };
    const grid = evaluateRelief(relief, project, images);
    const back = loadProject(saveProject({ project, reliefData: { r1: grid.z }, images }));
    expect(back.images).toEqual(images);
    expect(evaluateRelief(back.project.reliefs[0]!, back.project, back.images).z).toEqual(grid.z);
    expect(() => saveProject({ project, reliefData: { r1: grid.z } })).toThrow(/Missing image/);
  });

  it('STL is a closed solid: every edge shared by exactly two triangles', async () => {
    const { reliefToStl } = await import('./stl');
    const { p, relief } = setup([
      { op: 'fromVector', vector: 'circle', profile: 'dome', height: 8, mode: 'add' },
    ]);
    const g = evaluateRelief(relief, p);
    const stl = reliefToStl(g, { step: 8, base: 2 });
    const view = new DataView(stl.buffer);
    const n = view.getUint32(80, true);
    expect(stl.length).toBe(84 + 50 * n);
    const edges = new Map<string, number>();
    let maxZ = -Infinity;
    let minZ = Infinity;
    for (let t = 0; t < n; t++) {
      const v: string[] = [];
      for (let k = 0; k < 3; k++) {
        const o = 84 + t * 50 + 12 + k * 12;
        const x = view.getFloat32(o, true);
        const y = view.getFloat32(o + 4, true);
        const z = view.getFloat32(o + 8, true);
        maxZ = Math.max(maxZ, z);
        minZ = Math.min(minZ, z);
        v.push(`${x},${y},${z}`);
      }
      for (const [a, b] of [
        [v[0], v[1]],
        [v[1], v[2]],
        [v[2], v[0]],
      ] as [string, string][]) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    expect(minZ).toBe(0);
    expect(maxZ).toBeCloseTo(2 + 8, 0);
  });
});
