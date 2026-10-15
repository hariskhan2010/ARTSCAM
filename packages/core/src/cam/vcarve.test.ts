import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { addTool, addToolpath, addVectors, newProject } from '../model/commands';
import { projectSchema, type Project, type Segment } from '../model/schema';
import { createHeightmap, simulate } from '../sim/heightmap';
import { layoutText, loadFont, regionToSegments } from '../text/text';
import { distToSegment, flatten } from '../vector/flatten';
import { transformSegments, translation, type Vec2 } from '../vector/path';
import { rectangle } from '../vector/shapes';
import { exportToolpath } from './export';
import { TOOL_PRESETS } from './tools';

const require = createRequire(import.meta.url);
const V90 = TOOL_PRESETS[7]!; // 90° V-bit, 1/2"
const V60 = TOOL_PRESETS[6]!;

function project(segments: Segment[], depth: number, tool = V90, step?: number): Project {
  let p = newProject();
  p = addVectors([{ id: 'art', layer: 'L1', closed: true, segments }]).apply(p);
  p = addTool({ id: 'v', ...tool }).apply(p);
  p = addToolpath({
    id: 'vc',
    name: 'V-carve',
    type: 'vcarve',
    tool: 'v',
    vectors: ['art'],
    params: { depth, ...(step ? { step } : {}) },
  }).apply(p);
  return projectSchema.parse(p);
}

interface Compare {
  /** Cells inside the art. */
  inside: number;
  /** Largest amount the simulation is shallower than ideal (material left), mm. */
  maxLeft: number;
  /** 95th-percentile of material left, mm. */
  p95Left: number;
  /** Largest amount the simulation is deeper than ideal (gouge), mm. */
  maxGouge: number;
}

/** Simulates the toolpath and compares the carved surface with the ideal V surface. */
function compareWithIdeal(p: Project, cell = 0.1): Compare & { warnings: string[]; ok: boolean } {
  const ex = exportToolpath(p, 'vc', { simulated: true });
  const tool = ex.program.tool;
  const tanHalf = Math.tan((((tool.angle ?? 90) / 2) * Math.PI) / 180);
  const tp = p.toolpaths[0]!;
  const maxDepth = Math.min((tp.params as { depth: number }).depth, tool.diameter / 2 / tanHalf);
  const rings = flatten(p.vectors[0]!.segments, 0.005, true).map((x) => x.points);
  const hm = simulate(createHeightmap(p.stock, { cell }), ex.check.program, tool);

  // Only look at the art's bounding box (plus a margin) to keep the test fast.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  const edges: [Vec2, Vec2][] = rings.flatMap((r) =>
    r.map((a, i) => [a, r[(i + 1) % r.length]!] as [Vec2, Vec2]),
  );
  const left: number[] = [];
  let maxGouge = 0;
  for (let row = 0; row < hm.rows; row++) {
    const y = hm.y0 + row * hm.cell;
    if (y < minY - 1 || y > maxY + 1) continue;
    for (let col = 0; col < hm.cols; col++) {
      const x = hm.x0 + col * hm.cell;
      if (x < minX - 1 || x > maxX + 1) continue;
      let inside = false;
      let dist = Infinity;
      for (const [a, b] of edges) {
        if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
          inside = !inside;
        dist = Math.min(dist, distToSegment([x, y], a, b));
      }
      const z = hm.z[row * hm.cols + col]!;
      const ideal = inside ? -Math.min(dist / tanHalf, maxDepth) : 0;
      if (z < ideal) maxGouge = Math.max(maxGouge, ideal - z);
      if (inside) left.push(z - ideal);
    }
  }
  left.sort((a, b) => a - b);
  return {
    inside: left.length,
    maxLeft: left.at(-1) ?? 0,
    p95Left: left[Math.floor(left.length * 0.95)] ?? 0,
    maxGouge,
    warnings: ex.program.warnings,
    ok: ex.ok,
  };
}

describe('V-carve (T3.4)', { timeout: 120_000 }, () => {
  it('a narrow bar carves the ideal V: depth = distance to the edge, no gouging', () => {
    // 10 mm wide: centre line at 5 mm from the edges, 5 mm deep with a 90° bit.
    const r = compareWithIdeal(project(rectangle(50, 50, 60, 10), 6));
    expect(r.ok).toBe(true);
    expect(r.inside).toBeGreaterThan(50_000);
    // Gouge bounded by the simulation's own discretisation (cell size), never real overcut.
    expect(r.maxGouge).toBeLessThan(0.06);
    expect(r.p95Left).toBeLessThan(0.08);
    expect(r.maxLeft).toBeLessThan(0.25); // the sliver on the centre line
  });

  it('roughing passes space out the rings that sit on the pass floor', () => {
    // 10 mm bar, 5 mm deep at the centre: 3 depth passes of 2 mm with a 90° bit.
    // Every ring at 0.1 mm in every pass was ~6.9 m of cutting; spacing the
    // floor rings in roughing passes keeps it under 2.5 m (final pass unchanged).
    const ex = exportToolpath(project(rectangle(50, 50, 60, 10), 6), 'vc', { simulated: true });
    expect(ex.estimate.cuttingLength).toBeLessThan(2500);
  });

  it('a wide plate is cut flat at the requested depth', () => {
    const r = compareWithIdeal(project(rectangle(50, 50, 40, 30), 3));
    expect(r.ok).toBe(true);
    expect(r.maxGouge).toBeLessThan(0.06);
    // Flat bottom: the tip leaves ridges between flat rings; with a 60 % step-over-free ring spacing they stay small.
    expect(r.p95Left).toBeLessThan(0.3);
  });

  it('asking deeper than the bit can reach warns and caps the depth', () => {
    const r = compareWithIdeal(project(rectangle(50, 50, 40, 30), 20, V60));
    expect(r.warnings.join()).toMatch(/reaches at most/);
    expect(r.maxGouge).toBeLessThan(0.06);
  });

  it('rejects a non-V tool through the checker', () => {
    const p = project(rectangle(50, 50, 60, 10), 3, TOOL_PRESETS[3]!);
    const ex = exportToolpath(p, 'vc', { simulated: true });
    expect(ex.ok).toBe(false);
    expect(ex.check.issues.map((i) => i.rule)).toContain('tool');
  });

  describe('calligraphy (M3 acceptance)', () => {
    let art: Segment[];
    beforeAll(async () => {
      const file =
        require.resolve('@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff');
      const font = await loadFont(new Uint8Array(readFileSync(file)), 'Nastaliq');
      const { region, missing } = layoutText('اللہ', { size: 40, fonts: [font], align: 'center' });
      expect(missing).toEqual([]);
      art = transformSegments(regionToSegments(region), translation(150, 100));
    });

    it('Nastaliq text V-carves cleanly: matches the ideal V surface, no gouges, checker passes', () => {
      const r = compareWithIdeal(project(art, 6, V60, 0.08), 0.1);
      expect(r.ok).toBe(true);
      expect(r.inside).toBeGreaterThan(5_000);
      expect(r.maxGouge).toBeLessThan(0.08);
      expect(r.p95Left).toBeLessThan(0.1);
    }, 120_000);
  });
});
