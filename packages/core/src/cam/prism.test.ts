import { describe, expect, it } from 'vitest';
import { addTool, addToolpath, addVectors, newProject, type NewToolpath } from '../model/commands';
import { projectSchema, type Project, type Segment } from '../model/schema';
import { createHeightmap, simulate, type Heightmap } from '../sim/heightmap';
import { offset, regionArea } from '../vector/clip';
import { distToSegment, flatten } from '../vector/flatten';
import type { Vec2 } from '../vector/path';
import { polygon, rectangle } from '../vector/shapes';
import { exportToolpath } from './export';
import { pocketRegion } from './pocket';
import { DEFAULT_GLUE_GAP, inlayPlug, mirrorRegionX } from './prism';
import { TOOL_PRESETS } from './tools';

const V90 = TOOL_PRESETS[7]!; // 90° V-bit, 1/2": tan(½·angle) = 1, cone radius 6.35 mm
const V60 = TOOL_PRESETS[6]!;
const tanHalf = (t: { angle?: number | undefined }) =>
  Math.tan((((t.angle ?? 90) / 2) * Math.PI) / 180);

type Params = Extract<NewToolpath, { type: 'prism' | 'inlay' }>;

function project(segments: Segment[], tps: NewToolpath[], tool = V90): Project {
  let p = newProject({
    stock: { width: 120, height: 80, thickness: 18, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([{ id: 'art', layer: 'L1', closed: true, segments }]).apply(p);
  p = addTool({ id: 'v', ...tool }).apply(p);
  for (const tp of tps) p = addToolpath(tp).apply(p);
  return projectSchema.parse(p);
}

const prism = (params: Extract<Params, { type: 'prism' }>['params']): Params => ({
  id: 'tp',
  type: 'prism',
  tool: 'v',
  vectors: ['art'],
  params,
});

function run(p: Project, id = 'tp', cell = 0.1) {
  const ex = exportToolpath(p, id, { simulated: true });
  const hm = simulate(createHeightmap(p.stock, { cell }), ex.check.program, ex.program.tool);
  return { ex, hm };
}

/** Distance from (x, y) to the art's outline, and whether it is inside. */
function outline(p: Project) {
  const rings = flatten(p.vectors[0]!.segments, 0.005, true).map((x) => x.points);
  const edges: [Vec2, Vec2][] = rings.flatMap((r) =>
    r.map((a, i) => [a, r[(i + 1) % r.length]!] as [Vec2, Vec2]),
  );
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of rings)
    for (const [x, y] of r) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  const at = (x: number, y: number) => {
    let inside = false;
    let dist = Infinity;
    for (const [a, b] of edges) {
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside;
      dist = Math.min(dist, distToSegment([x, y], a, b));
    }
    return { inside, dist };
  };
  return { at, box };
}

interface Compare {
  cells: number;
  maxLeft: number;
  p95Left: number;
  maxGouge: number;
}

/** Simulated surface against an ideal z(inside, dist), over the art's box grown by `grow`. */
function compare(
  p: Project,
  hm: Heightmap,
  grow: number,
  ideal: (inside: boolean, dist: number) => number,
): Compare {
  const { at, box } = outline(p);
  const left: number[] = [];
  let maxGouge = 0;
  for (let row = 0; row < hm.rows; row++) {
    const y = hm.y0 + row * hm.cell;
    if (y < box.minY - grow || y > box.maxY + grow) continue;
    for (let col = 0; col < hm.cols; col++) {
      const x = hm.x0 + col * hm.cell;
      if (x < box.minX - grow || x > box.maxX + grow) continue;
      const { inside, dist } = at(x, y);
      const z = hm.z[row * hm.cols + col]!;
      const want = ideal(inside, dist);
      maxGouge = Math.max(maxGouge, want - z);
      left.push(z - want);
    }
  }
  left.sort((a, b) => a - b);
  return {
    cells: left.length,
    maxLeft: left.at(-1) ?? 0,
    p95Left: left[Math.floor(left.length * 0.95)] ?? 0,
    maxGouge,
  };
}

/** Ideal raised prism (prism.ts): faces inside, flat base, outer wall sloping up at `margin`. */
const raisedIdeal = (D: number, margin: number, t: number) => (inside: boolean, dist: number) =>
  inside ? Math.min(0, -D + dist / t) : dist >= margin ? 0 : -Math.min(D, (margin - dist) / t);

describe('prism carving (T6.12)', { timeout: 120_000 }, () => {
  it('raised: a bar becomes a ridged prism on a flat base; no gouging, checker passes', () => {
    // 10 mm bar, 90° bit, base 5.5 mm deep: faces meet in a ridge 0.5 mm below the top.
    const p = project(rectangle(30, 30, 60, 10), [
      prism({ mode: 'raised', depth: 5.5, margin: 9 }),
    ]);
    const { ex, hm } = run(p);
    expect(ex.ok).toBe(true);
    expect(ex.check.issues).toEqual([]);
    const r = compare(p, hm, 10, raisedIdeal(5.5, 9, 1));
    expect(r.cells).toBeGreaterThan(100_000);
    expect(r.maxGouge).toBeLessThan(0.02);
    // Flat floor: V grooves at the 0.5 mm step-over leave ridges up to 0.25 mm.
    expect(r.p95Left).toBeLessThan(0.26);
    expect(r.maxLeft).toBeLessThan(0.3);
    // The ridge: centre of the bar at −0.5, the base beside it at −5.5.
    const z = (x: number, y: number) =>
      hm.z[Math.round((y - hm.y0) / hm.cell) * hm.cols + Math.round((x - hm.x0) / hm.cell)]!;
    expect(Math.abs(z(60, 35) + 0.5)).toBeLessThan(0.1); // ±1 cell on a 45° face
    expect(z(60, 28)).toBeGreaterThan(-5.5 - 0.08); // the floor, below the ridges between grooves
    expect(z(60, 28)).toBeLessThan(-5.5 + 0.26);
    expect(z(60, 15)).toBe(0); // beyond the margin: untouched
  });

  it('raised: a wide shape keeps a flat top; a 60° bit and a pentagon match the ideal', () => {
    const art = polygon(60, 40, 18, 5);
    const p = project(art, [prism({ mode: 'raised', depth: 3, margin: 6 })], V60);
    const { ex, hm } = run(p);
    expect(ex.ok).toBe(true);
    const r = compare(p, hm, 7, raisedIdeal(3, 6, tanHalf(V60)));
    expect(r.maxGouge).toBeLessThan(0.02);
    expect(r.p95Left).toBeLessThan(0.45); // 60° grooves: 0.25 / tan 30° ≈ 0.43 between floor rings
    // The middle stays at the stock top.
    expect(
      hm.z[Math.round((40 - hm.y0) / hm.cell) * hm.cols + Math.round((60 - hm.x0) / hm.cell)],
    ).toBe(0);
  });

  it('raised: a margin narrower than the slope caps the base depth and says so', () => {
    const p = project(rectangle(30, 30, 60, 10), [prism({ mode: 'raised', depth: 5, margin: 3 })]);
    const { ex, hm } = run(p);
    expect(ex.program.warnings.join()).toMatch(/margin is too narrow/);
    expect(ex.ok).toBe(true);
    const D = 3 - 0.05; // the margin less the floor always kept
    const r = compare(p, hm, 4, raisedIdeal(D, 3, 1));
    expect(r.maxGouge).toBeLessThan(0.02);
  });

  it('raised: deeper than the cone reaches warns and caps the base (the shank would flatten the faces)', () => {
    const p = project(rectangle(30, 30, 60, 20), [
      prism({ mode: 'raised', depth: 10, margin: 12 }),
    ]);
    const { ex, hm } = run(p);
    expect(ex.program.warnings.join()).toMatch(/reaches at most 6\.35/);
    const r = compare(p, hm, 13, raisedIdeal(6.35, 12, 1));
    expect(r.maxGouge).toBeLessThan(0.02);
  });

  it('sunken: the same cuts as a V-carve of the shapes', () => {
    const art = rectangle(30, 30, 60, 10);
    const p = project(art, [
      prism({ mode: 'sunken', depth: 4, step: 0.25 }),
      { id: 'vc', type: 'vcarve', tool: 'v', vectors: ['art'], params: { depth: 4, step: 0.25 } },
    ]);
    const a = exportToolpath(p, 'tp', { simulated: true });
    const b = exportToolpath(p, 'vc', { simulated: true });
    expect(a.ok).toBe(true);
    expect(a.program.moves).toEqual(b.program.moves);
  });

  it('rejects a non-V tool through the checker', () => {
    for (const tp of [
      prism({ mode: 'raised', depth: 3 }),
      { ...prism({ mode: 'sunken', depth: 3 }) },
      { id: 'tp', type: 'inlay', tool: 'v', vectors: ['art'], params: { part: 'plug', depth: 3 } },
    ] as Params[]) {
      const p = project(rectangle(30, 30, 60, 10), [tp], TOOL_PRESETS[3]!);
      const ex = exportToolpath(p, 'tp', { simulated: true });
      expect(ex.program.warnings.join(), tp.type).toMatch(/need a V-bit/);
      expect(ex.ok, tp.type).toBe(false);
      expect(ex.check.issues.map((i) => i.rule)).toContain('tool');
    }
  });
});

describe('V inlay (T6.12)', { timeout: 120_000 }, () => {
  const inlay = (id: string, part: 'pocket' | 'plug', extra: object = {}): Params => ({
    id,
    type: 'inlay',
    tool: 'v',
    vectors: ['art'],
    params: { part, depth: 4, glueGap: 0.5, plugExtra: 1, margin: 8, ...extra },
  });

  it('plug geometry: the mirrored shape grown by extra·tan, on a base D − gap + extra deep', () => {
    // A triangle pointing +X: mirroring turns it to point −X about its box centre.
    const art = polygon(60, 40, 10, 3, 0);
    const shape = pocketRegion([{ id: 'a', layer: 'L1', closed: true, segments: art }], 0.005, []);
    const mirrored = mirrorRegionX(shape);
    const xs = (r: typeof shape) => r.flat().map((q) => q[0]);
    expect(Math.min(...xs(mirrored))).toBeCloseTo(Math.min(...xs(shape)), 6);
    expect(Math.max(...xs(mirrored))).toBeCloseTo(Math.max(...xs(shape)), 6);
    // The tip (x = 70; the box is 55…70) is now at the left, x = 55.
    expect(
      mirrored.flat().some((q) => Math.abs(q[0] - 55) < 1e-3 && Math.abs(q[1] - 40) < 1e-3),
    ).toBe(true);
    const plug = inlayPlug(shape, V90, { part: 'plug', depth: 4, glueGap: 0.5, plugExtra: 1 });
    expect(plug.depth).toBeCloseTo(4 - 0.5 + 1, 9);
    // Shrunk back by extra·tan it is the mirrored shape (round-offset rounding aside).
    const back = offset(plug.shape, -1);
    expect(Math.abs(regionArea(back) - regionArea(mirrored))).toBeLessThan(
      1e-3 * regionArea(mirrored),
    );
  });

  it('pocket width at the surface equals plug width at the glue line', () => {
    // 20 × 12 rectangle, 90° bit, pocket 4 deep: flat bottom 12 wide by 4 wide.
    const p = project(rectangle(50, 34, 20, 12), [
      inlay('pocket', 'pocket'),
      inlay('plug', 'plug'),
    ]);
    const pocket = run(p, 'pocket');
    const plug = run(p, 'plug');
    expect(pocket.ex.ok).toBe(true);
    expect(plug.ex.ok).toBe(true);
    expect(plug.ex.program.warnings.join()).toMatch(/mirrored/);
    const hm = pocket.hm;
    const row = Math.round((40 - hm.y0) / hm.cell);
    const mid = Math.round((60 - hm.x0) / hm.cell);
    /** Width (mm) of the run of cells through the middle of row where `test` holds. */
    const width = (h: Heightmap, test: (z: number) => boolean) => {
      let a = mid;
      let b = mid;
      while (test(h.z[row * h.cols + a - 1]!)) a--;
      while (test(h.z[row * h.cols + b + 1]!)) b++;
      return (b - a + 1) * h.cell;
    };
    const pocketTop = width(pocket.hm, (z) => z < -1e-3);
    const glueLine = -(4 - DEFAULT_GLUE_GAP); // D − gap below the plug's top
    const plugAtGlue = width(plug.hm, (z) => z >= glueLine - 1e-3);
    expect(pocketTop).toBeCloseTo(20, 0);
    expect(Math.abs(plugAtGlue - pocketTop)).toBeLessThanOrEqual(2 * hm.cell + 1e-9);
    // The plug's top (flat at the stock top) is as wide as the pocket D − gap down.
    expect(
      Math.abs(width(plug.hm, (z) => z >= -1e-3) - width(pocket.hm, (z) => z < glueLine)),
    ).toBeLessThanOrEqual(2 * hm.cell + 1e-9);
  });

  it('the plug, turned over, fills the pocket: walls meet, the glue gap is left under its top', () => {
    // Asymmetric outline so a missing mirror would show.
    const art = polygon(60, 40, 12, 3, 0);
    const p = project(art, [inlay('pocket', 'pocket'), inlay('plug', 'plug')]);
    const pocket = run(p, 'pocket').hm;
    const plug = run(p, 'plug').hm;
    const { at, box } = outline(p);
    const cx = (box.minX + box.maxX) / 2;
    const base = 4 - 0.5 + 1; // plug base depth
    let worst = Infinity; // most negative gap = interference
    let wallMax = 0;
    for (let row = 0; row < pocket.rows; row++) {
      const y = pocket.y0 + row * pocket.cell;
      if (y < box.minY || y > box.maxY) continue;
      for (let col = 0; col < pocket.cols; col++) {
        const x = pocket.x0 + col * pocket.cell;
        if (x < box.minX || x > box.maxX) continue;
        const { inside, dist } = at(x, y);
        if (!inside) continue;
        const depth = -pocket.z[row * pocket.cols + col]!;
        // Plug cell that lands here once turned over left to right.
        const mc = Math.round((2 * cx - x - plug.x0) / plug.cell);
        const height = plug.z[row * plug.cols + mc]! + base; // above the plug's base
        // Turned over, the base stands `extra` (1 mm) above the surface.
        const gap = depth - (height - 1);
        worst = Math.min(worst, gap);
        if (dist > 0.5 && dist < 3) wallMax = Math.max(wallMax, Math.abs(gap));
      }
    }
    expect(worst).toBeGreaterThan(-0.1); // no interference beyond the simulation's cells
    expect(wallMax).toBeLessThan(0.1); // the sloped walls meet
  });

  it('a glue gap as deep as the pocket cuts nothing and says why', () => {
    const p = project(rectangle(50, 34, 20, 12), [inlay('plug', 'plug', { glueGap: 4 })]);
    const ex = exportToolpath(p, 'plug', { simulated: true });
    expect(ex.program.warnings.join()).toMatch(/glue gap must be less/);
    expect(ex.program.warnings.join()).toMatch(/cuts nothing/);
  });
});
