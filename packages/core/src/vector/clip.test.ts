import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { booleanOp, clipLines, normalize, offset, regionArea, type Region } from './clip';
import { signedArea } from './flatten';
import type { Vec2 } from './path';

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const circle = (cx: number, cy: number, r: number, n = 256): Vec2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
/** An "L" with a notch: tests inside corners. */
const ell: Vec2[] = [
  [0, 0],
  [60, 0],
  [60, 20],
  [20, 20],
  [20, 60],
  [0, 60],
];

/** Area where two regions differ; 0 when they are the same shape. */
const diffArea = (a: Region, b: Region) => Math.abs(regionArea(booleanOp('xor', a, b, 'nonZero')));

describe('offset', () => {
  it('grows a square with round corners: s² + 4sr + πr²', () => {
    const out = offset([rect(0, 0, 10, 10)], 2);
    expect(out).toHaveLength(1);
    expect(regionArea(out)).toBeCloseTo(100 + 80 + Math.PI * 4, 1);
  });

  it('grows a square with miter corners to an exact larger square', () => {
    const out = offset([rect(0, 0, 10, 10)], 2, { join: 'miter' });
    expect(regionArea(out)).toBeCloseTo(196, 6);
  });

  it('shrinks a square to an exact smaller square', () => {
    const out = offset([rect(0, 0, 10, 10)], -2);
    expect(regionArea(out)).toBeCloseTo(36, 6);
  });

  it('vanishes when shrunk past half the width', () => {
    expect(offset([rect(0, 0, 10, 10)], -5.01)).toEqual([]);
  });

  it('keeps holes and shrinks them as the outer grows', () => {
    // Even-odd: the inner square is a hole whatever its direction.
    const out = offset([rect(0, 0, 30, 30), rect(10, 10, 10, 10)], 1, { join: 'miter' });
    expect(out).toHaveLength(2);
    expect(regionArea(out)).toBeCloseTo(32 * 32 - 8 * 8, 6);
    const holes = out.filter((r) => signedArea(r) < 0);
    expect(holes).toHaveLength(1);
  });

  it('respects the arc tolerance on a grown circle', () => {
    const r = 20;
    const out = offset([circle(0, 0, r, 1024)], 5, { arcTolerance: 0.001 });
    for (const p of out[0]!) expect(Math.hypot(p[0], p[1])).toBeCloseTo(25, 1);
  });

  it('a zero offset only normalises', () => {
    const cw = [...rect(0, 0, 10, 10)].reverse();
    const out = offset([cw], 0);
    expect(signedArea(out[0]!)).toBeCloseTo(100, 9);
  });
});

describe('booleans', () => {
  const a = rect(0, 0, 20, 20);
  const b = rect(10, 10, 20, 20);

  it('union, intersect, difference, xor areas', () => {
    expect(regionArea(booleanOp('union', [a], [b]))).toBeCloseTo(700, 6);
    expect(regionArea(booleanOp('intersect', [a], [b]))).toBeCloseTo(100, 6);
    expect(regionArea(booleanOp('difference', [a], [b]))).toBeCloseTo(300, 6);
    expect(regionArea(booleanOp('xor', [a], [b]))).toBeCloseTo(600, 6);
  });

  it('difference punching a hole yields an outer and a CW hole', () => {
    const out = booleanOp('difference', [rect(0, 0, 30, 30)], [rect(10, 10, 10, 10)]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => Math.sign(signedArea(r))).sort()).toEqual([-1, 1]);
  });

  it('normalises a clockwise ring to counter-clockwise', () => {
    const out = normalize([[...a].reverse()]);
    expect(signedArea(out[0]!)).toBeGreaterThan(0);
  });
});

describe('clipLines', () => {
  it('keeps the parts of lines inside the region, skipping holes', () => {
    const region = normalize([rect(0, 0, 30, 30), rect(10, 10, 10, 10)]);
    const pieces = clipLines(
      [
        [
          [-5, 15],
          [35, 15],
        ],
      ],
      region,
    );
    const spans = pieces
      .map((p) => [Math.min(p[0]![0], p[1]![0]), Math.max(p[0]![0], p[1]![0])])
      .sort((x, y) => x[0]! - y[0]!);
    expect(spans).toEqual([
      [0, 10],
      [20, 30],
    ]);
  });
});

// --- Golden fixtures --------------------------------------------------------
// Regenerate with UPDATE_GOLDEN=1 after an intended change, and review the diff.

interface GoldenCase {
  name: string;
  run: () => Region;
}

const cases: GoldenCase[] = [
  { name: 'ell-outset-3-round', run: () => offset([ell], 3) },
  { name: 'ell-inset-3-round', run: () => offset([ell], -3) },
  { name: 'ell-outset-3-miter', run: () => offset([ell], 3, { join: 'miter' }) },
  { name: 'ell-outset-3-square', run: () => offset([ell], 3, { join: 'square' }) },
  { name: 'frame-inset-2', run: () => offset([rect(0, 0, 40, 30), rect(10, 10, 20, 10)], -2) },
  { name: 'ell-union-circle', run: () => booleanOp('union', [ell], [circle(20, 20, 12, 64)]) },
  { name: 'ell-minus-circle', run: () => booleanOp('difference', [ell], [circle(20, 20, 12, 64)]) },
  { name: 'ell-and-circle', run: () => booleanOp('intersect', [ell], [circle(20, 20, 12, 64)]) },
];

const goldenUrl = new URL('../../../../fixtures/vector/clip-golden.json', import.meta.url);
const goldenPath = fileURLToPath(goldenUrl);

describe('golden fixtures', () => {
  if (process.env.UPDATE_GOLDEN) {
    const out = Object.fromEntries(cases.map((c) => [c.name, c.run()]));
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, JSON.stringify(out) + '\n');
  }
  const golden = existsSync(goldenPath)
    ? (JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, Region>)
    : {};

  for (const c of cases) {
    it(c.name, () => {
      const expected = golden[c.name];
      expect(expected, `missing golden for ${c.name}`).toBeDefined();
      const actual = c.run();
      expect(actual.length).toBe(expected!.length);
      expect(regionArea(actual)).toBeCloseTo(regionArea(expected!), 4);
      expect(diffArea(actual, expected!)).toBeLessThan(1e-3);
    });
  }
});
