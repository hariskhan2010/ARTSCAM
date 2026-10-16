import { describe, expect, it } from 'vitest';
import { newProject } from '../model/commands';
import { loadProject, saveProject } from '../model/projectFile';
import { projectSchema, type Project, type Relief, type ReliefOp } from '../model/schema';
import { STARTER_CLIPS, defaultClipPlacement, makeStarterClip } from './clipart';
import { meshToHeights, parseObj } from './mesh';
import { ReliefError, evaluateRelief, gridRange } from './relief';

type Paste = Extract<ReliefOp, { op: 'paste' }>;

/** An 8 × 6 clip with distinct, uneven heights (peak 7.5). */
function testClip(cols = 8, rows = 6): Float32Array {
  const z = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) z[r * cols + c] = ((c * 7 + r * 3) % 11) * 0.75;
  return z;
}

function setup(ops: ReliefOp[], size: [number, number], res = 1): { p: Project; relief: Relief } {
  const p = newProject({
    stock: { width: size[0], height: size[1], thickness: 18, origin: 'bottom-left', zZero: 'top' },
  });
  const relief: Relief = {
    id: 'r1',
    resolution: res,
    cols: Math.ceil(size[0] / res),
    rows: Math.ceil(size[1] / res),
    data: 'reliefs/r1.f32',
    ops,
  };
  return { p: { ...p, reliefs: [relief] }, relief };
}

const paste = (patch: Partial<Paste> = {}): Paste => ({
  op: 'paste',
  clip: 'c1',
  cols: 8,
  rows: 6,
  x: 0,
  y: 0,
  w: 8,
  h: 6,
  height: 7.5,
  mode: 'add',
  ...patch,
});

describe('paste clipart', () => {
  it('reproduces the clip exactly at matching resolution', () => {
    const clip = testClip();
    expect(gridRange(clip).max).toBe(7.5);
    const { p, relief } = setup([paste()], [8, 6]);
    const g = evaluateRelief(relief, p, {}, { c1: clip });
    for (let i = 0; i < clip.length; i++) expect(g.z[i]).toBeCloseTo(clip[i]!, 5);
  });

  it('scales heights so the peak is `height`, and offsets with the rectangle', () => {
    const clip = testClip();
    const { p, relief } = setup([paste({ x: 2, y: 3, height: 3 })], [12, 10]);
    const g = evaluateRelief(relief, p, {}, { c1: clip });
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 8; c++)
        expect(g.z[(r + 3) * 12 + c + 2]).toBeCloseTo((clip[r * 8 + c]! * 3) / 7.5, 5);
    // Outside the rectangle nothing changes.
    expect(g.z[0]).toBe(0);
    expect(g.z[9 * 12 + 11]).toBe(0);
  });

  it('turns the clip 90° counter-clockwise about the rectangle centre', () => {
    const N = 6;
    const clip = testClip(N, N);
    const { max } = gridRange(clip);
    const { p, relief } = setup(
      [paste({ cols: N, rows: N, w: N, h: N, rotation: 90, height: max })],
      [N, N],
    );
    const g = evaluateRelief(relief, p, {}, { c1: clip });
    // World cell (c, r) shows clip cell (col r, row N-1-c).
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) expect(g.z[r * N + c]).toBeCloseTo(clip[(N - 1 - c) * N + r]!, 4);
  });

  it('samples bilinearly when the resolutions differ', () => {
    // A ramp along x stays a ramp at twice the detail.
    const clip = Float32Array.from({ length: 4 * 2 }, (_, i) => i % 4);
    const { p, relief } = setup([paste({ cols: 4, rows: 2, w: 4, h: 2, height: 3 })], [4, 2], 0.5);
    const g = evaluateRelief(relief, p, {}, { c1: clip });
    // Cell centres x = 0.75, 1.25: clip coordinates 0.25, 0.75 → heights 0.25, 0.75.
    expect(g.z[1]).toBeCloseTo(0.25, 6);
    expect(g.z[2]).toBeCloseTo(0.75, 6);
  });

  it('combines with what is there', () => {
    const clip = testClip();
    const { p, relief } = setup(
      [{ op: 'offset', amount: 2 }, paste({ mode: 'mergeHigh' })],
      [8, 6],
    );
    const g = evaluateRelief(relief, p, {}, { c1: clip });
    for (let i = 0; i < clip.length; i++) expect(g.z[i]).toBeCloseTo(Math.max(2, clip[i]!), 5);
  });

  it('fails clearly when the clip is missing', () => {
    const { p, relief } = setup([paste()], [8, 6]);
    expect(() => evaluateRelief(relief, p)).toThrow(ReliefError);
  });

  it('an imported mesh pasted at its own size matches the mesh within a cell', () => {
    // A pyramid 10 × 10, 4 high, pasted at its size and height.
    const tris = parseObj(
      [
        'v 0 0 0',
        'v 10 0 0',
        'v 10 10 0',
        'v 0 10 0',
        'v 5 5 4',
        'f 1 2 5',
        'f 2 3 5',
        'f 3 4 5',
        'f 4 1 5',
      ].join('\n'),
    );
    const m = meshToHeights(tris, 0.25);
    const { p, relief } = setup(
      [paste({ cols: m.cols, rows: m.rows, x: 5, y: 5, w: m.width, h: m.height, height: m.depth })],
      [20, 20],
      0.5,
    );
    const g = evaluateRelief(relief, p, {}, { c1: m.z });
    let worst = 0;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const x = (c + 0.5) * 0.5 - 5;
        const y = (r + 0.5) * 0.5 - 5;
        const truth = Math.max(0, 4 * (1 - Math.max(Math.abs(x - 5), Math.abs(y - 5)) / 5));
        worst = Math.max(worst, Math.abs(g.z[r * g.cols + c]! - truth));
      }
    // Slope 0.8 mm/mm: within a cell of the relief means under 0.8 · 0.5 mm.
    expect(worst).toBeLessThan(0.4);
  });
});

