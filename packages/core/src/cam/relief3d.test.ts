import { describe, expect, it } from 'vitest';
import {
  addRelief,
  addTool,
  addToolpath,
  addVectors,
  newProject,
  setReliefOp,
} from '../model/commands';
import { projectSchema, type Project, type Vector } from '../model/schema';
import { evaluateRelief } from '../relief/relief';
import { createHeightmap, simulate } from '../sim/heightmap';
import { ellipse, rectangle } from '../vector/shapes';
import { exportToolpath } from './export';
import { dropCutter, placeRelief } from './relief3d';
import { heightAt, TOOL_PRESETS } from './tools';

const BALL6 = TOOL_PRESETS[5]!; // 6 mm ball nose
const FLAT6 = TOOL_PRESETS[3]!; // 6 mm flat

/** 60 × 40 × 25 mm stock with a dome relief (circle r 15, height h). */
function domeProject(h = 10, res = 0.25): Project {
  let p = newProject({
    stock: { width: 60, height: 40, thickness: 25, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([{ id: 'c', layer: 'L1', closed: true, segments: ellipse(30, 20, 15) }]).apply(p);
  p = addRelief(res, 'r1').apply(p);
  p = setReliefOp('r1', {
    op: 'fromVector',
    vector: 'c',
    profile: 'dome',
    height: h,
    mode: 'add',
  }).apply(p);
  p = addTool({ id: 'ball', ...BALL6 }).apply(p);
  p = addTool({ id: 'flat', ...FLAT6 }).apply(p);
  p = addToolpath({
    id: 'finish',
    type: 'finish3d',
    tool: 'ball',
    relief: 'r1',
    vectors: [],
    params: { pattern: 'x' },
  }).apply(p);
  p = addToolpath({
    id: 'rough',
    type: 'rough3d',
    tool: 'flat',
    relief: 'r1',
    vectors: [],
    params: { allowance: 0.5 },
  }).apply(p);
  return projectSchema.parse(p);
}

/** Simulates a toolpath and returns, per cell, (simulated Z − ideal surface Z). */
function residual(p: Project, id: string) {
  const ex = exportToolpath(p, id, { simulated: true });
  expect(
    ex.check.issues.filter((i) => i.severity === 'error'),
    id,
  ).toEqual([]);
  const relief = evaluateRelief(p.reliefs[0]!, p);
  const pr = placeRelief(relief, 0, -p.stock.thickness);
  const hm = simulate(
    createHeightmap(p.stock, { cell: relief.resolution }),
    ex.check.program,
    ex.program.tool,
  );
  const diff = new Float32Array(hm.z.length);
  const ideal = new Float32Array(hm.z.length);
  for (let i = 0; i < hm.z.length; i++) {
    ideal[i] = relief.z[i]! - pr.maxH;
    diff[i] = hm.z[i]! - ideal[i]!;
  }
  return { diff, ideal, ex };
}

const sorted = (a: Float32Array) => Float32Array.from(a).sort();

describe('3D CAM (M5)', () => {
  it('drop-cutter: a ball rolling over a hemisphere follows the offset sphere', () => {
    // Dome of height = radius on a circle is a hemisphere of radius 15.
    const p = domeProject(15, 0.1);
    const pr = placeRelief(evaluateRelief(p.reliefs[0]!, p), 0, -25);
    const ball = dropCutter(pr, BALL6);
    const S = 15;
    const r = 3;
    for (const rho of [0, 6, 12, 16]) {
      // Ball centre on the sphere of radius S + r; tip is r below the centre; apex at z = 0.
      const expected = Math.sqrt((S + r) ** 2 - rho ** 2) - r - S;
      expect(Math.abs(ball.at(30 + rho, 20) - expected)).toBeLessThan(0.1);
    }
    // A flat tool over a flat area sits on the surface.
    expect(dropCutter(pr, FLAT6).at(3, 3)).toBeCloseTo(-15, 5);
  });

  it('drop-cutter: the row-skipping scan equals a full scan of every cell', () => {
    // Random bumpy relief, several tools, points inside, on and outside the grid.
    const cols = 37;
    const rows = 29;
    const res = 0.5;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const z = new Float32Array(cols * rows).map(() => rnd() * 4);
    const pr = placeRelief({ cols, rows, resolution: res, z }, 0, -20);
    const V90 = TOOL_PRESETS[7]!;
    for (const tool of [BALL6, FLAT6, V90]) {
      const R = tool.diameter / 2;
      const brute = (x: number, y: number) => {
        let best = -Infinity;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const d = Math.hypot((c + 0.5) * res - x, (r + 0.5) * res - y);
            if (d > R) continue;
            const step = Math.min(res / 8, R / 256);
            const h = heightAt(tool, Math.min(R, Math.floor(d / step) * step));
            best = Math.max(best, z[r * cols + c]! - pr.maxH - h);
          }
        return best === -Infinity ? 0 : Math.min(0, Math.max(-20, best));
      };
      const drop = dropCutter(pr, tool);
      for (let i = 0; i < 300; i++) {
        const x = rnd() * (cols * res + 8) - 4;
        const y = rnd() * (rows * res + 8) - 4;
        expect(drop.at(x, y)).toBeCloseTo(brute(x, y), 4);
      }
    }
  });

  it('finishing: no gouges, and the surface matches the relief within the scallop', () => {
    const { diff } = residual(domeProject(), 'finish');
    const s = sorted(diff);
    expect(s[0]!).toBeGreaterThan(-0.06); // never deeper than the relief
    // Most of the surface is within a few hundredths; concave corners at the dome's foot keep a ball-radius fillet.
    // X-only lines leave taller ridges on slopes facing across the lines.
    const p90x = s[Math.floor(s.length * 0.9)]!;
    expect(p90x).toBeLessThan(0.12);
    // Cross-hatching (X then Y) is smoother.
    const p = domeProject();
    const tp = p.toolpaths.find((t) => t.id === 'finish')!;
    if (tp.type === 'finish3d') tp.params.pattern = 'xy';
    const xy = sorted(residual(p, 'finish').diff);
    expect(xy[0]!).toBeGreaterThan(-0.06);
    expect(xy[Math.floor(xy.length * 0.9)]!).toBeLessThan(p90x);
  }, 120_000);

  it('roughing: never closer than the allowance to the relief, and the rest is cleared in steps', () => {
    const p = domeProject();
    const { diff, ideal } = residual(p, 'rough');
    // Only where there is room for the allowance under the stock top.
    const s = sorted(diff.filter((_, i) => ideal[i]! < -0.5));
    expect(s[0]!).toBeGreaterThan(0.5 - 0.05);
    // Material left is at most one step-down above the allowance almost everywhere.
    expect(s[Math.floor(s.length * 0.95)]!).toBeLessThan(0.5 + FLAT6.stepDown + 0.05);
  }, 120_000);

  it.each([
    ['finish', 10],
    ['rough', 20],
  ] as const)(
    '%s with a boundary vector: the tool centre stays inside it while cutting',
    (id, R) => {
      const p = domeProject();
      // Boundary: a circle of radius R at the dome's centre (30, 20).
      p.vectors.push({ id: 'b', layer: 'L1', closed: true, segments: ellipse(30, 20, R) });
      const tp = p.toolpaths.find((t) => t.id === id)!;
      tp.vectors = ['b'];
      const ex = exportToolpath(p, id, { simulated: true });
      expect(ex.check.issues.filter((i) => i.severity === 'error')).toEqual([]);
      let cuts = 0;
      for (const m of ex.check.program.moves) {
        if (m.type === 'rapid') continue;
        for (const q of [m.from, ...m.points]) {
          const [x, y, z] = q;
          if (x === null || y === null || z === null || z >= 0) continue;
          cuts++;
          expect(Math.hypot(x - 30, y - 20), `${id} cut at ${x}, ${y}`).toBeLessThanOrEqual(
            R + 0.01,
          );
        }
        // Straight cuts between two inside points stay inside (the circle is convex).
      }
      expect(cuts).toBeGreaterThan(50);
      // Material beyond boundary + tool radius is untouched.
      const hm = simulate(
        createHeightmap(p.stock, { cell: 0.5 }),
        ex.check.program,
        ex.program.tool,
      );
      for (let r = 0; r < hm.rows; r++)
        for (let c = 0; c < hm.cols; c++) {
          const d = Math.hypot(hm.x0 + c * hm.cell - 30, hm.y0 + r * hm.cell - 20);
          if (d > R + 3 + 0.5) expect(hm.z[r * hm.cols + c]!).toBeCloseTo(0, 6);
        }
    },
    120_000,
  );

  it('finishing with a boundary links nearby lines along the surface and lifts across gaps', () => {
    const p = domeProject();
    // Two separate squares: the tool must lift to get from one to the other.
    const sq = (x0: number): Vector['segments'] => rectangle(x0, 10, 10, 20);
    p.vectors.push(
      { id: 'a', layer: 'L1', closed: true, segments: sq(10) },
      { id: 'b', layer: 'L1', closed: true, segments: sq(40) },
    );
    const tp = p.toolpaths.find((t) => t.id === 'finish')!;
    tp.vectors = ['a', 'b'];
    const ex = exportToolpath(p, 'finish', { simulated: true });
    expect(ex.check.issues.filter((i) => i.severity === 'error')).toEqual([]);
    // One plunge per square (lines within a square are linked).
    const plunges = ex.check.program.moves.filter(
      (m) => m.type !== 'rapid' && m.from[2] !== null && m.from[2] > 0 && (m.to[2] ?? 0) <= 0,
    );
    expect(plunges.length).toBe(2);
  });

  it('the checker enforces a ball-nose for finishing', () => {
    const p = domeProject();
    const tp = p.toolpaths.find((t) => t.id === 'finish')!;
    tp.tool = 'flat';
    const ex = exportToolpath(p, 'finish', { simulated: true });
    expect(ex.ok).toBe(false);
    expect(ex.check.issues.map((i) => i.rule)).toContain('tool');
  });

  it('warns when the relief is deeper than the material', () => {
    let p = domeProject();
    p = { ...p, stock: { ...p.stock, thickness: 5 } };
    const ex = exportToolpath(p, 'rough', { simulated: true });
    expect(ex.program.warnings.join()).toMatch(/deeper than the material/);
    // The cut stops at the stock bottom instead of going through it.
    const zs = ex.check.program.moves.flatMap((m) => (m.to[2] === null ? [] : [m.to[2]]));
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(-5 - 1e-6);
  });
});
