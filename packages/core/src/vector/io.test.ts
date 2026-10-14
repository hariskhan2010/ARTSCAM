import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Segment } from '../model/schema';
import { importDxf } from './dxf';
import { flatten, signedArea } from './flatten';
import { bbox, evalPiece, length, pieces, type BBox } from './path';
import { ellipse, polygon, rectangle, star } from './shapes';
import { exportSvg, importSvg, parseLength, parsePathData, parseTransform } from './svg';
import { parseXml } from './xml';

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../fixtures/vector/${name}`, import.meta.url)),
    'utf8',
  );

function expectBox(actual: BBox | undefined, expected: BBox, digits = 6) {
  expect(actual).toBeDefined();
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(actual![k], k).toBeCloseTo(expected[k], digits);
  }
}

describe('xml', () => {
  it('parses attributes, entities, CDATA and nesting', () => {
    const el = parseXml(
      `<?xml version="1.0"?><!-- c --><a x='1' y="&lt;&#65;&#x42;&amp;"><b/><![CDATA[<raw>]]></a>`,
    );
    expect(el.name).toBe('a');
    expect(el.attrs).toEqual({ x: '1', y: '<AB&' });
    expect(el.children.map((c) => c.name)).toEqual(['b']);
    expect(el.text).toBe('<raw>');
  });

  it('rejects mismatched tags', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/Mismatched/);
    expect(() => parseXml('<a>')).toThrow(/Unclosed/);
  });
});

describe('svg path data', () => {
  it('handles relative, implicit and shorthand commands', () => {
    const segs = parsePathData('m10 10 20 0 v10 h-20 z M0,0 c1 1 2 1 3 0 s 2 -1 3 0 q1 1 2 0 t2 0');
    expect(segs.slice(0, 5)).toEqual([
      { type: 'move', p: [10, 10] },
      { type: 'line', p: [30, 10] },
      { type: 'line', p: [30, 20] },
      { type: 'line', p: [10, 20] },
      { type: 'close' },
    ]);
    // S reflects the previous c2 (2,1) about (3,0) → (4,-1).
    expect(segs[7]).toEqual({ type: 'cubic', c1: [4, -1], c2: [5, -1], p: [6, 0] });
    // T reflects the previous control (7,1) about (8,0) → (9,-1).
    expect(segs[9]).toEqual({ type: 'quad', c: [9, -1], p: [10, 0] });
  });

  it('parses compact numbers and arc flags', () => {
    const segs = parsePathData('M0-1.5L.5e1 1.5a5 5 0 1010 0');
    expect(segs[0]).toEqual({ type: 'move', p: [0, -1.5] });
    expect(segs[1]).toEqual({ type: 'line', p: [5, 1.5] });
    expect(segs.at(-1)).toMatchObject({ p: [15, 1.5] });
  });

  it('converts arcs to cubics on the right circle', () => {
    const segs = parsePathData('M0 0 A10 10 0 0 1 20 0');
    for (const p of pieces(segs)) {
      for (let t = 0; t <= 1; t += 0.1) {
        const [x, y] = evalPiece(p, t);
        expect(Math.hypot(x - 10, y)).toBeCloseTo(10, 2);
        expect(y).toBeLessThanOrEqual(1e-9); // sweep=1 goes through negative y (screen up)
      }
    }
  });

  it('scales up radii that are too small', () => {
    const segs = parsePathData('M0 0 A1 1 0 0 1 20 0');
    expect(length(segs)).toBeCloseTo(Math.PI * 10, 1);
  });

  it('rejects junk', () => {
    expect(() => parsePathData('M0 0 L x')).toThrow();
    expect(() => parsePathData('L0 0')).toThrow(/moveto/);
  });
});

describe('svg helpers', () => {
  it('parses lengths in all units', () => {
    expect(parseLength('10mm')).toBe(10);
    expect(parseLength('1in')).toBe(25.4);
    expect(parseLength('96')).toBeCloseTo(25.4, 12);
    expect(parseLength('72pt')).toBeCloseTo(25.4, 12);
    expect(parseLength('2cm')).toBe(20);
    expect(parseLength('50%')).toBeUndefined();
  });

  it('composes transforms left to right', () => {
    const m = parseTransform('translate(10 0) scale(2)');
    expect(m).toEqual([2, 0, 0, 2, 10, 0]);
  });
});

describe('importSvg', () => {
  it('imports the sign fixture at the correct scale, Y up', () => {
    const { width, height, vectors, warnings } = importSvg(fixture('sign.svg'));
    expect(width).toBe(300);
    expect(height).toBe(200);
    const byName = Object.fromEntries(vectors.map((v) => [v.name, v]));
    expect(Object.keys(byName).sort()).toEqual(['arch', 'border', 'medallion', 'plate', 'tri']);
    expectBox(bbox(byName.border!.segments), { minX: 10, minY: 10, maxX: 290, maxY: 190 });
    expectBox(bbox(byName.medallion!.segments), { minX: 100, minY: 50, maxX: 200, maxY: 150 });
    expectBox(bbox(byName.plate!.segments), { minX: 30, minY: 150, maxX: 70, maxY: 170 });
    expectBox(bbox(byName.arch!.segments), { minX: 200, minY: 50, maxX: 240, maxY: 70 }, 3);
    expectBox(bbox(byName.tri!.segments), { minX: 250, minY: 150, maxX: 270, maxY: 170 });
    expect(byName.border!.closed).toBe(true);
    expect(byName.arch!.closed).toBe(false);
    expect(warnings.some((w) => w.includes('Text'))).toBe(true);
  });

  it('treats unitless sizes as CSS px (96 dpi)', () => {
    const { vectors, height } = importSvg(fixture('px.svg'));
    expect(height).toBeCloseTo(25.4, 12);
    expectBox(bbox(vectors[0]!.segments), { minX: 0, minY: 12.7, maxX: 25.4, maxY: 25.4 });
  });

  it('places content at Y 0 when the file has no size', () => {
    const { vectors, warnings } = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="96" width="96" height="96"/></svg>',
    );
    expect(bbox(vectors[0]!.segments)!.minY).toBeCloseTo(0, 12);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('rejects non-SVG input', () => {
    expect(() => importSvg('<html/>')).toThrow(/not <svg>/);
    expect(() => importSvg('not xml <')).toThrow();
  });
});

describe('SVG round trip (M1 acceptance: a sign layout)', () => {
  const layout: { id: string; segments: Segment[]; closed: boolean }[] = [
    { id: 'border', segments: rectangle(5, 5, 290, 190, 12), closed: true },
    { id: 'oval', segments: ellipse(150, 100, 80, 45, 0.2), closed: true },
    { id: 'hex', segments: polygon(40, 160, 18, 6), closed: true },
    { id: 'star', segments: star(260, 40, 20, 8, 5), closed: true },
    {
      id: 'swash',
      segments: [
        { type: 'move', p: [60, 40] },
        { type: 'cubic', c1: [90, 70], c2: [120, 10], p: [150, 40] },
        { type: 'quad', c: [170, 60], p: [190, 40] },
      ],
      closed: false,
    },
  ];

  it('export → import preserves every vector within 1e-4 mm', () => {
    const text = exportSvg(layout, { width: 300, height: 200 });
    const back = importSvg(text);
    expect(back.width).toBe(300);
    expect(back.height).toBe(200);
    expect(back.warnings).toEqual([]);
    expect(back.vectors.map((v) => v.name)).toEqual(layout.map((v) => v.id));
    back.vectors.forEach((v, i) => {
      const orig = layout[i]!;
      expect(v.closed).toBe(orig.closed);
      expect(v.segments.map((s) => s.type)).toEqual(orig.segments.map((s) => s.type));
      v.segments.forEach((s, j) => {
        const o = orig.segments[j]!;
        const nums = (x: Segment) => Object.values(x).filter(Array.isArray).flat() as number[];
        nums(s).forEach((n, k) => expect(Math.abs(n - nums(o)[k]!)).toBeLessThan(1e-4));
      });
    });
  });

  it('shapes are counter-clockwise and closed', () => {
    for (const v of layout.filter((l) => l.closed)) {
      const [poly] = flatten(v.segments, 0.01);
      expect(signedArea(poly!.points), v.id).toBeGreaterThan(0);
    }
  });
});

describe('importDxf', () => {
  it('imports the sign fixture in mm and joins loose lines into contours', () => {
    const { vectors, scale, warnings } = importDxf(fixture('sign.dxf'));
    expect(scale).toBe(1);
    expect(warnings).toEqual(['Skipped 1 unsupported TEXT entity']);

    const rect = vectors.find((v) => v.layer === 'Cut' && v.segments.length === 6);
    expect(rect?.closed).toBe(true);
    expectBox(bbox(rect!.segments), { minX: 0, minY: 0, maxX: 100, maxY: 50 });

    const circle = vectors.find((v) => v.layer === 'Holes')!;
    expect(circle.closed).toBe(true);
    expectBox(bbox(circle.segments), { minX: 40, minY: 15, maxX: 60, maxY: 35 });

    const arc = vectors.find((v) => v.layer === 'Decor' && bbox(v.segments)!.maxX < 200)!;
    expect(arc.closed).toBe(false);
    expectBox(bbox(arc.segments), { minX: 130, minY: 25, maxX: 170, maxY: 45 });

    const slot = vectors.find((v) => v.layer === 'Cut' && v !== rect)!;
    expect(slot.closed).toBe(true);
    expectBox(bbox(slot.segments), { minX: 190, minY: 0, maxX: 250, maxY: 20 });
    expect(length(slot.segments)).toBeCloseTo(80 + 2 * Math.PI * 10, 1);
  });

  it('turns a clamped cubic SPLINE into exact Béziers', () => {
    const { vectors } = importDxf(fixture('sign.dxf'));
    const spline = vectors.find((v) => v.layer === 'Decor' && bbox(v.segments)!.minX >= 300)!;
    expect(spline.segments.map((s) => s.type)).toEqual(['move', 'cubic', 'cubic']);
    expect(spline.segments[0]).toEqual({ type: 'move', p: [300, 0] });
    expect(spline.segments.at(-1)).toMatchObject({ p: [340, 0] });

    // Compare with direct Cox–de Boor evaluation of the B-spline.
    const knots = [0, 0, 0, 0, 1, 2, 2, 2, 2];
    const ctrl = [
      [300, 0],
      [310, 20],
      [320, 0],
      [330, 20],
      [340, 0],
    ];
    const N = (i: number, p: number, u: number): number => {
      if (p === 0) return knots[i]! <= u && u < knots[i + 1]! ? 1 : 0;
      const a = knots[i + p]! - knots[i]!;
      const b = knots[i + p + 1]! - knots[i + 1]!;
      return (
        (a ? ((u - knots[i]!) / a) * N(i, p - 1, u) : 0) +
        (b ? ((knots[i + p + 1]! - u) / b) * N(i + 1, p - 1, u) : 0)
      );
    };
    const C = (u: number) =>
      ctrl.reduce(
        (acc, p, i) => [acc[0]! + N(i, 3, u) * p[0]!, acc[1]! + N(i, 3, u) * p[1]!],
        [0, 0],
      );
    const ps = pieces(spline.segments);
    for (const u of [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]) {
      const piece = ps[Math.floor(u)]!;
      const got = evalPiece(piece, u - Math.floor(u));
      const want = C(u);
      expect(got[0]).toBeCloseTo(want[0]!, 9);
      expect(got[1]).toBeCloseTo(want[1]!, 9);
    }
  });

  it('scales inch drawings to mm', () => {
    const { vectors, scale } = importDxf(fixture('inch.dxf'));
    expect(scale).toBe(25.4);
    expect(vectors).toHaveLength(1); // two touching lines joined
    expectBox(bbox(vectors[0]!.segments), { minX: 0, minY: 0, maxX: 25.4, maxY: 50.8 });
    expect(vectors[0]!.closed).toBe(false);
  });

  it('rejects garbage', () => {
    expect(() => importDxf('hello\nworld\n')).toThrow();
  });
});
