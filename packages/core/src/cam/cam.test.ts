import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkGcode } from '../gcode/checker';
import { parseGcode } from '../gcode/parser';
import {
  addRelief,
  addTool,
  addToolpath,
  addVectors,
  newProject,
  setReliefOp,
  transformVectors,
  type NewToolpath,
} from '../model/commands';
import { loadProject, saveProject } from '../model/projectFile';
import { projectSchema, toolSchema, type Project } from '../model/schema';
import { postGrbl } from '../post/grbl';
import { createHeightmap, simulate } from '../sim/heightmap';
import { estimateTime, formatDuration, trapezoidTime } from '../sim/time';
import { booleanOp, offset, regionArea } from '../vector/clip';
import { flatten, signedArea } from '../vector/flatten';
import { translation, type Vec2 } from '../vector/path';
import { ellipse, line, rectangle } from '../vector/shapes';
import { passDepths, tabSpans } from './builder';
import { exportToolpath, toolpathKey } from './export';
import { generateToolpath } from './generate';
import { pocketRegion } from './pocket';
import { TOOL_PRESETS, heightAt, radiusAt, toolLabel, toolProblems } from './tools';

// --- Fixture project ----------------------------------------------------------

function camProject(units: Project['units'] = 'mm'): Project {
  let p = newProject({ units });
  p = addVectors([
    { id: 'part', layer: 'L1', closed: true, segments: rectangle(20, 20, 100, 60) },
    { id: 'hole', layer: 'L1', closed: true, segments: ellipse(70, 50, 10) },
    { id: 'pocket', layer: 'L1', closed: true, segments: rectangle(160, 20, 120, 100) },
    { id: 'island', layer: 'L1', closed: true, segments: ellipse(220, 70, 15) },
    { id: 'd1', layer: 'L1', closed: true, segments: ellipse(40, 160, 2.5) },
    { id: 'd2', layer: 'L1', closed: true, segments: ellipse(80, 160, 2.5) },
    { id: 'd3', layer: 'L1', closed: true, segments: ellipse(120, 170, 2.5) },
    { id: 'groove', layer: 'L1', closed: false, segments: line([160, 150], [280, 180]) },
    { id: 'vbar', layer: 'L1', closed: true, segments: rectangle(20, 100, 60, 8) },
  ]).apply(p);
  p = addTool({ id: 'em6', ...TOOL_PRESETS[3]! }).apply(p); // 6 mm flat
  p = addTool({ id: 'em3', ...TOOL_PRESETS[2]! }).apply(p); // 3 mm flat
  p = addTool({ id: 'v90', ...TOOL_PRESETS[7]! }).apply(p); // 90° V-bit
  const tps: NewToolpath[] = [
    {
      id: 'cutout',
      name: 'Part cut-out',
      type: 'profile',
      tool: 'em6',
      vectors: ['part'],
      params: {
        side: 'outside',
        depth: 18,
        tabs: { count: 4, width: 6, height: 3 },
        ramp: { length: 20 },
      },
    },
    {
      id: 'holecut',
      name: 'Hole',
      type: 'profile',
      tool: 'em3',
      vectors: ['hole'],
      params: { side: 'inside', depth: 18 },
    },
    {
      id: 'pocket-offset',
      name: 'Pocket offset',
      type: 'pocket',
      tool: 'em6',
      vectors: ['pocket', 'island'],
      params: { depth: 5, strategy: 'offset' },
    },
    {
      id: 'pocket-raster',
      name: 'Pocket raster',
      type: 'pocket',
      tool: 'em6',
      vectors: ['pocket', 'island'],
      params: { depth: 5, strategy: 'raster', angle: 0 },
    },
    {
      id: 'drill',
      name: 'Holes',
      type: 'drill',
      tool: 'em3',
      vectors: ['d1', 'd2', 'd3'],
      params: { depth: 10, peck: 3, dwell: 0.5 },
    },
    {
      id: 'vcarve',
      name: 'V-carve bar',
      type: 'vcarve',
      tool: 'v90',
      vectors: ['vbar'],
      params: { depth: 5, step: 0.25 },
    },
    {
      id: 'groove',
      name: 'V groove',
      type: 'profile',
      tool: 'v90',
      vectors: ['groove'],
      params: { side: 'on', depth: 3 },
    },
  ];
  for (const tp of tps) p = addToolpath(tp).apply(p);
  return projectSchema.parse(p);
}

