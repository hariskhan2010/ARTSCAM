import { applyMatrix, bbox, ellipse, rectangle, type Segment } from '@naqsh/core';
import { describe, expect, it } from 'vitest';
import {
  fitView,
  gridStep,
  handleTransform,
  hitVector,
  marqueeSelect,
  pickHandle,
  pickVector,
  screenToWorld,
  snap,
  worldToScreen,
  zoomAt,
  type View,
} from './geometry';
import { deleteNode, editPoints, movePoint, penSegments, splitSegment, toggleCurve } from './nodes';

const view: View = { scale: 2, originX: 100, originY: 500 };
const box = { minX: 0, minY: 0, maxX: 10, maxY: 20 };

describe('view', () => {
  it('maps world ↔ screen with Y up', () => {
    expect(worldToScreen(view, [10, 10])).toEqual([120, 480]);
    expect(screenToWorld(view, [120, 480])).toEqual([10, 10]);
  });

  it('zooms about the cursor', () => {
    const z = zoomAt(view, [300, 200], 3);
    expect(z.scale).toBe(6);
    const before = screenToWorld(view, [300, 200]);
    const after = screenToWorld(z, [300, 200]);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it('fits a box', () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 300, maxY: 200 }, 800, 600, 50);
    expect(v.scale).toBeCloseTo(700 / 300, 9);
    const c = worldToScreen(v, [150, 100]);
    expect(c[0]).toBeCloseTo(400, 9);
    expect(c[1]).toBeCloseTo(300, 9);
  });

  it('picks nice grid steps', () => {
    expect(gridStep(1)).toBe(20);
    expect(gridStep(10)).toBe(2);
    expect(gridStep(100)).toBeCloseTo(0.2, 12);
  });
});

describe('snap', () => {
  const opts = { grid: true, gridSize: 5, points: [[11, 11]] as [number, number][], radius: 1 };

  it('prefers points within radius', () => {
    expect(snap([10.5, 10.4], opts)).toEqual({ point: [11, 11], kind: 'point' });
  });

  it('locks an axis to a grid line only when close to it', () => {
    expect(snap([5.6, 2.6], opts)).toEqual({ point: [5, 2.5], kind: 'grid' });
  });

  it('otherwise rounds to a tenth of the grid step, without jumping', () => {
    expect(snap([7.4, 2.63], opts)).toEqual({ point: [7.5, 2.5], kind: 'none' });
    expect(snap([7.4, 2.6], { ...opts, grid: false })).toEqual({ point: [7.4, 2.6], kind: 'none' });
  });
});

describe('hit testing', () => {
  const sq = { id: 'a', closed: true, segments: rectangle(0, 0, 10, 10) };
  const open = { id: 'b', closed: false, segments: rectangle(20, 0, 10, 10).slice(0, 3) };

  it('hits outline and inside of closed vectors, outline only of open ones', () => {
    expect(hitVector(sq, [5, 5], 0.5)).toBe(true);
    expect(hitVector(sq, [10.3, 5], 0.5)).toBe(true);
    expect(hitVector(sq, [12, 5], 0.5)).toBe(false);
    expect(hitVector(open, [25, 5], 0.5)).toBe(false);
    expect(hitVector(open, [30, 5], 0.5)).toBe(true);
  });

  it('a hole is not inside', () => {
    const ring = {
      closed: true,
      segments: [...rectangle(0, 0, 30, 30), ...rectangle(10, 10, 10, 10)] as Segment[],
    };
    expect(hitVector(ring, [15, 15], 0.1)).toBe(false);
    expect(hitVector(ring, [5, 5], 0.1)).toBe(true);
  });

  it('picks the topmost', () => {
    const top = { id: 'c', closed: true, segments: ellipse(5, 5, 3) };
    expect(pickVector([sq, top], [5, 5], 0.1)?.id).toBe('c');
  });

  it('marquee selects fully enclosed vectors', () => {
    expect(marqueeSelect([sq, open], { minX: -1, minY: -1, maxX: 11, maxY: 11 })).toEqual(['a']);
  });
});

