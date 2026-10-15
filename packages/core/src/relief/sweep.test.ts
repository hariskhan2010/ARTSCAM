import { describe, expect, it } from 'vitest';
import {
  addRelief,
  addVectors,
  deleteVectors,
  newProject,
  reliefOpVectors,
  setReliefOp,
} from '../model/commands';
import { projectSchema, type Project, type ReliefOp, type Segment } from '../model/schema';
import { ellipse } from '../vector/shapes';
import { evaluateRelief, gridRange } from './relief';
import { sectionProfile } from './sweep';

const line = (pts: [number, number][]): Segment[] => [
  { type: 'move', p: pts[0]! },
  ...pts.slice(1).map((p): Segment => ({ type: 'line', p })),
];

/** 100 × 60 mm stock, 0.25 mm relief, the given vectors and one op. */
function build(vectors: { id: string; segments: Segment[]; closed?: boolean }[], op: ReliefOp) {
  let p: Project = newProject({
    stock: { width: 100, height: 60, thickness: 20, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors(vectors.map((v) => ({ layer: 'L1', closed: v.closed ?? false, ...v }))).apply(p);
  p = addRelief(0.25, 'r').apply(p);
  p = setReliefOp('r', op).apply(p);
  p = projectSchema.parse(p);
  const g = evaluateRelief(p.reliefs[0]!, p);
  const at = (x: number, y: number) =>
    g.z[Math.floor(y / g.resolution) * g.cols + Math.floor(x / g.resolution)]!;
  return { g, at };
}

// Triangle section 10 mm wide, 4 mm high, drawn anywhere (it is measured from its own ends).
const TRI = line([
  [200, 200],
  [205, 204],
  [210, 200],
]);

describe('cross-sections', () => {
  it('height is measured from the line between the ends, left to right', () => {
    const s = sectionProfile(TRI, 0.01);
    expect(s.width).toBeCloseTo(10, 9);
    expect(s.at(0)).toBeCloseTo(0, 6);
    expect(s.at(0.5)).toBeCloseTo(4, 3);
    expect(s.at(0.25)).toBeCloseTo(2, 3);
    // Drawn right to left: the same section.
    const r = sectionProfile(
      line([
        [210, 200],
        [205, 204],
        [200, 200],
      ]),
      0.01,
    );
    expect(r.at(0.25)).toBeCloseTo(2, 3);
  });
});

describe('ops that use vectors', () => {
  it('deleting a rail or section removes the sweep that uses it', () => {
    let p = newProject();
    p = addVectors([
      {
        id: 'rail',
        layer: 'L1',
        closed: false,
        segments: line([
          [0, 0],
          [10, 0],
        ]),
      },
      { id: 's', layer: 'L1', closed: false, segments: TRI },
      { id: 'other', layer: 'L1', closed: true, segments: ellipse(5, 5, 2) },
    ]).apply(p);
    p = addRelief(0.5, 'r').apply(p);
    p = setReliefOp('r', { op: 'extrude', rail: 'rail', section: 's', mode: 'add' }).apply(p);
    expect(deleteVectors(['other']).apply(p).reliefs[0]!.ops).toHaveLength(1);
    expect(deleteVectors(['s']).apply(p).reliefs[0]!.ops).toHaveLength(0);
    expect(
      reliefOpVectors({ op: 'extrude', rail: 'a', section: 'b', endSection: 'c', mode: 'add' }),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('extrude (T6.1)', () => {
  const rail = line([
    [20, 30],
    [80, 30],
  ]);

  it('a straight rail gives the section across it, along its length, with square ends', () => {
    const { at } = build(
      [
        { id: 'rail', segments: rail },
        { id: 's', segments: TRI },
      ],
      { op: 'extrude', rail: 'rail', section: 's', mode: 'add' },
    );
    // Centre line: full height; 2.5 mm off it: half height; beyond 5 mm: nothing.
    expect(at(50, 30)).toBeCloseTo(4, 0);
    expect(at(50, 32.5)).toBeCloseTo(2, 0);
    expect(at(50, 27.5)).toBeCloseTo(2, 0);
    expect(at(50, 36)).toBe(0);
    // Square ends: nothing past the rail's ends.
    expect(at(19, 30)).toBe(0);
    expect(at(81, 30)).toBe(0);
    expect(at(21, 30)).toBeGreaterThan(3.5);
  });

  it('an end section blends in along the rail; width can be set', () => {
    const flat = line([
      [0, 0],
      [5, 0.0001],
      [10, 0],
    ]);
    const { at } = build(
      [
        { id: 'rail', segments: rail },
        { id: 's', segments: TRI },
        { id: 'e', segments: flat },
      ],
      { op: 'extrude', rail: 'rail', section: 's', endSection: 'e', width: 20, mode: 'add' },
    );
    expect(at(20.5, 30)).toBeCloseTo(4, 0); // start: full triangle
    expect(at(50, 30)).toBeCloseTo(2, 0); // halfway: half blended
    expect(at(79.5, 30)).toBeLessThan(0.2); // end: flat
    expect(at(50, 39)).toBeGreaterThan(0); // 20 mm wide
  });

  it('a closed rail (frame) has no ends, and combine modes apply', () => {
    const frame = ellipse(50, 30, 20);
    const { g, at } = build(
      [
        { id: 'rail', segments: frame, closed: true },
        { id: 's', segments: TRI },
      ],
      { op: 'extrude', rail: 'rail', section: 's', mode: 'subtract' },
    );
    expect(at(70, 30)).toBeCloseTo(-4, 0);
    expect(at(30, 30)).toBeCloseTo(-4, 0);
    expect(at(50, 50)).toBeCloseTo(-4, 0);
    expect(at(50, 30)).toBe(0); // the middle is untouched
    expect(gridRange(g.z).max).toBe(0);
  });
});

describe('spin (T6.2)', () => {
  it('heights depend only on the distance to the centre and follow the section', () => {
    // Section from the centre outward: 10 mm long, rising to 4 mm in the middle.
    const { at } = build([{ id: 's', segments: TRI }], {
      op: 'spin',
      section: 's',
      centre: [50, 30],
      mode: 'add',
    });
    expect(at(50, 30)).toBeCloseTo(0, 0);
    for (const [dx, dy] of [
      [5, 0],
      [0, 5],
      [-3.54, 3.54],
    ] as const)
      expect(at(50 + dx, 30 + dy)).toBeCloseTo(4, 0);
    expect(at(52.5, 30)).toBeCloseTo(2, 0);
    expect(at(50, 41)).toBe(0);
  });
});

describe('two-rail sweep (T6.3)', () => {
  const railA = line([
    [20, 25],
    [80, 25],
  ]);

  it('between parallel rails it equals an extrude of that width', () => {
    const railB = line([
      [20, 35],
      [80, 35],
    ]);
    const two = build(
      [
        { id: 'a', segments: railA },
        { id: 'b', segments: railB },
        { id: 's', segments: TRI },
      ],
      { op: 'twoRail', railA: 'a', railB: 'b', section: 's', mode: 'add' },
    );
    const ext = build(
      [
        {
          id: 'rail',
          segments: line([
            [20, 30],
            [80, 30],
          ]),
        },
        { id: 's', segments: TRI },
      ],
      { op: 'extrude', rail: 'rail', section: 's', width: 10, mode: 'add' },
    );
    for (const x of [25, 50, 75])
      for (const y of [25.5, 27.5, 30, 32.5, 34.5])
        expect(two.at(x, y)).toBeCloseTo(ext.at(x, y), 1);
  });

  it('between diverging rails the section widens with them; a rail drawn backwards is fine', () => {
    const railB = line([
      [80, 45],
      [20, 30],
    ]); // reversed, 5 mm away at x = 20, 20 mm at x = 80
    const { at } = build(
      [
        { id: 'a', segments: railA },
        { id: 'b', segments: railB },
        { id: 's', segments: TRI },
      ],
      { op: 'twoRail', railA: 'a', railB: 'b', section: 's', mode: 'add' },
    );
    // Peak halfway between the rails.
    expect(at(21, 27.6)).toBeCloseTo(4, 0);
    expect(at(79, 35)).toBeCloseTo(4, 0);
    expect(at(79, 30)).toBeCloseTo(2, 0); // a quarter of the way across
    expect(at(50, 24)).toBe(0);
  });

  it('can scale the height with the width', () => {
    const railB = line([
      [20, 35],
      [80, 45],
    ]); // 10 mm wide at the start (section width), 20 mm at the end
    const { at } = build(
      [
        { id: 'a', segments: railA },
        { id: 'b', segments: railB },
        { id: 's', segments: TRI },
      ],
      { op: 'twoRail', railA: 'a', railB: 'b', section: 's', scaleHeight: true, mode: 'add' },
    );
    expect(at(21, 30)).toBeCloseTo(4, 0);
    expect(at(79, 35)).toBeCloseTo(8, 0);
  });
});