const project = camProject();
const ctx = (p: Project, toolId: string, op?: Parameters<typeof checkGcode>[1]['operation']) => {
  const tool = p.tools.find((t) => t.id === toolId)!;
  return {
    machine: p.machine,
    stock: p.stock,
    clearance: tool.diameter / 2 + 0.01,
    simulated: true,
    tool,
    ...(op ? { operation: op } : {}),
  };
};

// --- Tools (T2.1) ---------------------------------------------------------------

describe('tool library', () => {
  it('presets are valid tools with no problems', () => {
    for (const t of TOOL_PRESETS) {
      expect(toolSchema.safeParse({ id: 'x', ...t }).success, t.name).toBe(true);
      expect(toolProblems(t), t.name).toEqual([]);
    }
  });

  it('flags tools that cannot work', () => {
    expect(toolProblems({ ...TOOL_PRESETS[7]!, angle: undefined } as never)).toContain(
      'A V-bit needs an included angle',
    );
    expect(toolProblems({ ...TOOL_PRESETS[3]!, stepOver: 7 })[0]).toMatch(/Step-over/);
  });

  it('labels tools in the display unit', () => {
    const { name: _name, ...unnamed } = TOOL_PRESETS[1]!;
    void _name;
    expect(toolLabel(unnamed, 'inch')).toBe('0.25" flat');
    expect(toolLabel(unnamed, 'mm')).toBe('6.35 mm flat');
  });

  it('tool shapes: radiusAt and heightAt are inverses', () => {
    for (const t of TOOL_PRESETS) {
      for (const d of [0.1, 0.3, 0.45].map((f) => f * t.diameter)) {
        const h = heightAt(t, d);
        if (t.type === 'flat') expect(h).toBe(0);
        else expect(radiusAt(t, h)).toBeCloseTo(d, 6);
      }
    }
    expect(heightAt(TOOL_PRESETS[7]!, 2)).toBeCloseTo(2, 9); // 90° V: h = d
  });

  it('tools are persisted with the project', () => {
    const back = loadProject(saveProject({ project, reliefData: {} })).project;
    expect(back.tools).toEqual(project.tools);
    expect(back.toolpaths).toEqual(project.toolpaths);
  });
});

// --- Helpers -------------------------------------------------------------------

describe('builder helpers', () => {
  it('splits depth into equal passes ending exactly at the bottom', () => {
    expect(passDepths(0, 6, 3)).toEqual([-3, -6]);
    expect(passDepths(0, 7, 3)).toEqual([-7 / 3, -14 / 3, -7]);
    expect(passDepths(18, 2, 5)).toEqual([16]);
  });

  it('spaces tabs evenly, widened by the tool diameter', () => {
    expect(tabSpans(400, 4, 6, 6)).toEqual([
      [44, 56],
      [144, 156],
      [244, 256],
      [344, 356],
    ]);
    expect(tabSpans(20, 4, 6, 6)).toEqual([]); // would cover the contour
  });
});

// --- Profile (T2.2) ---------------------------------------------------------------

const cutMoves = (p: Project, id: string) => {
  const prog = generateToolpath(p, id);
  return prog.moves.filter((m) => m.kind === 'cut' || m.kind === 'plunge') as {
    kind: string;
    to: [number, number, number];
  }[];
};

