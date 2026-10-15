import { describe, expect, it } from 'vitest';
import type { Segment } from '../model/schema';
import { flatten, signedArea } from './flatten';
import {
  alignOffsets,
  arcThrough,
  chamferCorners,
  circularArrayMatrices,
  distributeOffsets,
  filletCorners,
  gridArrayMatrices,
  joinOpenPaths,
  repairSegments,
} from './edit';
import { applyMatrix, bbox, length, pointAt, type Vec2 } from './path';
import { rectangle } from './shapes';

const pts = (segs: Segment[], closed = false) =>
  flatten(segs, 0.001, closed).flatMap((p) => p.points);
const close = (a: Vec2, b: Vec2, eps = 1e-6) =>
  expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(eps);

describe('arc through three points', () => {
  it('passes through all three and stays on the circle', () => {
    const segs = arcThrough([10, 0], [0, 10], [-10, 0]);
    const p = pts(segs);
    close(p[0]!, [10, 0]);
    close(p.at(-1)!, [-10, 0]);
    for (const q of p) expect(Math.abs(Math.hypot(q[0], q[1]) - 10)).toBeLessThan(0.005);
    // Through the top, not the bottom.
    expect(Math.max(...p.map((q) => q[1]))).toBeCloseTo(10, 2);
    expect(length(segs)).toBeCloseTo(Math.PI * 10, 1);
  });

  it('bulges to the side of the middle point; collinear points give a straight line', () => {
    const below = pts(arcThrough([10, 0], [0, -10], [-10, 0]));
    expect(Math.min(...below.map((q) => q[1]))).toBeCloseTo(-10, 2);
    const straight = arcThrough([0, 0], [5, 0], [10, 0]);
    expect(straight).toEqual([
      { type: 'move', p: [0, 0] },
      { type: 'line', p: [10, 0] },
    ]);
  });
});

describe('fillet and chamfer', () => {
  const square = rectangle(0, 0, 20, 20);

  it('fillet rounds every line–line corner with the radius, keeping the shape closed', () => {
    const f = filletCorners(square, 3);
    const b = bbox(f)!;
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 20, 20]);
    // A rounded square's perimeter: 4·(20 − 2r) + 2πr.
    expect(length(f, true)).toBeCloseTo(4 * 14 + 2 * Math.PI * 3, 1);
    // The corner point is gone; the arc's middle sits r(1 − 1/√2) in from the corner.
    const p = pts(f, true);
    const nearest = Math.min(...p.map((q) => Math.hypot(q[0] - 20, q[1] - 20)));
    expect(nearest).toBeCloseTo(3 * (Math.SQRT2 - 1), 2);
    expect(signedArea(p)).toBeGreaterThan(0); // still counter-clockwise
  });

  it('chamfer cuts every corner straight at the distance', () => {
    const c = chamferCorners(square, 4);
    // Perimeter: 4·(20 − 8) + 4·4√2.
    expect(length(c, true)).toBeCloseTo(4 * 12 + 4 * 4 * Math.SQRT2, 6);
  });

  it('a radius too large for a side is limited to half the shorter side', () => {
    const f = filletCorners(rectangle(0, 0, 10, 4), 5);
    expect(length(f, true)).toBeGreaterThan(0);
    const b = bbox(f)!;
    expect(b.maxX - b.minX).toBeCloseTo(10, 6);
    expect(b.maxY - b.minY).toBeCloseTo(4, 6);
  });

  it('open paths keep their end points; curves are left alone', () => {
    const open: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'line', p: [10, 0] },
      { type: 'line', p: [10, 10] },
    ];
    const f = filletCorners(open, 2);
    const p = pts(f);
    close(p[0]!, [0, 0]);
    close(p.at(-1)!, [10, 10]);
    const curvy: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'cubic', c1: [3, 5], c2: [7, 5], p: [10, 0] },
      { type: 'cubic', c1: [13, -5], c2: [17, -5], p: [20, 0] },
    ];
    expect(filletCorners(curvy, 2)).toEqual(curvy);
  });
});