describe('starter clipart', () => {
  it('builds every clip, peaking at 1, flat at the edges', () => {
    for (const s of STARTER_CLIPS) {
      const c = makeStarterClip(s.id)!;
      expect(c.z.length).toBe(s.cols * s.rows);
      expect(c.cols * c.rows).toBeLessThanOrEqual(128 * 128);
      const { min, max } = gridRange(c.z);
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeCloseTo(1, 6);
      // Corners are empty so a clip blends into the relief around it.
      expect(c.z[0]).toBe(0);
      expect(c.z[c.z.length - 1]).toBe(0);
    }
    expect(makeStarterClip('nope')).toBeUndefined();
  });

  it('default placement fits a third of the material, centred, keeping the aspect', () => {
    expect(defaultClipPlacement({ width: 300, height: 150 }, 2)).toEqual({
      x: 100,
      y: 50,
      w: 100,
      h: 50,
    });
    const tall = defaultClipPlacement({ width: 300, height: 150 }, 0.5);
    expect(tall.h).toBeCloseTo(50);
    expect(tall.w).toBeCloseTo(25);
    expect(tall.x + tall.w / 2).toBeCloseTo(150);
  });
});

describe('project file with clipart', () => {
  function bundle() {
    const clip = testClip();
    const { p, relief } = setup([paste()], [8, 6]);
    const project = projectSchema.parse(p);
    return {
      project,
      reliefData: { r1: evaluateRelief(relief, project, {}, { c1: clip }).z },
      clips: { c1: clip },
    };
  }

  it('round-trips clips at clips/<id>.f32', () => {
    const b = bundle();
    const loaded = loadProject(saveProject(b));
    expect(loaded.project).toEqual(b.project);
    expect(Array.from(loaded.clips!.c1!)).toEqual(Array.from(b.clips.c1));
    const g = evaluateRelief(loaded.project.reliefs[0]!, loaded.project, {}, loaded.clips);
    expect(Array.from(g.z)).toEqual(Array.from(b.reliefData.r1));
  });

  it('rejects a missing, wrong-sized or non-finite clip', () => {
    const b = bundle();
    expect(() => saveProject({ ...b, clips: {} })).toThrow(/Missing clipart "c1"/);
    expect(() => saveProject({ ...b, clips: { c1: new Float32Array(5) } })).toThrow(
      /has 5 values, expected 48/,
    );
    const bad = testClip();
    bad[3] = NaN;
    expect(() => saveProject({ ...b, clips: { c1: bad } })).toThrow(/non-finite/);
  });
});