describe('profile', () => {
  it('outside profile: offset by the tool radius, climb (clockwise), two passes to full depth', () => {
    const moves = cutMoves(project, 'cutout');
    const xs = moves.map((m) => m.to[0]);
    const ys = moves.map((m) => m.to[1]);
    expect(Math.min(...xs)).toBeCloseTo(17, 6);
    expect(Math.max(...xs)).toBeCloseTo(123, 6);
    expect(Math.min(...ys)).toBeCloseTo(17, 6);
    expect(Math.max(...ys)).toBeCloseTo(83, 6);
    expect(Math.min(...moves.map((m) => m.to[2]))).toBe(-18);

    // Final pass (z = -18) runs clockwise.
    const deepest = moves.filter((m) => m.to[2] === -18).map((m): Vec2 => [m.to[0], m.to[1]]);
    expect(signedArea(deepest)).toBeLessThan(0);
  });

  it('leaves tabs on the last pass only, at the tab height', () => {
    const moves = cutMoves(project, 'cutout');
    const tabTop = -18 + 3;
    const atTab = moves.filter((m) => Math.abs(m.to[2] - tabTop) < 1e-9);
    expect(atTab.length).toBeGreaterThanOrEqual(8); // up, across, … for 4 tabs
    // Every tab-top move is between two full-depth moves on the last pass.
    const passes = passDepths(0, 18, 3);
    expect(passes.at(-2)!).toBeGreaterThanOrEqual(tabTop); // earlier passes are not below the tabs
  });

  it('ramps in instead of plunging vertically into material', () => {
    const prog = generateToolpath(project, 'cutout');
    const plungesBelowTop = prog.moves.filter(
      (m, i) =>
        m.kind === 'plunge' &&
        m.to[2] < 0 &&
        // a pure vertical drop into new material (tab descents are allowed: material was already cut)
        prog.moves[i - 1]?.kind === 'rapid',
    );
    expect(plungesBelowTop).toEqual([]);
  });

  it('inside profile: hole shrunk by the radius, climb (counter-clockwise)', () => {
    const moves = cutMoves(project, 'holecut').filter((m) => m.to[2] === -18);
    const pts = moves.map((m): Vec2 => [m.to[0], m.to[1]]);
    for (const [x, y] of pts) expect(Math.hypot(x - 70, y - 50)).toBeCloseTo(8.5, 2);
    expect(signedArea(pts)).toBeGreaterThan(0);
  });

  it('conventional direction reverses the loop', () => {
    const p = structuredClone(project);
    const tp = p.toolpaths.find((t) => t.id === 'holecut')!;
    if (tp.type === 'profile') tp.params.direction = 'conventional';
    const pts = cutMoves(p, 'holecut')
      .filter((m) => m.to[2] === -18)
      .map((m): Vec2 => [m.to[0], m.to[1]]);
    expect(signedArea(pts)).toBeLessThan(0);
  });

  it('on-line profile of an open vector zig-zags between passes', () => {
    const moves = cutMoves(project, 'groove');
    expect(moves[0]!.to.slice(0, 2)).toEqual([160, 150]);
    expect(Math.min(...moves.map((m) => m.to[2]))).toBe(-3);
    // Pass 1 ends at the far end, pass 2 comes back.
    const ends = moves.filter((m) => m.kind === 'cut').map((m) => m.to[0]);
    expect(ends).toContain(280);
    expect(moves.at(-1)!.to[0]).toBe(160);
  });

  it('warns and skips a vector too small for an inside cut', () => {
    let p = addVectors([
      { id: 'tiny', layer: 'L1', closed: true, segments: ellipse(10, 190, 1) },
    ]).apply(project);
    p = addToolpath({
      id: 'x',
      type: 'profile',
      tool: 'em6',
      vectors: ['tiny'],
      params: { side: 'inside', depth: 1 },
    }).apply(p);
    expect(generateToolpath(p, 'x').warnings.join()).toMatch(/too small/);
  });
});

// --- Pocket (T2.3) ----------------------------------------------------------------

