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
import { generateToolpath } from './generate';
import { dropCutter, placeRelief } from './relief3d';
import { heightAt, TOOL_PRESETS } from './tools';

const BALL6 = TOOL_PRESETS[5]!; // 6 mm ball nose
const FLAT6 = TOOL_PRESETS[3]!; // 6 mm flat
const SMALL_BALL = TOOL_PRESETS[4]!; // 1/8" ball nose

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

  it('a back relief is machined mirrored left to right, with a flip note', () => {
    // Bump off-centre at x = 15 on 60 mm wide stock: from the back it is at x = 45.
    let p = newProject({
      stock: { width: 60, height: 40, thickness: 25, origin: 'bottom-left', zZero: 'top' },
    });
    p = addVectors([
      { id: 'c', layer: 'L1', closed: true, segments: ellipse(15, 20, 8) },
      { id: 'b', layer: 'L1', closed: true, segments: rectangle(5, 10, 20, 20) },
    ]).apply(p);
    p = addRelief(0.25, 'back', 'back').apply(p);
    expect(p.reliefs[0]!.side).toBe('back');
    p = setReliefOp('back', {
      op: 'fromVector',
      vector: 'c',
      profile: 'dome',
      height: 5,
      mode: 'add',
    }).apply(p);
    p = addTool({ id: 'ball', ...BALL6 }).apply(p);
    p = addToolpath({
      id: 'f',
      type: 'finish3d',
      tool: 'ball',
      relief: 'back',
      vectors: ['b'],
      params: { pattern: 'x' },
    }).apply(p);
    const ex = exportToolpath(projectSchema.parse(p), 'f', { simulated: true });
    expect(ex.check.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(ex.gcode).toMatch(/\(Note: Back relief: .*turn the material over/);
    // The boundary (x 5..25) is mirrored to x 35..55: every cut is there.
    const xs = ex.check.program.moves.flatMap((m) =>
      m.type === 'rapid' || m.to[2] === null || m.to[2] >= 0 || m.to[0] === null ? [] : [m.to[0]],
    );
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(35 - 0.01);
    expect(Math.max(...xs)).toBeLessThanOrEqual(55 + 0.01);
    // The dome's top (cut highest) is at the mirrored centre x = 45.
    let top = { z: -Infinity, x: 0 };
    for (const m of ex.check.program.moves)
      if (
        m.type !== 'rapid' &&
        m.to[2] !== null &&
        m.to[0] !== null &&
        m.to[2] < 0 &&
        m.to[2] > top.z
      )
        top = { z: m.to[2], x: m.to[0] };
    expect(Math.abs(top.x - 45)).toBeLessThan(1);
  });

  it('warns when front and back reliefs together are deeper than the material', () => {
    let p = domeProject(10); // front dome 10 mm deep in 25 mm stock
    p = addRelief(0.5, 'back', 'back').apply(p);
    const back = (h: number) =>
      setReliefOp('back', {
        op: 'fromVector',
        vector: 'c',
        profile: 'dome',
        height: h,
        mode: 'add',
      });
    const warned = (q: Project) =>
      exportToolpath(q, 'finish', { simulated: true }).program.warnings.join();
    expect(warned(back(12).apply(p))).not.toMatch(/together/);
    expect(warned(back(16).apply(p))).toMatch(/front and back reliefs together/);
  });

  /** The dome project with the finishing toolpath's params changed. */
  const withFinish = (params: Record<string, unknown>, p = domeProject()) => {
    const tp = p.toolpaths.find((t) => t.id === 'finish')!;
    if (tp.type === 'finish3d') tp.params = { ...tp.params, ...params };
    return p;
  };

  it.each([
    ['spiral', { pattern: 'spiral' }],
    ['offset', { pattern: 'offset' }],
    ['raster at 30°', { pattern: 'x', angle: 30 }],
    ['X then Y at 45°', { pattern: 'xy', angle: 45 }],
  ] as const)(
    '%s finishing: no gouges, and the whole surface is finished',
    (_, params) => {
      const p = projectSchema.parse(withFinish(params));
      const { diff, ex } = residual(p, 'finish');
      const s = sorted(diff);
      expect(s[0]!).toBeGreaterThan(-0.06);
      // Within the scallop almost everywhere (the dome's foot keeps a ball-radius fillet).
      expect(s[Math.floor(s.length * 0.9)]!).toBeLessThan(0.15);
      // Every cell was cut: only the ball-radius fillet at the dome's foot stands above
      // the scallop (uncut material would stand up to 10 mm high).
      expect(s.at(-1)!).toBeLessThan(2);
      expect(ex.ok).toBe(true);
    },
    120_000,
  );

  it('raster at angle 0 and 180 is the plain X raster', () => {
    const gcode = (params: Record<string, unknown>) =>
      exportToolpath(withFinish(params), 'finish', { simulated: true }).gcode;
    const plain = gcode({});
    expect(gcode({ angle: 0 })).toBe(plain);
    expect(gcode({ angle: 180 })).toBe(plain);
    expect(gcode({ pattern: 'y', angle: 90 })).toBe(plain);
  });

  it('a spiral runs from the outside in as one continuous cut inside a circular boundary', () => {
    const p = withFinish({ pattern: 'spiral' });
    p.vectors.push({ id: 'b', layer: 'L1', closed: true, segments: ellipse(30, 20, 12) });
    p.toolpaths.find((t) => t.id === 'finish')!.vectors = ['b'];
    const ex = exportToolpath(p, 'finish', { simulated: true });
    expect(ex.ok).toBe(true);
    const plunges = ex.check.program.moves.filter(
      (m) => m.type !== 'rapid' && m.from[2] !== null && m.from[2] > 0 && (m.to[2] ?? 0) <= 0,
    );
    expect(plunges.length).toBe(1);
    // The distance from the centre shrinks along the cut.
    const rs = ex.check.program.moves.flatMap((m) =>
      m.type === 'rapid' || m.to[0] === null || m.to[1] === null || (m.to[2] ?? 1) > 0
        ? []
        : [Math.hypot(m.to[0] - 30, m.to[1] - 20)],
    );
    expect(rs[0]!).toBeGreaterThan(11);
    expect(rs.at(-1)!).toBeLessThan(1);
  });

  it.each([
    ['spiral', { pattern: 'spiral' }],
    ['offset', { pattern: 'offset' }],
    ['raster at 30°', { pattern: 'x', angle: 30 }],
  ] as const)(
    '%s with a boundary vector: the tool centre stays inside it while cutting',
    (_, params) => {
      const p = withFinish(params);
      // A circle of radius 10, and a 12 mm square apart from it.
      p.vectors.push(
        { id: 'b', layer: 'L1', closed: true, segments: ellipse(30, 20, 10) },
        { id: 's', layer: 'L1', closed: true, segments: rectangle(44, 14, 12, 12) },
      );
      p.toolpaths.find((t) => t.id === 'finish')!.vectors = ['b', 's'];
      const ex = exportToolpath(p, 'finish', { simulated: true });
      expect(ex.check.issues.filter((i) => i.severity === 'error')).toEqual([]);
      const inside = (x: number, y: number) =>
        Math.hypot(x - 30, y - 20) <= 10 + 0.01 ||
        (x >= 44 - 0.01 && x <= 56 + 0.01 && y >= 14 - 0.01 && y <= 26 + 0.01);
      let cuts = 0;
      for (const m of ex.check.program.moves) {
        if (m.type === 'rapid') continue;
        for (const q of [m.from, ...m.points]) {
          const [x, y, z] = q;
          if (x === null || y === null || z === null || z >= 0) continue;
          cuts++;
          expect(inside(x, y), `cut at ${x}, ${y}`).toBe(true);
        }
        // A straight cut from the circle to the square would leave both.
        const [x0, y0, z0] = m.from;
        const [x1, y1] = m.to;
        if (x0 !== null && y0 !== null && x1 !== null && y1 !== null && z0 !== null && z0 < 0)
          expect(inside((x0 + x1) / 2, (y0 + y1) / 2), `move to ${x1}, ${y1}`).toBe(true);
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
          const x = hm.x0 + c * hm.cell;
          const y = hm.y0 + r * hm.cell;
          const dSquare = Math.hypot(Math.max(44 - x, 0, x - 56), Math.max(14 - y, 0, y - 26));
          if (Math.hypot(x - 30, y - 20) > 10 + 3.5 && dSquare > 3.5)
            expect(hm.z[r * hm.cols + c]!).toBeCloseTo(0, 6);
        }
    },
    120_000,
  );

  it('rest machining cuts only where the bigger tool could not reach, and deepens the groove', () => {
    // A 4 mm wide, 3 mm deep groove (x 18…22, y 5…25) in a plate: the 6 mm
    // ball cannot reach its bottom; the 1/8" ball can.
    let p = newProject({
      stock: { width: 40, height: 30, thickness: 20, origin: 'bottom-left', zZero: 'top' },
    });
    p = addVectors([
      { id: 'plate', layer: 'L1', closed: true, segments: rectangle(-2, -2, 44, 34) },
      { id: 'groove', layer: 'L1', closed: true, segments: rectangle(18, 5, 4, 20) },
    ]).apply(p);
    p = addRelief(0.25, 'r1').apply(p);
    for (const [vector, height, mode] of [
      ['plate', 5, 'add'],
      ['groove', 3, 'subtract'],
    ] as const) {
      p = setReliefOp('r1', { op: 'fromVector', vector, profile: 'flat', height, mode }).apply(p);
    }
    p = addTool({ id: 'ball', ...BALL6 }).apply(p);
    p = addTool({ id: 'small', ...SMALL_BALL }).apply(p);
    p = addToolpath({
      id: 'finish',
      type: 'finish3d',
      tool: 'ball',
      relief: 'r1',
      vectors: [],
      params: { pattern: 'x' },
    }).apply(p);
    p = addToolpath({
      id: 'rest',
      type: 'rest3d',
      tool: 'small',
      relief: 'r1',
      vectors: [],
      params: { restFrom: 'ball' },
    }).apply(p);
    p = projectSchema.parse(p);

    const finish = exportToolpath(p, 'finish', { simulated: true });
    const rest = exportToolpath(p, 'rest', { simulated: true });
    expect(finish.ok).toBe(true);
    expect(rest.check.issues).toEqual([]);
    expect(rest.ok).toBe(true);

    // Every rest move stays near the groove: within the small tool's radius plus a cell.
    const r = SMALL_BALL.diameter / 2;
    for (const m of rest.check.program.moves) {
      if (m.type === 'rapid') continue;
      for (const [x, y] of [m.from, ...m.points]) {
        if (x === null || y === null) continue;
        expect(x).toBeGreaterThanOrEqual(18 - r - 1);
        expect(x).toBeLessThanOrEqual(22 + r + 1);
        expect(y).toBeGreaterThanOrEqual(5 - r - 1);
        expect(y).toBeLessThanOrEqual(25 + r + 1);
      }
    }
    expect(rest.estimate.cuttingLength).toBeLessThan(finish.estimate.cuttingLength / 2);

    // Simulate the finish, then the rest pass on the same material.
    const relief = evaluateRelief(p.reliefs[0]!, p);
    const hm = createHeightmap(p.stock, { cell: relief.resolution });
    simulate(hm, finish.check.program, finish.program.tool);
    const at = (x: number, y: number) =>
      hm.z[Math.round((y - hm.y0) / hm.cell) * hm.cols + Math.round((x - hm.x0) / hm.cell)]!;
    expect(at(20, 15)).toBeGreaterThan(-1.5); // the 6 mm ball bridges the groove
    simulate(hm, rest.check.program, rest.program.tool);
    expect(at(20, 15)).toBeLessThan(-2.9); // the rest pass reaches the bottom
    // No gouges anywhere.
    const pr = placeRelief(relief, 0, -p.stock.thickness);
    let worst = Infinity;
    for (let i = 0; i < hm.z.length; i++)
      worst = Math.min(worst, hm.z[i]! - (relief.z[i]! - pr.maxH));
    expect(worst).toBeGreaterThan(-0.06);
  }, 120_000);

  it('rest machining after a tool no bigger than this one warns and cuts nothing', () => {
    const p = domeProject();
    p.toolpaths.push({
      id: 'rest',
      type: 'rest3d',
      tool: 'ball',
      relief: 'r1',
      vectors: [],
      params: { restFrom: 'ball' },
    });
    const prog = generateToolpath(projectSchema.parse(p), 'rest');
    expect(prog.warnings.join()).toMatch(/not larger/);
    expect(prog.warnings.join()).toMatch(/cuts nothing/);
  });

  it.each(['spiral', 'rest'] as const)(
    'the checker enforces a ball-nose for %s finishing',
    (kind) => {
      const p = withFinish({ pattern: 'spiral' });
      p.toolpaths.find((t) => t.id === 'finish')!.tool = 'flat';
      p.toolpaths.push({
        id: 'rest',
        type: 'rest3d',
        tool: 'flat',
        relief: 'r1',
        vectors: [],
        params: { restFrom: 'ball' },
      });
      const ex = exportToolpath(p, kind === 'rest' ? 'rest' : 'finish', { simulated: true });
      expect(ex.ok).toBe(false);
      expect(ex.check.issues.map((i) => i.rule)).toContain('tool');
    },
    120_000,
  );

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
