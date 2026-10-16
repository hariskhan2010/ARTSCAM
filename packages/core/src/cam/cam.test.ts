import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkGcode } from '../gcode/checker';
import { parseGcode } from '../gcode/parser';
import {
  addRelief,
  addTool,
  deleteTool,
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
import { createHeightmap, simulate, type Heightmap } from '../sim/heightmap';
import { estimateTime, formatDuration, trapezoidTime } from '../sim/time';
import { booleanOp, offset, regionArea } from '../vector/clip';
import { flatten, signedArea } from '../vector/flatten';
import { translation, type Vec2 } from '../vector/path';
import { ellipse, line, rectangle } from '../vector/shapes';
import { passDepths, tabSpans } from './builder';
import { chamferDepth } from './chamfer';
import { easeRamp, fluteDepth, fluteRamps } from './fluting';
import { exportToolpath, toolpathKey } from './export';
import { generateToolpath } from './generate';
import { pocketRegion, restRegion } from './pocket';
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
    { id: 'flute', layer: 'L1', closed: false, segments: line([90, 130], [150, 130]) },
    { id: 'bevel', layer: 'L1', closed: true, segments: rectangle(95, 95, 40, 20) },
  ]).apply(p);
  p = addTool({ id: 'em6', ...TOOL_PRESETS[3]! }).apply(p); // 6 mm flat
  p = addTool({ id: 'em3', ...TOOL_PRESETS[2]! }).apply(p); // 3 mm flat
  p = addTool({ id: 'v90', ...TOOL_PRESETS[7]! }).apply(p); // 90° V-bit
  p = addTool({ id: 'ball6', ...TOOL_PRESETS[5]! }).apply(p); // 6 mm ball nose
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
    {
      id: 'fluting',
      name: 'Flute',
      type: 'fluting',
      tool: 'ball6',
      vectors: ['flute'],
      params: { depth: 4, rampIn: 15, rampOut: 10 },
    },
    {
      id: 'chamfer',
      name: 'Chamfer',
      type: 'chamfer',
      tool: 'v90',
      vectors: ['bevel'],
      params: { width: 2, side: 'outside' },
    },
    {
      id: 'pocket-rest',
      name: 'Pocket corners',
      type: 'pocket',
      tool: 'em3',
      vectors: ['pocket', 'island'],
      params: { depth: 5, strategy: 'offset', restFrom: 'em6' },
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

// --- Fluting, chamfer, rest machining (T6.12) ---------------------------------------

/** Height of the simulated cell nearest (x, y). */
const cellZ = (hm: Heightmap, x: number, y: number) => {
  const c = Math.round((x - hm.x0) / hm.cell);
  const r = Math.round((y - hm.y0) / hm.cell);
  return hm.z[r * hm.cols + c]!;
};
/** X of the cell centre nearest x (so expectations use the exact sampled point). */
const cellX = (hm: Heightmap, x: number) => hm.x0 + Math.round((x - hm.x0) / hm.cell) * hm.cell;

/** Exports (checker must pass) and simulates the toolpaths in order on one heightmap. */
const simulated = (
  p: Project,
  ids: string[],
  cell = 0.25,
  hm = createHeightmap(p.stock, { cell }),
) => {
  for (const id of ids) {
    const ex = exportToolpath(p, id, { simulated: true });
    expect(ex.check.issues, id).toEqual([]);
    simulate(hm, ex.check.program, ex.program.tool);
  }
  return hm;
};

describe('fluting', () => {
  const params = { depth: 4, rampIn: 15, rampOut: 10 };
  const L = 60;
  const ramps = fluteRamps(L, params);

  it('ramps from the surface to full depth and back up before the end', () => {
    const at = (s: number) => fluteDepth(s, L, params, ramps);
    expect([0, 7.5, 15, 30, 50, 55, 60].map(at)).toEqual([0, 2, 4, 4, 4, 2, 0]);
    // Smooth: an S-curve through the same midpoint, gentler at both ends.
    const smooth = { ...params, shape: 'smooth' as const };
    expect(fluteDepth(7.5, L, smooth, ramps)).toBeCloseTo(2, 9);
    expect(fluteDepth(3.75, L, smooth, ramps)).toBeCloseTo(4 * easeRamp(0.25, 'smooth'), 9);
    expect(easeRamp(0.25, 'smooth')).toBeLessThan(0.25);
  });

  it('shortens ramps longer than the shape so they meet', () => {
    const r = fluteRamps(10, { rampIn: 15, rampOut: 5 });
    expect(r).toEqual({ rampIn: 7.5, rampOut: 2.5, scaled: true });
    expect(fluteDepth(7.5, 10, { depth: 4 }, r)).toBe(4);
  });

  it('every move follows the ramp profile, clamped to the depth per pass', () => {
    const prog = generateToolpath(project, 'fluting');
    const moves = cutMoves(project, 'fluting');
    expect(prog.warnings).toEqual([]);
    for (const m of moves) {
      expect(m.to[1]).toBe(130);
      const s = m.to[0] - 90;
      // On the flute profile, or clamped to the first pass depth (ball nose: 2 mm per pass).
      const want = -fluteDepth(s, L, params, ramps);
      expect(m.to[2]).toBeGreaterThanOrEqual(want - 1e-9);
      expect(
        [want, -2].some((z) => Math.abs(m.to[2] - z) < 1e-9),
        `s=${s} z=${m.to[2]}`,
      ).toBe(true);
    }
    expect(Math.min(...moves.map((m) => m.to[2]))).toBe(-4);
    const firstPass = moves.slice(0, moves.findIndex((m) => m.to[0] === 150) + 1);
    expect(Math.min(...firstPass.map((m) => m.to[2]))).toBe(-2);
    // Starts at the surface at the start of the line: no plunge into material.
    expect(moves[0]!.to).toEqual([90, 130, 0]);
  });

  it('smooth ramps follow the S-curve within 0.01 mm', () => {
    const p = structuredClone(project);
    const tp = p.toolpaths.find((t) => t.id === 'fluting')!;
    if (tp.type === 'fluting') tp.params.shape = 'smooth';
    const moves = cutMoves(p, 'fluting');
    const smooth = { ...params, shape: 'smooth' as const };
    let checked = 0;
    for (let i = 1; i < moves.length; i++) {
      const a = moves[i - 1]!.to;
      const b = moves[i]!.to;
      // Last pass only (below the first pass's 2 mm clamp, or on the ramps' upper half).
      if (a[0] === b[0] || Math.min(a[2], b[2]) <= -2 + 1e-9) continue;
      const mid = (a[0] + b[0]) / 2 - 90;
      expect(Math.abs((a[2] + b[2]) / 2 + fluteDepth(mid, L, smooth, ramps))).toBeLessThan(0.011);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('simulated groove: full depth in the middle, tapering to nothing at both ends', () => {
    const hm = simulated(project, ['fluting']);
    for (const s of [2, 5, 10, 14, 20, 30, 45, 52, 58]) {
      const x = cellX(hm, 90 + s);
      const want = -fluteDepth(x - 90, L, params, ramps);
      const z = cellZ(hm, x, 130);
      // A ball on a slope k dips below its tip line by up to k²·R/2 (0.11 mm in, 0.24 mm out).
      const k = s <= 15 ? 4 / 15 : s >= 50 ? 4 / 10 : 0;
      expect(z, `s=${s}`).toBeLessThanOrEqual(want + 0.02);
      expect(z, `s=${s}`).toBeGreaterThan(want - (k * k * 3) / 2 - 0.03);
    }
    // 6 mm wide at full depth; nothing cut beyond the ends.
    expect(cellZ(hm, 120, 130 + 2.9)).toBeLessThan(-0.5);
    expect(cellZ(hm, 120, 130 + 3.2)).toBe(0);
    expect(cellZ(hm, 86.5, 130)).toBe(0);
    expect(cellZ(hm, 153.5, 130)).toBe(0);
  });

  it('a flat end mill is flagged by the tool rule', () => {
    const p = structuredClone(project);
    p.toolpaths.find((t) => t.id === 'fluting')!.tool = 'em6';
    const ex = exportToolpath(p, 'fluting', { simulated: true });
    expect(ex.ok).toBe(false);
    expect(ex.check.issues.map((i) => i.rule)).toEqual(['tool']);
    expect(ex.program.warnings.join()).toMatch(/ball nose or V-bit/);
  });
});

describe('chamfer', () => {
  it('depth = width / tan(½·angle)', () => {
    expect(chamferDepth({ angle: 90 }, 2)).toBeCloseTo(2, 12);
    expect(chamferDepth({ angle: 60 }, 2)).toBeCloseTo(2 * Math.sqrt(3), 12);
  });

  it('tip runs `width` from the line on the chosen side, at the chamfer depth', () => {
    const moves = cutMoves(project, 'chamfer');
    // 2 / tan(45°) is 2 within rounding.
    const deepest = moves.filter((m) => m.to[2] < -2 + 1e-9);
    const xs = deepest.map((m) => m.to[0]);
    const ys = deepest.map((m) => m.to[1]);
    expect(Math.min(...xs)).toBeCloseTo(93, 6);
    expect(Math.max(...xs)).toBeCloseTo(137, 6);
    expect(Math.min(...ys)).toBeCloseTo(93, 6);
    expect(Math.max(...ys)).toBeCloseTo(117, 6);
    expect(Math.min(...moves.map((m) => m.to[2]))).toBeCloseTo(-2, 12);
    // Climb on an outside cut: clockwise.
    expect(signedArea(deepest.map((m): Vec2 => [m.to[0], m.to[1]]))).toBeLessThan(0);

    // Inside, 3 mm wide: tip 3 mm inside the line, 3 mm deep in two 1.5 mm passes.
    const p = structuredClone(project);
    const tp = p.toolpaths.find((t) => t.id === 'chamfer')!;
    if (tp.type === 'chamfer') tp.params = { width: 3, side: 'inside' };
    const inside = cutMoves(p, 'chamfer');
    const bottom = inside.filter((m) => m.to[2] < -3 + 1e-9);
    expect(Math.min(...bottom.map((m) => m.to[0]))).toBeCloseTo(98, 6);
    expect(Math.max(...bottom.map((m) => m.to[1]))).toBeCloseTo(112, 6);
    expect([...new Set(inside.map((m) => m.to[2]))].map((z) => z.toFixed(9))).toEqual([
      '-1.500000000',
      '-3.000000000',
    ]);
  });

  it('simulated bevel starts at the line and falls at 45° to the chamfer depth', () => {
    const hm = simulated(project, ['chamfer']);
    // Across the left edge (line at x = 95), at mid-height of the shape.
    for (const x0 of [96, 95.2, 94.6, 94, 93.4, 93]) {
      const x = cellX(hm, x0);
      const want = Math.min(0, -(95 - x)); // 90° bit: depth = distance outside the line
      expect(cellZ(hm, x, 105), `x=${x}`).toBeCloseTo(want, 1);
    }
    // The far flank of the V rises again, to the surface 2·width from the line.
    const x = cellX(hm, 92);
    expect(cellZ(hm, x, 105)).toBeCloseTo(-(x - 91), 1);
    expect(cellZ(hm, 90.5, 105)).toBe(0);
  });

  it('a flat end mill is flagged by the tool rule', () => {
    const p = structuredClone(project);
    p.toolpaths.find((t) => t.id === 'chamfer')!.tool = 'em6';
    const ex = exportToolpath(p, 'chamfer', { simulated: true });
    expect(ex.ok).toBe(false);
    expect(ex.check.issues.map((i) => i.rule)).toEqual(['tool']);
    expect(ex.program.warnings.join()).toMatch(/needs a V-bit/);
  });
});

describe('pocket rest machining', () => {
  const corners: Vec2[] = [
    [160, 20],
    [280, 20],
    [280, 120],
    [160, 120],
  ];
  const nearCorner = (x: number, y: number) =>
    Math.min(...corners.map(([cx, cy]) => Math.hypot(x - cx, y - cy)));

  it('the rest region of a square is only its four corners', () => {
    const sq: Vec2[][] = [
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    ];
    const rest = restRegion(sq, 3);
    expect(rest).toHaveLength(4);
    // Each corner: a 3 × 3 square minus a quarter disc of radius 3.
    expect(regionArea(rest)).toBeCloseTo(4 * 9 * (1 - Math.PI / 4), 0);
    const d = ([x, y]: Vec2) =>
      Math.min(
        Math.hypot(x, y),
        Math.hypot(100 - x, y),
        Math.hypot(x, 100 - y),
        Math.hypot(100 - x, 100 - y),
      );
    for (const ring of rest) for (const pt of ring) expect(d(pt)).toBeLessThan(3 + 1e-3);
    // A round pocket leaves nothing: the big tool reaches all of a convex boundary.
    const disc = flatten(ellipse(0, 0, 20), 0.005, true).map((p) => p.points);
    expect(restRegion(disc, 3)).toEqual([]);
  });

  it('cuts only near the corners the 6 mm tool could not reach', () => {
    const moves = cutMoves(project, 'pocket-rest');
    expect(moves.length).toBeGreaterThan(8);
    // Small tool radius 1.5 + big radius 3, plus a little for the offset arcs.
    for (const m of moves) expect(nearCorner(m.to[0], m.to[1])).toBeLessThan(4.6);
    // Every corner is reached, at full depth, in 1.5 mm passes.
    for (const [cx, cy] of corners)
      expect(moves.some((m) => Math.hypot(m.to[0] - cx, m.to[1] - cy) < 2.2)).toBe(true);
    expect(new Set(moves.map((m) => m.to[2]))).toEqual(new Set(passDepths(0, 5, 1.5)));
  });

  it('simulated: the corners left by the big tool are cleared by the small one', () => {
    let p = newProject({
      stock: { width: 60, height: 60, thickness: 10, origin: 'bottom-left', zZero: 'top' },
    });
    p = addVectors([
      { id: 'sq', layer: 'L1', closed: true, segments: rectangle(10, 10, 40, 40) },
    ]).apply(p);
    p = addTool({ id: 'big', ...TOOL_PRESETS[3]! }).apply(p); // 6 mm flat
    p = addTool({ id: 'small', ...TOOL_PRESETS[2]! }).apply(p); // 3 mm flat
    p = addToolpath({
      id: 'clear',
      type: 'pocket',
      tool: 'big',
      vectors: ['sq'],
      params: { depth: 3, strategy: 'offset' },
    }).apply(p);
    p = addToolpath({
      id: 'rest',
      type: 'pocket',
      tool: 'small',
      vectors: ['sq'],
      params: { depth: 3, strategy: 'offset', restFrom: 'big' },
    }).apply(p);
    p = projectSchema.parse(p);

    // Cells within 4 mm of a corner that a 3 mm tool can reach (with a cell of slack):
    // inside the square, outside the 1.5 mm radius it leaves in the very corner.
    const target = (x: number, y: number) => {
      const u = Math.abs(x - 30);
      const v = Math.abs(y - 30);
      return (
        Math.max(u, v) <= 20 - 0.3 &&
        Math.min(u, v) >= 16 &&
        Math.hypot(Math.max(0, u - 18.5), Math.max(0, v - 18.5)) <= 1.5 - 0.3
      );
    };
    const count = (hm: Heightmap) => {
      let cells = 0;
      let uncut = 0;
      for (let r = 0; r < hm.rows; r++)
        for (let c = 0; c < hm.cols; c++) {
          if (!target(hm.x0 + c * hm.cell, hm.y0 + r * hm.cell)) continue;
          cells++;
          if (hm.z[r * hm.cols + c]! > -3 + 1e-3) uncut++;
        }
      return { cells, uncut };
    };
    const hm = simulated(p, ['clear'], 0.1);
    const before = count(hm);
    expect(before.uncut).toBeGreaterThan(50); // the big tool leaves the corners
    simulated(p, ['rest'], 0.1, hm);
    expect(count(hm)).toEqual({ cells: before.cells, uncut: 0 });
    let gouged = 0;
    for (const z of hm.z) if (z < -3 - 1e-3) gouged++;
    expect(gouged).toBe(0);
    // Outside the pocket the material is untouched.
    expect(cellZ(hm, 9.7, 30)).toBe(0);
    expect(cellZ(hm, 9.7, 9.7)).toBe(0);
  });

  it('warns when the first tool is not larger; the first tool cannot be deleted', () => {
    const p = structuredClone(project);
    const tp = p.toolpaths.find((t) => t.id === 'pocket-rest')!;
    if (tp.type === 'pocket') tp.params.restFrom = 'em3';
    expect(generateToolpath(p, 'pocket-rest').warnings.join()).toMatch(/not larger/);

    let q = structuredClone(project);
    q = { ...q, toolpaths: q.toolpaths.filter((t) => t.tool !== 'em6') };
    expect(deleteTool('em6').apply(q)).toBe(q); // still the rest pass's first tool

    const bad = structuredClone(project);
    const r = bad.toolpaths.find((t) => t.id === 'pocket-rest')!;
    if (r.type === 'pocket') r.params.restFrom = 'nope';
    expect(projectSchema.safeParse(bad).success).toBe(false);
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
  return projectSchema.parse(p);
}

const goldenCases: { file: string; project: Project; id: string }[] = [
  { file: 'finish3d.nc', project: reliefProject(), id: 'finish3d' },
  { file: 'rough3d.nc', project: reliefProject(), id: 'rough3d' },
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