describe('pocket', () => {
  const region = pocketRegion(
    project.vectors.filter((v) => v.id === 'pocket' || v.id === 'island'),
    0.005,
    [],
  );

  it('treats the inner vector as an island', () => {
    expect(regionArea(region)).toBeCloseTo(120 * 100 - Math.PI * 225, 0);
  });

  for (const id of ['pocket-offset', 'pocket-raster']) {
    it(`${id}: no uncut area larger than the step-over in simulation, island untouched`, () => {
      const ex = exportToolpath(project, id, { simulated: true });
      expect(ex.check.issues.filter((i) => i.severity === 'error')).toEqual([]);
      const hm = simulate(
        createHeightmap(project.stock, { cell: 0.25 }),
        ex.check.program,
        ex.program.tool,
      );
      const r = 3;
      // What a 6 mm cutter can reach: the region opened by the tool radius, minus a cell of slack.
      const reachable = offset(offset(region, -r), r - 0.3);
      const island = offset(
        flatten(ellipse(220, 70, 15), 0.01, true).map((p) => p.points),
        -0.3,
      );
      // Scanline masks: which cells have their centre inside each region (even-odd).
      const mask = (rings: Vec2[][]) => {
        const m = new Uint8Array(hm.cols * hm.rows);
        for (let row = 0; row < hm.rows; row++) {
          const y = hm.y0 + row * hm.cell;
          const xs: number[] = [];
          for (const ring of rings) {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
              const a = ring[i]!;
              const b = ring[j]!;
              if (a[1] > y !== b[1] > y)
                xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
            }
          }
          xs.sort((p, q) => p - q);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const c0 = Math.max(0, Math.ceil((xs[k]! - hm.x0) / hm.cell));
            const c1 = Math.min(hm.cols - 1, Math.floor((xs[k + 1]! - hm.x0) / hm.cell));
            for (let c = c0; c <= c1; c++) m[row * hm.cols + c] = 1;
          }
        }
        return m;
      };
      const reachMask = mask(reachable);
      const islandMask = mask(island);
      let uncut = 0;
      let reached = 0;
      let gouged = 0;
      for (let i = 0; i < hm.z.length; i++) {
        const z = hm.z[i]!;
        if (reachMask[i]) {
          reached++;
          if (z > -5 + 1e-3) uncut++;
        }
        if (islandMask[i] && z < 0) gouged++;
        if (z < -5 - 1e-3) gouged++;
      }
      expect(reached).toBeGreaterThan(100_000);
      expect(uncut).toBe(0);
      expect(gouged).toBe(0);
    }, 60_000);
  }

  it('warns when the tool does not fit', () => {
    let p = addVectors([
      { id: 'slot', layer: 'L1', closed: true, segments: rectangle(5, 185, 4, 10) },
    ]).apply(project);
    p = addToolpath({
      id: 'x',
      type: 'pocket',
      tool: 'em6',
      vectors: ['slot'],
      params: { depth: 1, strategy: 'offset' },
    }).apply(p);
    expect(generateToolpath(p, 'x').warnings.join()).toMatch(/too large/);
  });
});

// --- Drill (T2.4) -----------------------------------------------------------------

describe('drill', () => {
  it('pecks, clears chips above the stock, and only feeds inside the hole', () => {
    const prog = generateToolpath(project, 'drill');
    const moves = prog.moves;
    // Visit order: nearest first from the origin.
    const holes = moves
      .flatMap((m) => (m.kind === 'rapid' && m.to[2] === prog.safeZ ? [m.to.slice(0, 2)] : []))
      .filter((p, i, all) => i === 0 || p.join() !== all[i - 1]!.join());
    expect(holes).toEqual([
      [40, 160],
      [80, 160],
      [120, 170],
    ]);
    const firstHole = moves.slice(
      0,
      moves.findIndex((m, i) => i > 2 && m.kind === 'rapid' && m.to[2] === prog.safeZ),
    );
    const zs = firstHole.flatMap((m) => (m.kind === 'plunge' ? [m.to[2]] : []));
    // 10 mm in pecks of at most 3 mm: four equal pecks of 2.5 mm, each reached by a plunge.
    for (const d of passDepths(0, 10, 3)) expect(zs).toContain(d);
    expect(passDepths(0, 10, 3)).toEqual([-2.5, -5, -7.5, -10]);
    for (const m of firstHole) if (m.kind === 'rapid') expect(m.to[2]).toBeGreaterThanOrEqual(0);
    expect(moves.filter((m) => m.kind === 'dwell')).toHaveLength(3);
  });
});

// --- Post (T2.5) + golden G-code ---------------------------------------------------

