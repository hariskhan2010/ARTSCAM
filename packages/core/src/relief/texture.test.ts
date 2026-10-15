import { describe, expect, it } from 'vitest';
import { addRelief, addVectors, newProject, setReliefOp } from '../model/commands';
import { projectSchema, type Project, type ReliefOp } from '../model/schema';
import { rectangle } from '../vector/shapes';
import { evaluateRelief, gridRange } from './relief';

function build(op: ReliefOp) {
  let p: Project = newProject({
    stock: { width: 100, height: 60, thickness: 20, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([
    { id: 'box', layer: 'L1', closed: true, segments: rectangle(20, 20, 30, 20) },
  ]).apply(p);
  p = addRelief(0.25, 'r').apply(p);
  p = setReliefOp('r', op).apply(p);
  const g = evaluateRelief(projectSchema.parse(p).reliefs[0]!, p);
  // Cell whose centre is nearest (x, y).
  const at = (x: number, y: number) =>
    g.z[Math.round(y / g.resolution - 0.5) * g.cols + Math.round(x / g.resolution - 0.5)]!;
  return { g, at };
}

describe('textures (T6.4)', () => {
  it('lines: ridges at the set spacing and height, turned by the angle', () => {
    const { g, at } = build({
      op: 'texture',
      pattern: 'lines',
      spacing: 4,
      height: 1,
      mode: 'add',
    });
    expect(gridRange(g.z).max).toBeCloseTo(1, 1); // cell centres sample the cosine
    expect(gridRange(g.z).min).toBeCloseTo(0, 1);
    // Period 4 along X; the same everywhere along Y.
    expect(at(10.125, 5)).toBeCloseTo(at(14.125, 5), 3);
    expect(at(10.125, 5)).toBeCloseTo(at(10.125, 37), 3);
    expect(Math.abs(at(10.125, 5) - at(12.125, 5))).toBeGreaterThan(0.9);
    // At 90° the ridges run the other way.
    const turned = build({
      op: 'texture',
      pattern: 'lines',
      spacing: 4,
      height: 1,
      angle: 90,
      mode: 'add',
    });
    expect(turned.at(10.125, 6.125)).toBeCloseTo(turned.at(30.125, 6.125), 3);
    expect(Math.abs(turned.at(10.125, 6.125) - turned.at(10.125, 8.125))).toBeGreaterThan(0.9);
  });

  it('dimples: a bump of the set height on a grid at the spacing', () => {
    const { at } = build({
      op: 'texture',
      pattern: 'dimples',
      spacing: 5,
      height: 0.8,
      mode: 'add',
    });
    expect(at(2.5, 2.5)).toBeCloseTo(0.8, 1); // bump centre
    expect(at(7.5, 12.5)).toBeCloseTo(0.8, 1);
    expect(at(5, 5)).toBeCloseTo(0, 3); // between bumps
  });

  it('hammered and weave stay within 0 and the height and repeat the same way each time', () => {
    for (const pattern of ['hammered', 'weave'] as const) {
      const a = build({ op: 'texture', pattern, spacing: 6, height: 1.5, mode: 'add' });
      const b = build({ op: 'texture', pattern, spacing: 6, height: 1.5, mode: 'add' });
      const r = gridRange(a.g.z);
      expect(r.min, pattern).toBeGreaterThanOrEqual(-1e-6);
      expect(r.max, pattern).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(r.max, pattern).toBeGreaterThan(1.2);
      expect(a.g.z).toEqual(b.g.z);
    }
  });

  it('inside a shape: only cells inside it change', () => {
    const { at } = build({
      op: 'texture',
      pattern: 'dimples',
      spacing: 5,
      height: 1,
      within: 'box',
      mode: 'add',
    });
    expect(at(22.5, 22.5)).toBeGreaterThan(0.5);
    expect(at(12.5, 22.5)).toBe(0);
    expect(at(22.5, 47.5)).toBe(0);
  });
});
