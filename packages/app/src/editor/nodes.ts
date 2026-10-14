import type { Segment, Vec2 } from '@naqsh/core';

/**
 * Node editing on segment lists (pure; the UI wraps results in a
 * `setVectorSegments` command so every edit is undoable).
 */

export type PointKey = 'p' | 'c' | 'c1' | 'c2';

export interface NodeRef {
  seg: number;
  key: PointKey;
}

export interface EditPoint extends NodeRef {
  point: Vec2;
  /** Anchor (on-curve) or control handle. */
  anchor: boolean;
}

/** Every editable point: anchors and Bézier control handles. */
export function editPoints(segments: readonly Segment[]): EditPoint[] {
  const out: EditPoint[] = [];
  segments.forEach((s, seg) => {
    switch (s.type) {
      case 'move':
      case 'line':
        out.push({ seg, key: 'p', point: s.p, anchor: true });
        break;
      case 'quad':
        out.push({ seg, key: 'c', point: s.c, anchor: false });
        out.push({ seg, key: 'p', point: s.p, anchor: true });
        break;
      case 'cubic':
        out.push({ seg, key: 'c1', point: s.c1, anchor: false });
        out.push({ seg, key: 'c2', point: s.c2, anchor: false });
        out.push({ seg, key: 'p', point: s.p, anchor: true });
        break;
      case 'close':
        break;
    }
  });
  return out;
}