const goldenDir = fileURLToPath(new URL('../../../../fixtures/gcode/golden/', import.meta.url));
/** Small relief job for the 3D golden files (kept small on purpose). */
function reliefProject(): Project {
  let p = newProject({
    stock: { width: 30, height: 20, thickness: 10, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([{ id: 'c', layer: 'L1', closed: true, segments: ellipse(15, 10, 7) }]).apply(p);
  p = addRelief(0.5, 'r1').apply(p);
  p = setReliefOp('r1', {
    op: 'fromVector',
    vector: 'c',
    profile: 'dome',
    height: 3,
    mode: 'add',
  }).apply(p);
  p = addTool({ id: 'ball', ...TOOL_PRESETS[5]!, stepOver: 2 }).apply(p);
  p = addTool({ id: 'flat', ...TOOL_PRESETS[3]! }).apply(p);
  p = addToolpath({
    id: 'finish3d',
    name: 'Relief finish',
    type: 'finish3d',
    tool: 'ball',
    relief: 'r1',
    vectors: [],
    params: { pattern: 'x' },
  }).apply(p);
  p = addToolpath({
    id: 'rough3d',
    name: 'Relief rough',
    type: 'rough3d',
    tool: 'flat',
    relief: 'r1',
    vectors: [],
    params: { allowance: 0.5 },
  }).apply(p);
  p = addToolpath({
    id: 'finish3d-spiral',
    name: 'Relief spiral finish',
    type: 'finish3d',
    tool: 'ball',
    relief: 'r1',
    vectors: [],
    params: { pattern: 'spiral' },
  }).apply(p);
  return projectSchema.parse(p);
}

/** Small job for the rest-machining golden: a 4 mm groove in a plate, after a 6 mm ball. */
function grooveProject(): Project {
  let p = newProject({
    stock: { width: 20, height: 16, thickness: 10, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([
    { id: 'plate', layer: 'L1', closed: true, segments: rectangle(-2, -2, 24, 20) },
    { id: 'groove', layer: 'L1', closed: true, segments: rectangle(8, 4, 4, 8) },
  ]).apply(p);
  p = addRelief(0.5, 'r1').apply(p);
  for (const [vector, height, mode] of [
    ['plate', 4, 'add'],
    ['groove', 2, 'subtract'],
  ] as const) {
    p = setReliefOp('r1', { op: 'fromVector', vector, profile: 'flat', height, mode }).apply(p);
  }
  p = addTool({ id: 'ball', ...TOOL_PRESETS[5]! }).apply(p);
  p = addTool({ id: 'small', ...TOOL_PRESETS[4]!, stepOver: 1 }).apply(p);
  p = addToolpath({
    id: 'rest3d',
    name: 'Groove rest',
    type: 'rest3d',
    tool: 'small',
    relief: 'r1',
    vectors: [],
    params: { restFrom: 'ball' },
  }).apply(p);
  return projectSchema.parse(p);
}

const goldenCases: { file: string; project: Project; id: string }[] = [
  { file: 'finish3d.nc', project: reliefProject(), id: 'finish3d' },
  { file: 'rough3d.nc', project: reliefProject(), id: 'rough3d' },
  { file: 'finish3d-spiral.nc', project: reliefProject(), id: 'finish3d-spiral' },
  { file: 'rest3d.nc', project: grooveProject(), id: 'rest3d' },
  ...project.toolpaths.map((t) => ({ file: `${t.id}.nc`, project, id: t.id })),
  { file: 'cutout-inch.nc', project: camProject('inch'), id: 'cutout' },
];

describe('GRBL post + golden files', () => {
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(goldenDir, { recursive: true });
    for (const c of goldenCases) {
      writeFileSync(goldenDir + c.file, exportToolpath(c.project, c.id, { simulated: true }).gcode);
    }
  }

  for (const c of goldenCases) {
    it(`${c.file} matches golden and passes the checker`, () => {
      const ex = exportToolpath(c.project, c.id, { simulated: true });
      expect(existsSync(goldenDir + c.file), `missing golden ${c.file}`).toBe(true);
      expect(ex.gcode).toBe(readFileSync(goldenDir + c.file, 'utf8'));
      expect(ex.check.issues).toEqual([]);
      expect(ex.ok).toBe(true);
    });
  }

  it('every golden file on disk is covered by a case', () => {
    const onDisk = readdirSync(goldenDir).filter((f) => f.endsWith('.nc'));
    expect(onDisk.sort()).toEqual(goldenCases.map((c) => c.file).sort());
  });

  it('writes the header in order and the footer', () => {
    const text = exportToolpath(project, 'holecut', { simulated: true }).gcode;
    const lines = text.trim().split('\n');
    expect(lines.slice(0, 6)).toEqual([
      '(Hole)',
      '(Tool: 3 mm flat end mill, diameter 3 mm)',
      'G21 G90 G94 G17',
      'G54',
      'G0 Z5',
      'M3 S18000',
    ]);
    expect(lines.slice(-3)).toEqual(['G0 Z5', 'M5', 'M30']);
  });

  it('inch output converts coordinates and feeds', () => {
    const p = camProject('inch');
    const text = exportToolpath(p, 'cutout', { simulated: true }).gcode;
    expect(text).toContain('G20 G90 G94 G17');
    expect(text).toMatch(/F59\.06/); // 1500 mm/min
    const parsed = parseGcode(text);
    const mm = parseGcode(exportToolpath(project, 'cutout', { simulated: true }).gcode);
    // Same geometry within inch rounding (0.00005 in ≈ 0.0013 mm).
    const xs = (g: typeof parsed) => g.moves.map((m) => m.to[0] ?? 0);
    expect(Math.max(...xs(parsed))).toBeCloseTo(Math.max(...xs(mm)), 2);
  });

  it('Mach3, LinuxCNC and generic dialects pass the checker with their own headers', () => {
    for (const post of ['mach3', 'linuxcnc', 'generic'] as const) {
      const p = { ...project, machine: { ...project.machine, post } };
      const ex = exportToolpath(p, 'cutout', { simulated: true });
      expect(ex.ok, post).toBe(true);
      expect(ex.check.issues, post).toEqual([]);
      expect(ex.gcode).toContain('G40 G49 G80');
      expect(ex.gcode.startsWith('%')).toBe(post === 'linuxcnc');
    }
  });

  it('sanitises comments', () => {
    const prog = generateToolpath(project, 'holecut');
    const text = postGrbl({ ...prog, name: 'Bad (name) — ü' }, { units: 'mm' });
    expect(text.split('\n')[0]).toBe('(Bad [name] ? ?)');
    expect(parseGcode(text).diagnostics).toEqual([]);
  });

  it('every generated file passes the checker with the operation-specific tool rule', () => {
    for (const tp of project.toolpaths) {
      const res = checkGcode(
        exportToolpath(project, tp.id, { simulated: true }).gcode,
        ctx(project, tp.tool, tp.type),
      );
      expect(res.issues, tp.id).toEqual([]);
    }
  });
});

// --- Time estimate (T2.6) ---------------------------------------------------------

describe('time estimate', () => {
  it('trapezoid and triangle profiles', () => {
    // 100 mm at 10 mm/s with a = 100: accel 0.5 mm in 0.1 s each end, cruise 99 mm.
    expect(trapezoidTime(100, 0, 0, 10, 100)).toBeCloseTo(0.1 + 0.1 + 9.9, 9);
    // Too short to reach vmax: triangle, 2·sqrt(L/a).
    expect(trapezoidTime(1, 0, 0, 100, 100)).toBeCloseTo(2 * Math.sqrt(0.01), 9);
  });

  it('a single feed move: length / feed plus acceleration', () => {
    // M3 just before the cut: the spindle change stops the planner, so the cut starts at rest.
    const g = parseGcode('G21 G90 G54\nG0 Z5\nG0 X0 Y0\nM3 S1000\nG1 X100 F600\n');
    const t = estimateTime(g, { maxFeed: 5000, acceleration: [100, 100, 100] });
    // Cutting: 100 mm at 10 mm/s: 10 s + 0.1 s for accel/decel.
    expect(t.cuttingSeconds).toBeCloseTo(10.1, 6);
    expect(t.cuttingLength).toBe(100);
  });

  it('sharp corners slow down; dwells add time', () => {
    const square = 'G21 G90 G54\nM3 S1000\nG0 Z5\nG0 X0 Y0\nG1 X50 F3000\nY50\nX0\nY0\n';
    const fast = estimateTime(parseGcode(square), { maxFeed: 5000, junctionDeviation: 1 });
    const slow = estimateTime(parseGcode(square), { maxFeed: 5000, junctionDeviation: 0.001 });
    expect(slow.cuttingSeconds).toBeGreaterThan(fast.cuttingSeconds);
    const dwell = estimateTime(parseGcode(square + 'G4 P2.5\n'), { maxFeed: 5000 });
    expect(dwell.dwellSeconds).toBe(2.5);
  });

  it('moves from an unknown start are timed from the work origin (where GRBL starts)', () => {
    // G0 Z5 then G0 X100: neither start is known; both are timed from X0 Y0 Z0.
    const t = estimateTime(parseGcode('G21 G90 G54\nG0 Z5\nG0 X100\n'), { maxFeed: 6000 });
    expect(t.rapidLength).toBeCloseTo(105, 9);
  });

  it('is within ±15% of grbl-sim for every golden file (T2.6 acceptance)', () => {
    const ref = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../../fixtures/gcode/grbl-sim-times.json', import.meta.url)),
        'utf8',
      ),
    ) as { seconds: Record<string, number> };
    const machine = {
      maxFeed: 5000,
      acceleration: [500, 500, 200] as [number, number, number],
      junctionDeviation: 0.01,
    };
    for (const [file, sim] of Object.entries(ref.seconds)) {
      const est = estimateTime(parseGcode(readFileSync(goldenDir + file, 'utf8')), machine).seconds;
      expect(
        Math.abs(est - sim) / sim,
        `${file}: estimate ${est.toFixed(1)} s, grbl-sim ${sim} s`,
      ).toBeLessThan(0.15);
    }
  });

  it('is sane for the fixture toolpaths and formats durations', () => {
    for (const tp of project.toolpaths) {
      const ex = exportToolpath(project, tp.id, { simulated: true });
      const lowerBound = ex.estimate.cuttingLength / (ex.program.tool.feed / 60);
      expect(ex.estimate.cuttingSeconds, tp.id).toBeGreaterThanOrEqual(lowerBound * 0.999);
      expect(ex.estimate.cuttingSeconds, tp.id).toBeLessThan(lowerBound * 3 + 60);
    }
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

// --- Export flow (T2.7) -----------------------------------------------------------

describe('export flow', () => {
  it('is blocked until the toolpath has been simulated', () => {
    const ex = exportToolpath(project, 'holecut', { simulated: false });
    expect(ex.ok).toBe(false);
    expect(ex.check.issues.map((i) => i.rule)).toEqual(['preview']);
  });

  it('is blocked by any checker error, e.g. cutting deeper than the stock', () => {
    const p = structuredClone(project);
    const tp = p.toolpaths.find((t) => t.id === 'holecut')!;
    if ('depth' in tp.params) tp.params.depth = 20;
    const ex = exportToolpath(p, 'holecut', { simulated: true });
    expect(ex.ok).toBe(false);
    expect(ex.check.issues.some((i) => i.rule === 'depth')).toBe(true);
    expect(ex.program.warnings.join()).toMatch(/deeper than the stock/);
  });

  it('is blocked when the design lies off the stock', () => {
    const p = transformVectors(['hole'], translation(400, 0)).apply(project);
    const ex = exportToolpath(p, 'holecut', { simulated: true });
    expect(ex.ok).toBe(false);
    expect(ex.check.issues.some((i) => i.rule === 'envelope')).toBe(true);
  });

  it('the simulation key changes with anything the output depends on', () => {
    const k = toolpathKey(project, 'holecut');
    expect(
      toolpathKey(transformVectors(['hole'], translation(1, 0)).apply(project), 'holecut'),
    ).not.toBe(k);
    expect(
      toolpathKey(transformVectors(['part'], translation(1, 0)).apply(project), 'holecut'),
    ).toBe(k);
  });

  it('respects stock origin: centre origin shifts coordinates', () => {
    const p = { ...project, stock: { ...project.stock, origin: 'center' as const } };
    const ex = exportToolpath(p, 'holecut', { simulated: true });
    expect(ex.ok).toBe(true);
    const xs = ex.check.program.moves.flatMap((m) => (m.to[0] === null ? [] : [m.to[0]]));
    expect(Math.max(...xs)).toBeCloseTo(70 + 8.5 - 150, 2);
  });

  it('pockets cut nothing outside the region (sanity on booleans)', () => {
    expect(
      regionArea(
        booleanOp(
          'intersect',
          offset(
            [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
              ],
            ],
            -3,
          ),
          [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
          ],
        ),
      ),
    ).toBeCloseTo(16, 6);
  });
});