describe('arrays', () => {
  it('grid: cols × rows copies at the spacing, the original first', () => {
    const ms = gridArrayMatrices(3, 2, 15, 10);
    expect(ms).toHaveLength(6);
    expect(ms.map((m) => applyMatrix(m, [0, 0]))).toEqual([
      [0, 0],
      [15, 0],
      [30, 0],
      [0, 10],
      [15, 10],
      [30, 10],
    ]);
  });

  it('circular: copies evenly around the centre over the angle', () => {
    const ms = circularArrayMatrices(4, [0, 0], 360);
    expect(ms).toHaveLength(4);
    const p = ms.map((m) => applyMatrix(m, [10, 0]));
    close(p[1] as Vec2, [0, 10]);
    close(p[2] as Vec2, [-10, 0]);
    close(p[3] as Vec2, [0, -10]);
    // A part circle includes both ends.
    const half = circularArrayMatrices(3, [0, 0], 180).map((m) => applyMatrix(m, [10, 0]));
    close(half[2] as Vec2, [-10, 0]);
  });
});

describe('align and distribute', () => {
  const boxes = [
    { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    { minX: 20, minY: 10, maxX: 24, maxY: 30 },
    { minX: 50, minY: 2, maxX: 60, maxY: 6 },
  ];

  it('aligns edges and centres to the whole selection', () => {
    expect(alignOffsets(boxes, 'left')).toEqual([
      [0, 0],
      [-20, 0],
      [-50, 0],
    ]);
    expect(alignOffsets(boxes, 'top').map((o) => o[1])).toEqual([25, 0, 24]);
    expect(alignOffsets(boxes, 'centerX').map((o) => o[0])).toEqual([25, 8, -25]);
    expect(alignOffsets(boxes, 'middle').map((o) => o[1])).toEqual([12.5, -5, 11]);
  });

  it('distributes with equal gaps, outer shapes fixed', () => {
    const [a, b, c] = distributeOffsets(boxes, 'x');
    expect(a).toEqual([0, 0]);
    expect(c).toEqual([0, 0]);
    // Gaps: total 60 − widths (10 + 4 + 10) = 36 → 18 each; middle box starts at 28.
    expect(b![0]).toBeCloseTo(8, 9);
  });
});

describe('join and repair', () => {
  const seg = (a: Vec2, b: Vec2): Segment[] => [
    { type: 'move', p: [a[0], a[1]] },
    { type: 'line', p: [b[0], b[1]] },
  ];

  it('joins open paths whose ends meet (either way round) and closes a loop', () => {
    const joined = joinOpenPaths(
      [seg([0, 0], [10, 0]), seg([10, 10], [10, 0.0004]), seg([0, 0], [10, 10])],
      0.001,
    );
    expect(joined).toHaveLength(1);
    expect(joined[0]!.closed).toBe(true);
    expect(length(joined[0]!.segments, true)).toBeCloseTo(20 + Math.SQRT2 * 10, 2);
    // Far-apart paths stay separate.
    expect(joinOpenPaths([seg([0, 0], [1, 0]), seg([5, 5], [6, 5])], 0.001)).toHaveLength(2);
  });

  it('repair drops zero-length segments and repeated points and closes near-closed paths', () => {
    const messy: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'line', p: [10, 0] },
      { type: 'line', p: [10, 0] },
      { type: 'line', p: [10, 10] },
      { type: 'line', p: [0, 10] },
      { type: 'line', p: [0, 0.0003] },
    ];
    const { segments, closed, fixes } = repairSegments(messy, false, 0.001);
    expect(closed).toBe(true);
    expect(segments.filter((s) => s.type === 'line')).toHaveLength(3);
    expect(segments.at(-1)).toEqual({ type: 'close' });
    expect(fixes).toBeGreaterThanOrEqual(2);
    expect(pointAt(segments, 0, true)?.point).toEqual([0, 0]);
  });
});
