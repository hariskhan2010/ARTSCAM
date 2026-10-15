import { describe, expect, it } from 'vitest';
import { addRelief, newProject, setReliefOp } from '../model/commands';
import { History } from '../model/history';
import { projectSchema, type Project, type ReliefOp } from '../model/schema';
import { evaluateRelief } from './relief';

function setup(...ops: ReliefOp[]) {
  let p: Project = newProject({
    stock: { width: 100, height: 60, thickness: 20, origin: 'bottom-left', zZero: 'top' },
  });
  p = addRelief(0.25, 'r').apply(p);
  for (const op of ops) p = setReliefOp('r', op).apply(p);
  return projectSchema.parse(p);
}
const grid = (p: Project) => evaluateRelief(p.reliefs[0]!, p);
const atOf = (g: ReturnType<typeof grid>) => (x: number, y: number) =>
  g.z[Math.floor(y / g.resolution) * g.cols + Math.floor(x / g.resolution)]!;

const stroke = (tool: 'raise' | 'lower' | 'smooth', strength: number): ReliefOp => ({
  op: 'sculpt',
  tool,
  radius: 5,
  strength,
  points: [
    [20, 30],
    [50, 30],
    [80, 30],
  ],
});

describe('sculpt (T6.5)', () => {
  it('raise and lower change heights by the strength along the stroke, nothing beyond the radius', () => {
    const up = atOf(grid(setup(stroke('raise', 2))));
    expect(up(35, 30)).toBeCloseTo(2, 1);
    expect(up(65, 30)).toBeCloseTo(2, 1);
    expect(up(35, 32.5)).toBeGreaterThan(0.3);
    expect(up(35, 32.5)).toBeLessThan(2);
    expect(up(35, 35.2)).toBe(0);
    expect(up(10, 30)).toBe(0);
    // Dense or sparse points give the same stroke: no build-up where stamps overlap.
    const dense = setup({
      ...stroke('raise', 2),
      points: Array.from({ length: 61 }, (_, i): [number, number] => [20 + i, 30]),
    } as ReliefOp);
    expect(atOf(grid(dense))(35, 30)).toBeCloseTo(2, 1);
    const down = atOf(grid(setup(stroke('lower', 1.5))));
    expect(down(50, 30)).toBeCloseTo(-1.5, 1);
  });

  it('smooth flattens bumps only within the radius', () => {
    const bumpy: ReliefOp = { op: 'texture', pattern: 'lines', spacing: 2, height: 1, mode: 'add' };
    const before = atOf(grid(setup(bumpy)));
    const after = atOf(grid(setup(bumpy, stroke('smooth', 1))));
    const spread = (f: (x: number, y: number) => number, y: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = 40; x < 44; x += 0.25) {
        lo = Math.min(lo, f(x, y));
        hi = Math.max(hi, f(x, y));
      }
      return hi - lo;
    };
    expect(spread(after, 30)).toBeLessThan(spread(before, 30) * 0.3);
    expect(spread(after, 45)).toBeCloseTo(spread(before, 45), 6);
  });

  it('a stroke is one undoable step', () => {
    const h = new History(setup());
    h.execute(setReliefOp('r', stroke('raise', 2)));
    expect(atOf(grid(h.doc))(50, 30)).toBeCloseTo(2, 1);
    h.undo();
    expect(atOf(grid(h.doc))(50, 30)).toBe(0);
  });
});
