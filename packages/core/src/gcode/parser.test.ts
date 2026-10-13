import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGcode, type Move, type Point3 } from './parser';

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../fixtures/gcode/${name}`, import.meta.url)),
    'utf8',
  );

const errors = (text: string) => parseGcode(text).diagnostics.map((d) => `${d.line}: ${d.message}`);

const HEADER = 'G21 G90 G17 G54\nM3 S10000\nG0 Z5\n';

function expectPoint(actual: Point3, expected: Point3, digits = 9) {
  expected.forEach((v, i) => {
    if (v === null) expect(actual[i]).toBeNull();
    else expect(actual[i]).toBeCloseTo(v, digits);
  });
}

/** Checks an expanded arc: on the circle, within chord tolerance, monotonic in the right direction. */
function expectValidArc(move: Move, tolerance: number) {
  const arc = move.arc!;
  const [cx, cy] = arc.center;
  const pts = [move.from, ...move.points];
  let travelled = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1] as [number, number, unknown];
    const [bx, by] = pts[k] as [number, number, unknown];
    // Vertices lie on the circle.
    expect(Math.hypot(bx - cx, by - cy)).toBeCloseTo(arc.radius, 6);
    // Chord midpoint is within tolerance of the arc (sagitta).
    const mid = Math.hypot((ax + bx) / 2 - cx, (ay + by) / 2 - cy);
    expect(arc.radius - mid).toBeLessThanOrEqual(tolerance + 1e-9);
    // Each step turns the same way as the sweep.
    const cross = (ax - cx) * (by - cy) - (ay - cy) * (bx - cx);
    expect(Math.sign(cross)).toBe(Math.sign(arc.sweep));
    travelled += Math.atan2(Math.abs(cross), (ax - cx) * (bx - cx) + (ay - cy) * (by - cy));
  }
  expect(travelled).toBeCloseTo(Math.abs(arc.sweep), 6);
  expect(move.points.at(-1)).toBe(move.to);
}

describe('fixtures', () => {
  it('square-profile.nc: parses a GRBL profile with no diagnostics', () => {
    const prog = parseGcode(fixture('square-profile.nc'));
    expect(prog.diagnostics).toEqual([]);
    expect(prog.moves.map((m) => m.type)).toEqual([
      'rapid',
      'rapid',
      'linear',
      'linear',
      'linear',
      'linear',
      'linear',
      'rapid',
    ]);
    expect(prog.moves.map((m) => m.to)).toEqual([
      [null, null, 5],
      [0, 0, 5],
      [0, 0, -2],
      [50, 0, -2],
      [50, 50, -2],
      [0, 50, -2],
      [0, 0, -2],
      [0, 0, 5],
    ]);
    const cut = prog.moves[3]!;
    expect(cut.state).toMatchObject({
      units: 'mm',
      distance: 'absolute',
      feed: 1200,
      spindle: 'cw',
      rpm: 18000,
      workCoordinates: 'G54',
    });
    expect(prog.moves[2]!.state.feed).toBe(300);
    expect(prog.finalState.spindle).toBe('off');
  });

  it('arcs.nc: expands every arc form correctly', () => {
    const prog = parseGcode(fixture('arcs.nc'), { arcTolerance: 0.01 });
    expect(prog.diagnostics).toEqual([]);
    const arcs = prog.moves.filter((m) => m.arc);
    expect(arcs).toHaveLength(5);
    for (const a of arcs) expectValidArc(a, 0.01);

    const [quarterCcw, quarterCw, longCw, full, helix] = arcs as [Move, Move, Move, Move, Move];
    // I/J quarter CCW (10,0) -> (0,10) about the origin.
    expect(quarterCcw.type).toBe('arc-ccw');
    expectPoint([...quarterCcw.arc!.center, null], [0, 0, null]);
    expect(quarterCcw.arc!.sweep).toBeCloseTo(Math.PI / 2, 12);
    // R+ picks the short way: centre at the origin, -90°.
    expectPoint([...quarterCw.arc!.center, null], [0, 0, null]);
    expect(quarterCw.arc!.sweep).toBeCloseTo(-Math.PI / 2, 12);
    // R- picks the long way: clockwise (10,0) -> (0,10) about the origin is -270°.
    expectPoint([...longCw.arc!.center, null], [0, 0, null]);
    expect(longCw.arc!.sweep).toBeCloseTo((-3 * Math.PI) / 2, 12);
    // Start = end with I/J: full circle.
    expect(full.arc!.sweep).toBeCloseTo(2 * Math.PI, 12);
    expectPoint(full.to, [0, 10, -1]);
    // Helix: Z falls linearly with angle from -1 to -3.
    expect(helix.arc!.sweep).toBeCloseTo(Math.PI, 12);
    helix.points.forEach((p, k) => {
      expect(p[2]).toBeCloseTo(-1 - (2 * (k + 1)) / helix.points.length, 9);
    });
    // Feed carries over from the first arc.
    expect(helix.state.feed).toBe(800);
  });

  it('inch-incremental.nc: converts inches and incremental moves to absolute mm', () => {
    const prog = parseGcode(fixture('inch-incremental.nc'));
    expect(prog.diagnostics).toEqual([]);
    const ends = prog.moves.map((m) => m.to);
    const mm = (x: number, y: number, z: number): Point3 => [x * 25.4, y * 25.4, z * 25.4];
    const expected = [
      [null, null, 0.2],
      [1, 1, 0.2],
      [1, 1, -0.1],
      [3, 1, -0.1],
      [3, 2.5, -0.1],
      [4, 3.5, -0.1],
      [4, 3.5, 0.2],
    ] as const;
    expect(ends).toHaveLength(expected.length);
    expected.forEach(([x, y, z], i) => {
      const want = mm(x ?? 0, y ?? 0, z);
      if (x === null) want[0] = want[1] = null;
      expectPoint(ends[i]!, want);
    });
    const arc = prog.moves[5]!;
    expect(arc.type).toBe('arc-cw');
    expect(arc.arc!.radius).toBeCloseTo(25.4, 9);
    expect(arc.arc!.sweep).toBeCloseTo(-Math.PI / 2, 12);
    expectValidArc(arc, 0.01);
    expect(prog.moves[2]!.state.feed).toBeCloseTo(254, 9); // F10 in/min
    expect(prog.moves[2]!.state.distance).toBe('incremental');
    expect(prog.moves[6]!.state.distance).toBe('absolute');
  });

  it('messy-format.nc: tolerates case, spacing, CRLF, comments, N, %, checksums and short decimals', () => {
    const prog = parseGcode(fixture('messy-format.nc'));
    expect(prog.diagnostics).toEqual([]);
    expect(prog.moves.map((m) => m.to)).toEqual([
      [null, null, 5],
      [0.5, -0.5, 5],
      [0.5, -0.5, -1.5],
      [10.25, -0.5, -1.5],
      [10.25, -0.5, 5],
    ]);
    expect(prog.moves[3]!.state).toMatchObject({ feed: 250, rpm: 10000, spindle: 'cw' });
    expect(prog.moves[3]!.line).toBe(7);
  });
});

describe('modal behaviour', () => {
  it('keeps the motion mode for lines with only axis words', () => {
    const prog = parseGcode(`${HEADER}G1 X1 F100\nX2\nY3\nG0 Z5\nX0`);
    expect(prog.moves.map((m) => m.type)).toEqual([
      'rapid',
      'linear',
      'linear',
      'linear',
      'rapid',
      'rapid',
    ]);
  });

  it('applies M3/S and F before motion in the same block', () => {
    const prog = parseGcode('G21 G90\nG0 Z5\nM3 S9000 G1 X1 F500');
    expect(prog.moves[1]!.state).toMatchObject({ spindle: 'cw', rpm: 9000, feed: 500 });
  });

  it('applies G20 to F and coordinates in the same block', () => {
    const prog = parseGcode('G90\nG0 Z1\nG1 G20 X1 F2');
    expect(prog.moves[1]!.to[0]).toBe(25.4);
    expect(prog.moves[1]!.state.feed).toBeCloseTo(50.8, 12);
  });

  it('reports undeclared units and distance mode as null', () => {
    const prog = parseGcode('G0 X1 Y2 Z3');
    expect(prog.diagnostics).toEqual([]);
    expect(prog.moves[0]!.state).toMatchObject({ units: null, distance: null, feed: null });
    expect(prog.moves[0]!.to).toEqual([1, 2, 3]); // interpreted as mm, absolute
  });

  it('tracks unknown axes until they are set', () => {
    const prog = parseGcode('G21 G90\nG0 Z5\nG0 X1');
    expect(prog.moves[0]!.from).toEqual([null, null, null]);
    expect(prog.moves[1]!.to).toEqual([1, null, 5]);
  });

  it('accepts M4 (CCW spindle), coolant, tool change, dwell and program end', () => {
    const prog = parseGcode('G21 G90\nT1 M6\nM4 S8000\nM8\nG4 P0.5\nM9\nM5\nM30');
    expect(prog.diagnostics).toEqual([]);
    expect(prog.finalState.spindle).toBe('off');
    expect(prog.finalState.rpm).toBe(8000);
  });

  it('expands arcs more finely with a tighter tolerance', () => {
    const text = `${HEADER}G0 X10 Y0\nG1 Z-1 F100\nG3 X-10 Y0 I-10 J0`;
    const coarse = parseGcode(text, { arcTolerance: 0.1 }).moves.at(-1)!;
    const fine = parseGcode(text, { arcTolerance: 0.001 }).moves.at(-1)!;
    expectValidArc(coarse, 0.1);
    expectValidArc(fine, 0.001);
    expect(fine.points.length).toBeGreaterThan(coarse.points.length);
  });

  it('rejects a non-positive arc tolerance', () => {
    expect(() => parseGcode('', { arcTolerance: 0 })).toThrow(RangeError);
  });
});

describe('errors', () => {
  it.each([
    ['G28', 'Unsupported G28'],
    ['G53 G0 X0', 'Unsupported G53'],
    ['G92 X0', 'Unsupported G92'],
    ['G18', 'Unsupported G18'],
    ['G91.1', 'Unsupported G91.1'],
    ['M98 P100', 'Unsupported M98'],
    ['G0 A10', 'Unsupported word "A"'],
    ['G0 X1 X2', 'Repeated "X" word'],
    ['G0 G1 X1', 'Two motion codes in one block'],
    ['G20 G21', 'Two units codes in one block'],
    ['G0 X1 (open', 'Unclosed comment "("'],
    ['G0 X1 (a (b) c)', 'Nested comment'],
    ['G0 X1 )', 'Unmatched ")"'],
    ['G0 X1 #5', 'Unexpected text "#5"'],
    ['/G0 X1', 'Block delete "/" is not supported'],
    ['G1 X1 F0', 'Feed rate must be > 0, got F0'],
    ['M3 S-5', 'Spindle speed must be ≥ 0, got S-5'],
    ['X1', 'Axis words with no motion mode (G0/G1/G2/G3) active'],
    ['G4', 'G4 dwell needs a P word'],
    ['G0 I5', 'I/J/K/R given without an axis word'],
    [`G0 X${'9'.repeat(400)}`, `Number out of range in "X${'9'.repeat(400)}"`],
  ])('%s → %s', (line, message) => {
    expect(errors(line)).toEqual([`1: ${message}`]);
  });

  it('rejects incremental moves from an unknown position', () => {
    expect(errors('G21 G91\nG0 X5')).toEqual(['2: Incremental X move from an unknown X position']);
  });

  it('rejects arcs from an unknown position, without I/J/R, or with K', () => {
    expect(errors('G21 G90\nG2 X1 Y1 I1')).toEqual(['2: Arc from an unknown X/Y position']);
    expect(errors(`${HEADER}G0 X0 Y0\nG2 X1 Y1`)).toEqual(['5: Arc needs I/J or R']);
    expect(errors(`${HEADER}G0 X0 Y0\nG2 X1 Y1 R1 I1`)).toEqual(['5: Arc has both R and I/J']);
    expect(errors(`${HEADER}G0 X0 Y0\nG2 X1 Y1 K1`)).toEqual([
      '5: K offsets need G18/G19, which are not supported',
    ]);
    expect(errors(`${HEADER}G0 X0 Y0\nG1 X1 I1 F100`)).toEqual(['5: I/J/K/R not allowed with G1']);
  });

  it('rejects an arc whose end is not on the circle (GRBL radius rule)', () => {
    const [msg] = errors(`${HEADER}G0 X10 Y0\nG3 X0 Y10.5 I-10 J0 F100`);
    expect(msg).toMatch(/^5: Arc end is not on the circle/);
    // Within GRBL's 0.005 mm slack: accepted.
    expect(errors(`${HEADER}G0 X10 Y0\nG3 X0 Y10.004 I-10 J0 F100`)).toEqual([]);
  });

  it('rejects an R arc that cannot reach its end point', () => {
    expect(errors(`${HEADER}G0 X0 Y0\nG2 X10 Y0 R4 F100`)).toEqual([
      '5: Arc radius R4 is smaller than half the chord',
    ]);
    expect(errors(`${HEADER}G0 X0 Y0\nG2 X0 Y0 R4 F100`)).toEqual([
      '5: R-format arc with identical start and end',
    ]);
  });

  it('rejects a bad block as a whole and keeps going', () => {
    const prog = parseGcode('G21 G90\nG20 G28\nG0 X1 Y1 Z1\nG91 G0 A1\nG0 X2');
    expect(prog.diagnostics.map((d) => d.line)).toEqual([2, 4]);
    // G20 from line 2 and G91 from line 4 were not applied.
    expect(prog.moves.map((m) => m.to)).toEqual([
      [1, 1, 1],
      [2, 1, 1],
    ]);
    expect(prog.finalState.units).toBe('mm');
    expect(prog.finalState.distance).toBe('absolute');
  });

  it('marks every diagnostic as an error', () => {
    const prog = parseGcode('G28\nG0 A1');
    expect(prog.diagnostics.every((d) => d.severity === 'error')).toBe(true);
  });
});
