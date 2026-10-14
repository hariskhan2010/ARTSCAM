import { describe, expect, it } from 'vitest';
import type { Segment } from '../model/schema';
import {
  applyMatrix,
  bbox,
  invert,
  length,
  multiply,
  pieces,
  pointAt,
  rotation,
  scaling,
  subpaths,
  transformSegments,
  translation,
} from './path';

const square: Segment[] = [
  { type: 'move', p: [0, 0] },
  { type: 'line', p: [10, 0] },
  { type: 'line', p: [10, 10] },
  { type: 'line', p: [0, 10] },
  { type: 'close' },
];

/** Quarter circle of radius r (standard cubic approximation, k = 0.5523). */
const K = (4 / 3) * (Math.SQRT2 - 1);
const quarter = (r: number): Segment[] => [
  { type: 'move', p: [r, 0] },
  { type: 'cubic', c1: [r, r * K], c2: [r * K, r], p: [0, r] },
];

describe('subpaths', () => {
  it('splits on move and closes with a line back to the start', () => {
    const sps = subpaths(square);
    expect(sps).toHaveLength(1);
    expect(sps[0]!.closed).toBe(true);
    expect(sps[0]!.pieces).toHaveLength(4);
    expect(sps[0]!.pieces[3]).toEqual({ kind: 'line', p0: [0, 10], p1: [0, 0] });
  });

  it('does not add a zero-length closing line', () => {
    const segs: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'line', p: [5, 0] },
      { type: 'line', p: [0, 0] },
      { type: 'close' },
    ];
    expect(pieces(segs)).toHaveLength(2);
  });

  it('closes open subpaths when the vector is closed', () => {
    const open = square.slice(0, 4);
    expect(subpaths(open)[0]!.closed).toBe(false);
    expect(subpaths(open, true)[0]!.closed).toBe(true);
    expect(length(open, true)).toBeCloseTo(40);
    expect(length(open)).toBeCloseTo(30);
  });

  it('handles several subpaths', () => {
    const two = [
      ...square,
      { type: 'move', p: [20, 0] } as Segment,
      { type: 'line', p: [25, 0] } as Segment,
    ];
    expect(subpaths(two).map((s) => s.pieces.length)).toEqual([4, 1]);
  });

  it('rejects drawing before any move', () => {
    expect(() => subpaths([{ type: 'line', p: [1, 1] }])).toThrow(/before any "move"/);
  });
});

describe('bbox', () => {
  it('is undefined for an empty path', () => {
    expect(bbox([])).toBeUndefined();
  });

  it('covers a lone move point', () => {
    expect(bbox([{ type: 'move', p: [3, 4] }])).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it('uses curve extrema, not control points', () => {
    // Control points reach y = 10, the curve only y = 7.5.
    const arch: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'cubic', c1: [0, 10], c2: [10, 10], p: [10, 0] },
    ];
    const box = bbox(arch)!;
    expect(box.maxY).toBeCloseTo(7.5, 12);
    expect(box.minX).toBe(0);
    expect(box.maxX).toBe(10);
  });

  it('handles quadratic extrema', () => {
    const q: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'quad', c: [5, 10], p: [10, 0] },
    ];
    expect(bbox(q)!.maxY).toBeCloseTo(5, 12);
  });
});

describe('length', () => {
  it('is exact for lines', () => {
    expect(length(square)).toBe(40);
  });

  it('matches a quarter circle to the accuracy of the cubic approximation', () => {
    // The k-cubic deviates from the circle by < 0.03 %, so length agrees to ~1e-3.
    expect(length(quarter(100))).toBeCloseTo((Math.PI * 100) / 2, 1);
  });

  it('matches a straight cubic exactly', () => {
    const straight: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'cubic', c1: [1, 0], c2: [2, 0], p: [3, 0] },
    ];
    expect(length(straight)).toBeCloseTo(3, 10);
  });

  it('matches a parabola closed form for a quad', () => {
    // y = x² on [0, 1] as a quad: p0 (0,0), c (0.5, 0), p1 (1, 1).
    const q: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'quad', c: [0.5, 0], p: [1, 1] },
    ];
    const exact = (2 * Math.sqrt(5) + Math.asinh(2)) / 4;
    expect(length(q)).toBeCloseTo(exact, 10);
  });
});

describe('pointAt', () => {
  it('walks along lines with tangents', () => {
    expect(pointAt(square, 15)).toEqual({ point: [10, 5], tangent: [0, 1] });
    expect(pointAt(square, 35)!.point).toEqual([0, 5]);
  });

  it('clamps to the ends', () => {
    expect(pointAt(square, -5)!.point).toEqual([0, 0]);
    expect(pointAt(square, 1e9)!.point).toEqual([0, 0]);
    expect(pointAt(quarter(10), 1e9)!.point).toEqual([0, 10]);
  });

  it('finds the arc-length midpoint of a curve', () => {
    const q = quarter(100);
    const half = length(q) / 2;
    const { point, tangent } = pointAt(q, half)!;
    // By symmetry the midpoint is on the 45° line.
    expect(point[0]).toBeCloseTo(point[1], 8);
    expect(tangent[0]).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(tangent[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('is undefined for a path with no pieces', () => {
    expect(pointAt([{ type: 'move', p: [1, 1] }], 0)).toBeUndefined();
  });
});

describe('transforms', () => {
  it('composes and inverts', () => {
    const m = multiply(translation(5, -2), multiply(rotation(Math.PI / 3, 1, 1), scaling(2, 3)));
    const p = applyMatrix(m, [4, 7]);
    const back = applyMatrix(invert(m), p);
    expect(back[0]).toBeCloseTo(4, 12);
    expect(back[1]).toBeCloseTo(7, 12);
  });

  it('rotates counter-clockwise about a centre', () => {
    const p = applyMatrix(rotation(Math.PI / 2, 10, 10), [20, 10]);
    expect(p[0]).toBeCloseTo(10, 12);
    expect(p[1]).toBeCloseTo(20, 12);
  });

  it('scales about a centre', () => {
    expect(applyMatrix(scaling(2, 2, 5, 5), [6, 5])).toEqual([7, 5]);
  });

  it('transforms segments without mutating them', () => {
    const before = structuredClone(square);
    const moved = transformSegments(square, translation(1, 2));
    expect(square).toEqual(before);
    expect(bbox(moved)).toEqual({ minX: 1, minY: 2, maxX: 11, maxY: 12 });
    expect(moved.at(-1)).toEqual({ type: 'close' });
  });
});
