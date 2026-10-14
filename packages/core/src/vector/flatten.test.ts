import { describe, expect, it } from 'vitest';
import type { Segment } from '../model/schema';
import { distToSegment, flatten, polylineLength, signedArea } from './flatten';
import { evalPiece, length, pieces, type Vec2 } from './path';

/** Max distance from densely sampled curve points to the polyline. */
function maxDeviation(segments: Segment[], poly: readonly Vec2[], closed: boolean): number {
  let worst = 0;
  for (const piece of pieces(segments, closed)) {
    for (let i = 0; i <= 2000; i++) {
      const p = evalPiece(piece, i / 2000);
      let best = Infinity;
      const n = closed ? poly.length : poly.length - 1;
      for (let j = 0; j < n; j++) {
        best = Math.min(best, distToSegment(p, poly[j]!, poly[(j + 1) % poly.length]!));
      }
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

const curves: Record<string, Segment[]> = {
  arch: [
    { type: 'move', p: [0, 0] },
    { type: 'cubic', c1: [0, 50], c2: [100, 50], p: [100, 0] },
  ],
  sCurve: [
    { type: 'move', p: [0, 0] },
    { type: 'cubic', c1: [80, 0], c2: [-30, 60], p: [50, 60] },
  ],
  cusp: [
    { type: 'move', p: [0, 0] },
    { type: 'cubic', c1: [100, 100], c2: [0, 100], p: [100, 0] },
  ],
  quad: [
    { type: 'move', p: [0, 0] },
    { type: 'quad', c: [40, 90], p: [80, 0] },
  ],
};

describe('flatten', () => {
  for (const [name, segs] of Object.entries(curves)) {
    for (const tol of [1, 0.1, 0.01, 0.001]) {
      it(`${name}: deviation ≤ ${tol}`, () => {
        const [poly] = flatten(segs, tol);
        expect(maxDeviation(segs, poly!.points, false)).toBeLessThanOrEqual(tol + 1e-9);
      });
    }
  }

  it('uses more points for a tighter tolerance', () => {
    const coarse = flatten(curves.arch!, 1)[0]!.points.length;
    const fine = flatten(curves.arch!, 0.001)[0]!.points.length;
    expect(fine).toBeGreaterThan(coarse * 4);
  });

  it('keeps lines as single segments and starts/ends exactly on the curve', () => {
    const segs: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'line', p: [10, 0] },
      { type: 'cubic', c1: [15, 0], c2: [15, 10], p: [10, 10] },
    ];
    const pts = flatten(segs, 0.01)[0]!.points;
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([10, 0]);
    expect(pts.at(-1)).toEqual([10, 10]);
  });

  it('does not repeat the start point of a closed path', () => {
    const square: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'line', p: [10, 0] },
      { type: 'line', p: [10, 10] },
      { type: 'line', p: [0, 10] },
      { type: 'close' },
    ];
    const [poly] = flatten(square);
    expect(poly).toEqual({
      closed: true,
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    });
    expect(signedArea(poly!.points)).toBe(100);
    expect(polylineLength(poly!.points, true)).toBe(40);
  });

  it('approaches the true length as tolerance shrinks', () => {
    const segs = curves.sCurve!;
    const exact = length(segs);
    const approx = polylineLength(flatten(segs, 0.0001)[0]!.points, false);
    expect(approx).toBeLessThanOrEqual(exact + 1e-9);
    expect(exact - approx).toBeLessThan(1e-3);
  });

  it('closed circle stays within tolerance including the closing edge', () => {
    const K = (4 / 3) * (Math.SQRT2 - 1) * 50;
    const circle: Segment[] = [
      { type: 'move', p: [50, 0] },
      { type: 'cubic', c1: [50, K], c2: [K, 50], p: [0, 50] },
      { type: 'cubic', c1: [-K, 50], c2: [-50, K], p: [-50, 0] },
      { type: 'cubic', c1: [-50, -K], c2: [-K, -50], p: [0, -50] },
      { type: 'cubic', c1: [K, -50], c2: [50, -K], p: [50, 0] },
      { type: 'close' },
    ];
    const [poly] = flatten(circle, 0.05);
    expect(maxDeviation(circle, poly!.points, true)).toBeLessThanOrEqual(0.05);
    expect(signedArea(poly!.points)).toBeGreaterThan(0); // CCW
  });

  it('rejects a non-positive tolerance', () => {
    expect(() => flatten(curves.arch!, 0)).toThrow(RangeError);
  });
});
