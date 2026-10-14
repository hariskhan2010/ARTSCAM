import type { Vec2 } from '../vector/path';
import type { CamMove, Vec3 } from './types';

/**
 * Emits safe move sequences. Travel always goes up to safe Z before moving in
 * XY, comes down by rapid only to just above the stock top, and enters
 * material by feed (plan.md §7): the generators cannot produce the unsafe
 * patterns the checker looks for, and the checker still verifies the text.
 */

/** Rapid approach stops this far above the stock top; the rest is fed. */
export const APPROACH_CLEARANCE = 1;

export class PathBuilder {
  readonly moves: CamMove[] = [];
  #pos: [number, number, number] | undefined;

  constructor(
    readonly safeZ: number,
    readonly topZ: number,
    /** Added to every XY (world → work coordinates). */
    readonly offset: Vec2 = [0, 0],
  ) {}

  get position(): Vec3 | undefined {
    return this.#pos;
  }

  /** Current XY in world coordinates. */
  get xy(): Vec2 | undefined {
    return this.#pos && [this.#pos[0] - this.offset[0], this.#pos[1] - this.offset[1]];
  }

  get z(): number | undefined {
    return this.#pos?.[2];
  }

  #push(kind: 'rapid' | 'plunge' | 'cut', x: number, y: number, z: number) {
    const p = this.#pos;
    if (p && p[0] === x && p[1] === y && p[2] === z) return;
    this.moves.push({ kind, to: [x, y, z] });
    this.#pos = [x, y, z];
  }

  /** Straight up to safe Z (no-op if already at or above it). */
  retract(): void {
    if (!this.#pos) return;
    if (this.#pos[2] < this.safeZ) this.#push('rapid', this.#pos[0], this.#pos[1], this.safeZ);
  }

  /** Rapid straight up to z (ignored if not above the current height). */
  rapidUp(z: number): void {
    const p = this.#pos;
    if (p && z > p[2]) this.#push('rapid', p[0], p[1], z);
  }

  /**
   * Goes to world point p ready to cut: retract, rapid in XY at safe Z, rapid
   * down to just above the stock (or to `z` if that is higher).
   */
  travelTo(p: Vec2, z = this.topZ + APPROACH_CLEARANCE): void {
    const x = p[0] + this.offset[0];
    const y = p[1] + this.offset[1];
    // Before the first move the post-processor's header has already raised Z
    // to safe height, so there is nothing to retract from.
    if (this.#pos) {
      const here = this.#pos[0] === x && this.#pos[1] === y;
      if (here && this.#pos[2] <= Math.max(z, this.topZ)) return; // already in place
      this.retract();
    }
    this.#push('rapid', x, y, this.safeZ);
    const down = Math.max(z, this.topZ);
    if (down < this.safeZ) this.#push('rapid', x, y, down);
  }

  /** Feed straight down (or up) to z at the current XY. */
  plungeTo(z: number): void {
    const p = this.#pos;
    if (!p) throw new Error('plungeTo before travelTo');
    this.#push(z < p[2] ? 'plunge' : 'cut', p[0], p[1], z);
  }

  /** Feed to world XY at height z. Pure Z drops use the plunge rate. */
  cutTo(p: Vec2, z: number): void {
    const x = p[0] + this.offset[0];
    const y = p[1] + this.offset[1];
    const cur = this.#pos;
    if (!cur) throw new Error('cutTo before travelTo');
    const vertical = cur[0] === x && cur[1] === y;
    this.#push(vertical && z < cur[2] ? 'plunge' : 'cut', x, y, z);
  }

  dwell(seconds: number): void {
    this.moves.push({ kind: 'dwell', seconds });
  }

  /** Finish: back to safe Z. */
  end(): CamMove[] {
    this.retract();
    return this.moves;
  }
}

/** Evenly spaced pass depths (absolute Z), top-down, ending exactly at `bottom`. */
export function passDepths(top: number, depth: number, stepDown: number): number[] {
  const n = Math.max(1, Math.ceil(depth / stepDown - 1e-9));
  return Array.from({ length: n }, (_, k) =>
    k === n - 1 ? top - depth : top - (depth * (k + 1)) / n,
  );
}

export interface ContourOptions {
  /** Ramp length (mm) along the contour from the previous depth; closed contours only. */
  ramp?: number;
  /** Tab spans as [start, end] distances along the contour, and the Z of tab tops. */
  tabs?: { spans: [number, number][]; topZ: number };
  /** Also re-cut the first `ramp` mm at full depth (last pass). */
  cleanup?: boolean;
}

/** Cumulative distances along a polyline; closed adds the closing edge. */
export function cumulative(points: readonly Vec2[], closed: boolean): number[] {
  const out = [0];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    out.push((out[i] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
}

/** Point at distance s along the polyline (wrapping for closed). */
export function pointAtDistance(
  points: readonly Vec2[],
  cum: readonly number[],
  closed: boolean,
  s: number,
): Vec2 {
  const L = cum.at(-1) as number;
  if (closed && L > 0) s = ((s % L) + L) % L;
  s = Math.max(0, Math.min(L, s));
  let i = 0;
  while (i < cum.length - 2 && (cum[i + 1] as number) < s) i++;
  const a = points[i] as Vec2;
  const b = points[(i + 1) % points.length] as Vec2;
  const seg = (cum[i + 1] as number) - (cum[i] as number);
  const t = seg > 0 ? (s - (cum[i] as number)) / seg : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Cuts one pass along a contour that starts at the builder's position
 * (points[0], at height `zFrom`), ending back at points[0] for closed
 * contours (or at points[ramp] when cleaning up a ramp), at points.at(-1) for
 * open ones. Ramps descend linearly from zFrom to z over the first `ramp` mm;
 * inside tab spans the tool rides at the tab top.
 */
export function cutContour(
  b: PathBuilder,
  points: readonly Vec2[],
  closed: boolean,
  zFrom: number,
  z: number,
  options: ContourOptions = {},
): void {
  const cum = cumulative(points, closed);
  const L = cum.at(-1) as number;
  const ramp = closed && options.ramp ? Math.min(options.ramp, L) : 0;
  const end = L + (options.cleanup ? ramp : 0);
  const tabs = options.tabs && options.tabs.topZ > z ? options.tabs : undefined;

  const inTab = (s: number) => {
    if (!tabs) return false;
    const u = closed && L > 0 ? ((s % L) + L) % L : s;
    return tabs.spans.some(([a, c]) => u > a && u < c);
  };
  const base = (s: number) => (ramp > 0 && s < ramp ? zFrom + ((z - zFrom) * s) / ramp : z);
  /** Height at s, using tab membership just before (side -1) or after (+1) s. */
  const zAt = (s: number, side: -1 | 1) =>
    tabs && inTab(s + side * 1e-7) ? Math.max(base(s), tabs.topZ) : base(s);

  // Breakpoints: vertices (and their repeats past L), ramp end, tab edges.
  const marks = new Set<number>();
  for (const c of cum) {
    marks.add(c);
    if (options.cleanup && c + L <= end) marks.add(c + L);
  }
  if (ramp > 0) marks.add(ramp);
  for (const [a, c] of tabs?.spans ?? []) {
    for (const s of [a, c, a + L, c + L]) if (s > 0 && s < end) marks.add(s);
  }
  const sorted = [...marks].filter((s) => s > 0 && s <= end + 1e-12).sort((x, y) => x - y);

  // Entering at the start: drop to the start height (a tab never covers s = 0).
  if (ramp === 0) b.plungeTo(zAt(0, 1));
  for (const s of sorted) {
    const p = pointAtDistance(points, cum, closed, s);
    const zl = zAt(s, -1);
    b.cutTo(p, zl);
    const zr = s < end ? zAt(s, 1) : zl;
    if (Math.abs(zr - zl) > 1e-9) b.cutTo(p, zr);
  }
}

/**
 * Tab spans for a closed contour of length L: `count` tabs, centred at
 * (i + ½)·L/count, each `width + toolDiameter` long so `width` of material
 * remains. Returns [] when tabs would cover the whole contour.
 */
export function tabSpans(
  L: number,
  count: number,
  width: number,
  toolDiameter: number,
): [number, number][] {
  if (count <= 0 || L <= 0) return [];
  const span = width + toolDiameter;
  if (span * count >= L * 0.9) return [];
  return Array.from({ length: count }, (_, i) => {
    const c = ((i + 0.5) * L) / count;
    return [c - span / 2, c + span / 2] as [number, number];
  });
}
