import { describe, expect, it } from 'vitest';
import { normalize, regionArea } from './clip';
import { flatten, signedArea } from './flatten';
import type { Segment } from '../model/schema';
import type { Vec2 } from './path';
import { traceBitmap, type TraceOptions } from './trace';

/**
 * Synthesised grayscale image (row 0 at the top): dark (0) where `inside`
 * covers the pixel, white (255) elsewhere, anti-aliased by 4×4 supersampling.
 * `inside` takes image pixel coordinates (x right, y down).
 */
function image(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const px = new Uint8Array(w * h);
  const n = 4;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let hits = 0;
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) if (inside(i + (a + 0.5) / n, j + (b + 0.5) / n)) hits++;
      }
      px[j * w + i] = Math.round(255 * (1 - hits / (n * n)));
    }
  }
  return px;
}

const disc = (cx: number, cy: number, r: number) => (x: number, y: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const box = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;

const opts = (o: Partial<TraceOptions> = {}): TraceOptions => ({
  threshold: 128,
  pixelSize: 1,
  origin: [0, 0],
  ...o,
});

/** Closed rings of a traced vector (curves flattened finely). */
const rings = (segs: readonly Segment[]): Vec2[][] =>
  flatten(segs, 0.005, true).map((p) => p.points as Vec2[]);

/** Distance from p to the outline of an axis-aligned box. */
function distToBox(p: Vec2, x0: number, y0: number, x1: number, y1: number): number {
  const [x, y] = p;
  const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (inside) return Math.min(x - x0, x1 - x, y - y0, y1 - y);
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

describe('traceBitmap', () => {
  const W = 64;
  const H = 64;
  const circle = image(W, H, disc(32, 30, 20));
  // Image y = 30 from the top is mm y = 64 − 30 = 34 (Y up).
  const centre: Vec2 = [32, 34];

  for (const smooth of [0, 0.5, 1]) {
    it(`traces a filled circle within one pixel of its edge (smooth ${smooth})`, () => {
      const segs = traceBitmap(circle, W, H, opts({ smooth }));
      const rs = rings(segs);
      expect(rs).toHaveLength(1);
      const area = regionArea(rs);
      expect(area).toBeGreaterThan(0); // outer ring counter-clockwise
      expect(Math.abs(area - Math.PI * 400) / (Math.PI * 400)).toBeLessThan(0.02);
      for (const p of rs[0] as Vec2[]) {
        expect(Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - 20)).toBeLessThan(1);
      }
      if (smooth > 0) expect(segs.some((s) => s.type === 'cubic')).toBe(true);
      else expect(segs.every((s) => s.type !== 'cubic' && s.type !== 'quad')).toBe(true);
    });
  }

  it('simplifies straight edges to few points', () => {
    const segs = traceBitmap(image(W, H, box(10, 10, 54, 40)), W, H, opts());
    // Four sides plus at most a short corner cut each.
    expect(segs.filter((s) => s.type === 'line' || s.type === 'move').length).toBeLessThanOrEqual(
      8,
    );
  });

  it('traces a square with a square hole as an outer ring and a hole', () => {
    const inSquare = box(10, 10, 54, 54);
    const inHole = box(24, 24, 40, 40);
    const px = image(W, H, (x, y) => inSquare(x, y) && !inHole(x, y));
    const rs = rings(traceBitmap(px, W, H, opts()));
    expect(rs).toHaveLength(2);
    const areas = rs.map(signedArea).sort((a, b) => a - b);
    expect(areas[0]).toBeLessThan(0); // hole clockwise
    expect(areas[1]).toBeGreaterThan(0);
    const want = 44 * 44 - 16 * 16;
    expect(Math.abs(regionArea(rs) - want) / want).toBeLessThan(0.02);
    // mm y = 64 − image y, so both boxes map to themselves flipped.
    for (const ring of rs) {
      for (const p of ring) {
        const d = Math.min(distToBox(p, 10, 10, 54, 54), distToBox(p, 24, 24, 40, 40));
        expect(d).toBeLessThan(1);
      }
    }
    // Already a valid region: normalising changes nothing.
    const norm = normalize(rs, 'evenOdd');
    expect(norm).toHaveLength(2);
    expect(regionArea(norm)).toBeCloseTo(regionArea(rs), 1);
    expect(regionArea(normalize(rs, 'nonZero'))).toBeCloseTo(regionArea(rs), 1);
  });

  it('traces two blobs as two outer rings of one vector', () => {
    const a = disc(16, 16, 10);
    const b = disc(46, 46, 12);
    const segs = traceBitmap(
      image(W, H, (x, y) => a(x, y) || b(x, y)),
      W,
      H,
      opts(),
    );
    const rs = rings(segs);
    expect(segs.filter((s) => s.type === 'move')).toHaveLength(2);
    expect(rs.every((r) => signedArea(r) > 0)).toBe(true);
    const want = Math.PI * (100 + 144);
    expect(Math.abs(regionArea(rs) - want) / want).toBeLessThan(0.03);
  });

  it('drops specks smaller than turdSize pixels', () => {
    const blob = disc(20, 20, 10);
    const speck = box(50, 50, 52, 52); // 2 × 2 px
    const px = image(W, H, (x, y) => blob(x, y) || speck(x, y));
    expect(rings(traceBitmap(px, W, H, opts({ turdSize: 10 })))).toHaveLength(1);
    expect(rings(traceBitmap(px, W, H, opts({ turdSize: 0 })))).toHaveLength(2);
  });

  it('invert traces the bright parts instead', () => {
    const light = image(W, H, (x, y) => !disc(32, 30, 20)(x, y)); // white disc on black
    const inv = rings(traceBitmap(light, W, H, opts({ invert: true })));
    expect(inv).toHaveLength(1);
    expect(Math.abs(regionArea(inv) - Math.PI * 400) / (Math.PI * 400)).toBeLessThan(0.02);
    // Not inverted: the dark surround, i.e. the image outline with a round hole.
    const dark = rings(traceBitmap(light, W, H, opts()));
    expect(dark).toHaveLength(2);
    const want = W * H - Math.PI * 400;
    expect(Math.abs(regionArea(dark) - want) / want).toBeLessThan(0.02);
  });

  it('a fully dark image traces to its own outline; a blank one to nothing', () => {
    const full = rings(traceBitmap(new Uint8Array(20 * 10), 20, 10, opts()));
    expect(full).toHaveLength(1);
    expect(Math.abs(regionArea(full) - 200)).toBeLessThan(0.6); // corners cut by ⅛ px² each
    expect(traceBitmap(new Uint8Array(20 * 10).fill(255), 20, 10, opts())).toEqual([]);
  });

  it('scales by pixelSize and places the bottom-left corner at origin', () => {
    const segs = traceBitmap(circle, W, H, opts({ pixelSize: 0.5, origin: [10, 20] }));
    const rs = rings(segs);
    const c: Vec2 = [10 + 32 * 0.5, 20 + 34 * 0.5];
    for (const p of rs[0] as Vec2[]) {
      expect(Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - 10)).toBeLessThan(0.5);
    }
    const want = Math.PI * 100;
    expect(Math.abs(regionArea(rs) - want) / want).toBeLessThan(0.02);
  });

  it('a lower threshold keeps only darker pixels', () => {
    // Gray ramp left to right: 0 at x = 0 up to 255 at x = 63.
    const ramp = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) ramp[j * W + i] = (i * 255) / 63;
    const at = (t: number) => {
      const b = rings(traceBitmap(ramp, W, H, opts({ threshold: t })));
      return Math.max(...(b[0] as Vec2[]).map((p) => p[0]));
    };
    // The edge sits where the ramp crosses the threshold (sub-pixel).
    expect(Math.abs(at(64) - (0.5 + (63.5 * 63) / 255))).toBeLessThan(0.5);
    expect(at(64)).toBeLessThan(at(192));
  });

  it('rejects bad input', () => {
    expect(() => traceBitmap(new Uint8Array(5), 2, 2, opts())).toThrow(RangeError);
    expect(() => traceBitmap(new Uint8Array(4), 2, 2, opts({ pixelSize: 0 }))).toThrow(RangeError);
  });
});
