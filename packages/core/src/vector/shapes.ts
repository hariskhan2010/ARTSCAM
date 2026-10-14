import type { Segment } from '../model/schema';
import type { Vec2 } from './path';

/**
 * Shape builders (plan.md T1.5): rectangle, ellipse, polygon, star, line, and
 * circular/elliptical arcs as cubic Béziers. Every closed shape is
 * counter-clockwise (Y up) and ends with `close`. All values are mm.
 */

/** Cubic control-point factor for a circular arc of `sweep` radians: 4/3·tan(θ/4). */
const arcK = (sweep: number) => (4 / 3) * Math.tan(sweep / 4);

/**
 * Cubic segments for an elliptical arc centred at (cx, cy) with radii rx, ry,
 * x-axis rotation `phi`, from angle `start` sweeping `sweep` radians
 * (positive = counter-clockwise). Pieces span at most 90°, which keeps the
 * radial error under 0.03 % of the radius. The arc's start point is not
 * emitted: the caller is already there.
 */
export function arcToCubics(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  phi: number,
  start: number,
  sweep: number,
): Segment[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / n;
  const k = arcK(step);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const map = (ux: number, uy: number): [number, number] => [
    cx + rx * ux * cos - ry * uy * sin,
    cy + rx * ux * sin + ry * uy * cos,
  ];
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = start + i * step;
    const a1 = a0 + step;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    out.push({
      type: 'cubic',
      c1: map(c0 - k * s0, s0 + k * c0),
      c2: map(c1 + k * s1, s1 - k * c1),
      p: map(c1, s1),
    });
  }
  return out;
}

/** Axis-aligned rectangle from corner (x, y), optionally with corner radius. */
export function rectangle(x: number, y: number, w: number, h: number, radius = 0): Segment[] {
  const x0 = Math.min(x, x + w);
  const y0 = Math.min(y, y + h);
  const W = Math.abs(w);
  const H = Math.abs(h);
  const r = Math.max(0, Math.min(radius, W / 2, H / 2));
  if (r === 0) {
    return [
      { type: 'move', p: [x0, y0] },
      { type: 'line', p: [x0 + W, y0] },
      { type: 'line', p: [x0 + W, y0 + H] },
      { type: 'line', p: [x0, y0 + H] },
      { type: 'close' },
    ];
  }
  const q = Math.PI / 2;
  const segs: Segment[] = [{ type: 'move', p: [x0 + r, y0] }];
  const edge = (p: Vec2) => segs.push({ type: 'line', p: [p[0], p[1]] });
  edge([x0 + W - r, y0]);
  segs.push(...arcToCubics(x0 + W - r, y0 + r, r, r, 0, -q, q));
  edge([x0 + W, y0 + H - r]);
  segs.push(...arcToCubics(x0 + W - r, y0 + H - r, r, r, 0, 0, q));
  edge([x0 + r, y0 + H]);
  segs.push(...arcToCubics(x0 + r, y0 + H - r, r, r, 0, q, q));
  edge([x0, y0 + r]);
  segs.push(...arcToCubics(x0 + r, y0 + r, r, r, 0, 2 * q, q));
  segs.push({ type: 'close' });
  // Drop zero-length edges (r equal to half a side).
  return segs.filter((s, i) => {
    if (s.type !== 'line' || i === 0) return true;
    const prev = segs[i - 1] as Segment;
    return !('p' in prev && prev.p[0] === s.p[0] && prev.p[1] === s.p[1]);
  });
}

/** Ellipse (circle when ry is omitted) centred at (cx, cy), rotated by `rotation` radians. */
export function ellipse(cx: number, cy: number, rx: number, ry = rx, rotation = 0): Segment[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    { type: 'move', p: [cx + rx * cos, cy + rx * sin] },
    ...arcToCubics(cx, cy, rx, ry, rotation, 0, 2 * Math.PI),
    { type: 'close' },
  ];
}

function closedPolyline(points: Vec2[]): Segment[] {
  const [first, ...rest] = points;
  if (!first) return [];
  return [
    { type: 'move', p: [first[0], first[1]] },
    ...rest.map((p): Segment => ({ type: 'line', p: [p[0], p[1]] })),
    { type: 'close' },
  ];
}

/**
 * Regular polygon with `sides` corners on a circle of `radius`; the first
 * corner is at angle `rotation` (radians, 0 = +X; default points up).
 */
export function polygon(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = Math.PI / 2,
): Segment[] {
  if (!Number.isInteger(sides) || sides < 3) throw new RangeError('sides must be an integer ≥ 3');
  return closedPolyline(
    Array.from({ length: sides }, (_, i): Vec2 => {
      const a = rotation + (2 * Math.PI * i) / sides;
      return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
    }),
  );
}

/** Star with `points` tips on `outer` radius and notches on `inner` radius. */
export function star(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  rotation = Math.PI / 2,
): Segment[] {
  if (!Number.isInteger(points) || points < 2)
    throw new RangeError('points must be an integer ≥ 2');
  return closedPolyline(
    Array.from({ length: points * 2 }, (_, i): Vec2 => {
      const r = i % 2 === 0 ? outer : inner;
      const a = rotation + (Math.PI * i) / points;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
  );
}

/** Open straight line. */
export function line(a: Vec2, b: Vec2): Segment[] {
  return [
    { type: 'move', p: [a[0], a[1]] },
    { type: 'line', p: [b[0], b[1]] },
  ];
}