describe('handles', () => {
  it('finds handles', () => {
    expect(pickHandle(box, [10.1, 20], 0.5, 5)).toBe('ne');
    expect(pickHandle(box, [5, 25], 0.5, 5)).toBe('rotate');
    expect(pickHandle(box, [5, 5], 0.5, 5)).toBeUndefined();
  });

  it('scales from the opposite corner', () => {
    const m = handleTransform(box, 'ne', [10, 20], [20, 30]);
    expect(applyMatrix(m, [0, 0])).toEqual([0, 0]);
    expect(applyMatrix(m, [10, 20])).toEqual([20, 30]);
  });

  it('keeps aspect ratio when uniform', () => {
    const m = handleTransform(box, 'e', [10, 10], [20, 10], { uniform: true });
    expect(m[0]).toBe(2);
    expect(m[3]).toBe(2);
  });

  it('rotates about the centre with 15° snapping', () => {
    const m = handleTransform(box, 'rotate', [5, 25], [-1, 16], { snapAngle: true });
    const angle = Math.atan2(m[1], m[0]);
    expect(Math.round((angle * 180) / Math.PI) % 15).toBe(0);
    const c = applyMatrix(m, [5, 10]);
    expect(c[0]).toBeCloseTo(5, 9);
    expect(c[1]).toBeCloseTo(10, 9);
  });
});

describe('node editing', () => {
  const sq = rectangle(0, 0, 10, 10);

  it('lists anchors and handles', () => {
    const pts = editPoints(ellipse(0, 0, 5));
    expect(pts.filter((p) => p.anchor)).toHaveLength(5);
    expect(pts.filter((p) => !p.anchor)).toHaveLength(8);
  });

  it('moves an anchor with its handles', () => {
    const segs: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'cubic', c1: [1, 1], c2: [2, 1], p: [3, 0] },
      { type: 'cubic', c1: [4, -1], c2: [5, -1], p: [6, 0] },
    ];
    const out = movePoint(segs, { seg: 1, key: 'p' }, [3, 2]);
    expect(out[1]).toEqual({ type: 'cubic', c1: [1, 1], c2: [2, 3], p: [3, 2] });
    expect(out[2]).toMatchObject({ c1: [4, 1] });
    expect(segs[1]).toMatchObject({ p: [3, 0] }); // not mutated
  });

  it('moves both ends of a curve-closed subpath together', () => {
    const e = ellipse(0, 0, 5);
    const out = movePoint(e, { seg: 0, key: 'p' }, [6, 0]);
    expect(out[0]).toEqual({ type: 'move', p: [6, 0] });
    expect(out.at(-2)).toMatchObject({ p: [6, 0] });
  });

  it('deletes nodes but keeps at least two', () => {
    const tri: Segment[] = [
      { type: 'move', p: [0, 0] },
      { type: 'line', p: [1, 0] },
      { type: 'line', p: [0, 1] },
      { type: 'close' },
    ];
    expect(deleteNode(tri, 1)).toEqual([
      { type: 'move', p: [0, 0] },
      { type: 'line', p: [0, 1] },
      { type: 'close' },
    ]);
    expect(deleteNode(deleteNode(tri, 1)!, 1)).toBeUndefined();
    expect(deleteNode(sq, 0)![0]).toEqual({ type: 'move', p: [10, 0] });
  });

  it('splits a segment without changing the shape', () => {
    const out = splitSegment(sq, 1, 0.5);
    expect(out[1]).toEqual({ type: 'line', p: [5, 0] });
    expect(bbox(out)).toEqual(bbox(sq));
    const curve = splitSegment(ellipse(0, 0, 5), 1, 0.5);
    expect(curve).toHaveLength(7);
    expect(bbox(curve)!.maxX).toBeCloseTo(5, 9);
  });

  it('toggles a line to an equivalent curve and back', () => {
    const c = toggleCurve(sq, 1);
    expect(c[1]).toMatchObject({ type: 'cubic', p: [10, 0] });
    expect(toggleCurve(c, 1)[1]).toEqual({ type: 'line', p: [10, 0] });
  });
});

describe('pen', () => {
  it('builds lines for corner nodes and cubics for smooth ones, closing on request', () => {
    const segs = penSegments([{ p: [0, 0] }, { p: [10, 0], out: [12, 2] }, { p: [10, 10] }], true);
    expect(segs.map((s) => s.type)).toEqual(['move', 'cubic', 'cubic', 'line', 'close']);
    expect(segs[1]).toEqual({ type: 'cubic', c1: [0, 0], c2: [8, -2], p: [10, 0] });
    expect(penSegments([{ p: [0, 0] }, { p: [1, 1] }], false)).toHaveLength(2);
  });
});