export function pickPoint(
  points: readonly EditPoint[],
  p: Vec2,
  tol: number,
): EditPoint | undefined {
  let best: EditPoint | undefined;
  let bestD = tol;
  for (const e of points) {
    const d = Math.hypot(e.point[0] - p[0], e.point[1] - p[1]);
    // Prefer anchors on ties so a handle sitting on its anchor doesn't block it.
    if (d < bestD || (d === bestD && e.anchor)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

const add = (a: Vec2, dx: number, dy: number): [number, number] => [a[0] + dx, a[1] + dy];
const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

/** Index range [start, end) of the subpath containing segment i. */
function subpathRange(segments: readonly Segment[], i: number): [number, number] {
  let start = i;
  while (start > 0 && segments[start]?.type !== 'move') start--;
  let end = i + 1;
  while (end < segments.length && segments[end]?.type !== 'move') end++;
  return [start, end];
}

/**
 * Moves one point to `to`. Moving an anchor carries its two neighbouring
 * handles along; moving the start of a subpath whose last segment returns to
 * it moves both ends together.
 */
export function movePoint(segments: readonly Segment[], ref: NodeRef, to: Vec2): Segment[] {
  const out = segments.map((s) => ({ ...s })) as Segment[];
  const s = out[ref.seg];
  if (!s || s.type === 'close') return out;
  const set = (seg: Segment, key: PointKey, v: [number, number]) => {
    (seg as unknown as Record<PointKey, [number, number]>)[key] = v;
  };
  const old = (s as unknown as Record<PointKey, Vec2>)[ref.key];
  if (!old) return out;
  const dx = to[0] - old[0];
  const dy = to[1] - old[1];
  set(s, ref.key, [to[0], to[1]]);
  if (ref.key !== 'p') return out;

  const carry = (i: number) => {
    const here = out[i];
    if (here?.type === 'cubic') here.c2 = add(here.c2, dx, dy);
    const next = out[i + 1];
    if (next?.type === 'cubic') next.c1 = add(next.c1, dx, dy);
  };
  carry(ref.seg);

  const [start, end] = subpathRange(out, ref.seg);
  let last = end - 1;
  if (out[last]?.type === 'close') last--;
  if (ref.seg === start && last > start) {
    const tail = out[last] as Segment;
    if (tail.type !== 'close' && tail.type !== 'move' && same(tail.p, old)) {
      tail.p = [to[0], to[1]];
      if (tail.type === 'cubic') tail.c2 = add(tail.c2, dx, dy);
    }
  } else if (ref.seg === last && out[start]?.type === 'move') {
    const head = out[start] as Extract<Segment, { type: 'move' }>;
    if (same(head.p, old) && out[end - 1]?.type === 'close') {
      head.p = [to[0], to[1]];
      const first = out[start + 1];
      if (first?.type === 'cubic') first.c1 = add(first.c1, dx, dy);
    }
  }
  return out;
}

/** Number of anchors in the subpath containing segment i. */
function anchorsIn(segments: readonly Segment[], i: number): number {
  const [start, end] = subpathRange(segments, i);
  return segments.slice(start, end).filter((s) => s.type !== 'close').length;
}

/**
 * Deletes the anchor at segment i. Returns undefined when the subpath would
 * drop below two anchors.
 */
export function deleteNode(segments: readonly Segment[], i: number): Segment[] | undefined {
  const s = segments[i];
  if (!s || s.type === 'close' || anchorsIn(segments, i) <= 2) return undefined;
  const out = segments.map((x) => ({ ...x })) as Segment[];
  if (s.type === 'move') {
    const next = out[i + 1];
    if (!next || next.type === 'close' || next.type === 'move') return undefined;
    out.splice(i, 2, { type: 'move', p: next.p });
    return out;
  }
  out.splice(i, 1);
  return out;
}

const lerp = (a: Vec2, b: Vec2, t: number): [number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** Start point of segment i (the previous anchor). */
function startOf(segments: readonly Segment[], i: number): Vec2 | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const s = segments[j] as Segment;
    if (s.type !== 'close') return s.p;
    // After a close the pen is at the subpath start.
    const [start] = subpathRange(segments, j);
    const m = segments[start];
    return m && m.type !== 'close' ? m.p : undefined;
  }
  return undefined;
}

/** Splits drawing segment i at parameter t, inserting a new anchor. */
export function splitSegment(segments: readonly Segment[], i: number, t = 0.5): Segment[] {
  const s = segments[i];
  const p0 = startOf(segments, i);
  if (!s || !p0 || s.type === 'move' || s.type === 'close') return [...segments];
  const out = [...segments];
  if (s.type === 'line') {
    out.splice(i, 1, { type: 'line', p: lerp(p0, s.p, t) }, s);
  } else if (s.type === 'quad') {
    const a = lerp(p0, s.c, t);
    const b = lerp(s.c, s.p, t);
    const m = lerp(a, b, t);
    out.splice(i, 1, { type: 'quad', c: a, p: m }, { type: 'quad', c: b, p: s.p });
  } else {
    const ab = lerp(p0, s.c1, t);
    const bc = lerp(s.c1, s.c2, t);
    const cd = lerp(s.c2, s.p, t);
    const abc = lerp(ab, bc, t);
    const bcd = lerp(bc, cd, t);
    const m = lerp(abc, bcd, t);
    out.splice(
      i,
      1,
      { type: 'cubic', c1: ab, c2: abc, p: m },
      { type: 'cubic', c1: bcd, c2: cd, p: s.p },
    );
  }
  return out;
}

/** Converts a line segment to an equivalent cubic (handles at thirds), or a curve to a line. */
export function toggleCurve(segments: readonly Segment[], i: number): Segment[] {
  const s = segments[i];
  const p0 = startOf(segments, i);
  if (!s || !p0) return [...segments];
  const out = [...segments];
  if (s.type === 'line') {
    out[i] = { type: 'cubic', c1: lerp(p0, s.p, 1 / 3), c2: lerp(p0, s.p, 2 / 3), p: s.p };
  } else if (s.type === 'quad' || s.type === 'cubic') {
    out[i] = { type: 'line', p: s.p };
  }
  return out;
}

// --- Pen tool ---------------------------------------------------------------

export interface PenNode {
  p: Vec2;
  /** Outgoing handle (absolute); the incoming one mirrors it. Undefined = sharp corner. */
  out?: Vec2;
}

/** Builds segments from pen nodes; closes back to the first node when `closed`. */
export function penSegments(nodes: readonly PenNode[], closed: boolean): Segment[] {
  const first = nodes[0];
  if (!first) return [];
  const segs: Segment[] = [{ type: 'move', p: [first.p[0], first.p[1]] }];
  const edge = (a: PenNode, b: PenNode) => {
    const inB: Vec2 | undefined = b.out
      ? [2 * b.p[0] - b.out[0], 2 * b.p[1] - b.out[1]]
      : undefined;
    if (!a.out && !inB) segs.push({ type: 'line', p: [b.p[0], b.p[1]] });
    else
      segs.push({
        type: 'cubic',
        c1: a.out ? [a.out[0], a.out[1]] : [a.p[0], a.p[1]],
        c2: inB ? [inB[0], inB[1]] : [b.p[0], b.p[1]],
        p: [b.p[0], b.p[1]],
      });
  };
  for (let i = 1; i < nodes.length; i++) edge(nodes[i - 1] as PenNode, nodes[i] as PenNode);
  if (closed && nodes.length > 2) {
    edge(nodes.at(-1) as PenNode, first);
    segs.push({ type: 'close' });
  }
  return segs;
}
