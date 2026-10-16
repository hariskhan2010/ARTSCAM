import { describe, expect, it } from 'vitest';
import { MeshError, meshToHeights, parseMesh, parseObj, parseStl } from './mesh';

/** A square pyramid: 10 × 10 mm base at z = 1, apex 4 mm higher over the centre. */
const P = {
  a: [0, 0, 1],
  b: [10, 0, 1],
  c: [10, 10, 1],
  d: [0, 10, 1],
  apex: [5, 5, 5],
} as const;
const PYRAMID: (readonly number[])[][] = [
  [P.a, P.b, P.apex],
  [P.b, P.c, P.apex],
  [P.c, P.d, P.apex],
  [P.d, P.a, P.apex],
  [P.a, P.c, P.b],
  [P.a, P.d, P.c],
];

function asciiStl(tris: (readonly number[])[][]): string {
  const facets = tris.map(
    (t) =>
      `facet normal 0 0 0\n outer loop\n${t.map((v) => `  vertex ${v.join(' ')}`).join('\n')}\n endloop\nendfacet`,
  );
  return `solid test\n${facets.join('\n')}\nendsolid test\n`;
}

function binaryStl(tris: (readonly number[])[][]): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * tris.length);
  // A binary header may start with "solid" too; the size decides.
  bytes.set(new TextEncoder().encode('solid binary'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    t.forEach((v, k) =>
      v.forEach((x, a) => view.setFloat32(84 + i * 50 + 12 + k * 12 + a * 4, x, true)),
    );
  });
  return bytes;
}

/** True pyramid height above its base at (x, y). */
const pyramidAt = (x: number, y: number) =>
  Math.max(0, 4 * (1 - Math.max(Math.abs(x - 5), Math.abs(y - 5)) / 5));

function expectPyramid(tris: Float64Array, cell: number) {
  const g = meshToHeights(tris, cell);
  expect(g.cols).toBe(Math.ceil(10 / cell));
  expect(g.rows).toBe(Math.ceil(10 / cell));
  expect(g.depth).toBeCloseTo(4, 9);
  // Heights match the mesh within a cell: the slope is 0.8, so error ≤ 0.8·cell.
  let worst = 0;
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const h = g.z[r * g.cols + c] as number;
      worst = Math.max(worst, Math.abs(h - pyramidAt((c + 0.5) * cell, (r + 0.5) * cell)));
    }
  expect(worst).toBeLessThan(1e-5);
}

describe('STL', () => {
  it('reads ASCII STL', () => {
    const tris = parseStl(new TextEncoder().encode(asciiStl(PYRAMID)));
    expect(tris.length).toBe(PYRAMID.length * 9);
    expect(Array.from(tris.slice(0, 9))).toEqual([0, 0, 1, 10, 0, 1, 5, 5, 5]);
    expectPyramid(tris, 0.5);
  });

  it('reads binary STL, even with a header starting "solid"', () => {
    const tris = parseStl(binaryStl(PYRAMID));
    expect(tris.length).toBe(PYRAMID.length * 9);
    expectPyramid(tris, 0.25);
  });

  it('rejects files that are not STL', () => {
    expect(() => parseStl(new TextEncoder().encode('hello'))).toThrow(MeshError);
    expect(() => parseStl(new TextEncoder().encode('solid x\nvertex 1 2 nope\n'))).toThrow(
      MeshError,
    );
    expect(() => parseStl(new TextEncoder().encode('solid x\nendsolid'))).toThrow(/no triangles/);
  });
});

describe('OBJ', () => {
  it('reads vertices and faces, splitting polygons into triangles', () => {
    const obj = [
      '# pyramid',
      'v 0 0 1',
      'v 10 0 1',
      'v 10 10 1',
      'v 0 10 1',
      'v 5 5 5',
      'vt 0 0',
      'vn 0 0 1',
      'f 1/1/1 2/1/1 5/1/1',
      'f 2//1 3//1 5//1',
      'f 3 4 5',
      'f -2 -5 -1', // 4 1 5, counted back from the last vertex
      'f 1 4 3 2', // the base as one quad
    ].join('\n');
    const tris = parseObj(obj);
    expect(tris.length).toBe(6 * 9);
    expectPyramid(tris, 0.5);
    expect(parseMesh(new TextEncoder().encode(obj), 'Model.OBJ').length).toBe(6 * 9);
  });

  it('rejects bad faces', () => {
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nf 1 2 3')).toThrow(/Bad vertex index/);
    expect(() => parseObj('v 0 0 0\nf 1 1')).toThrow(/three vertices/);
    expect(() => parseObj('v 0 0 0')).toThrow(/no faces/);
    expect(() => parseMesh(new Uint8Array(), 'a.ply')).toThrow(/\.stl or \.obj/);
  });
});

describe('meshToHeights', () => {
  it('a faceted sphere cap matches the sphere within a cell', () => {
    // Hemisphere of radius 5 as a lat/long mesh, seen from above.
    const R = 5;
    const n = 48;
    const pt = (i: number, j: number) => {
      const th = (i / n) * (Math.PI / 2); // from the pole down to the equator
      const ph = (j / n) * 2 * Math.PI;
      return [R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), R * Math.cos(th)];
    };
    const tris: number[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        tris.push(...pt(i, j), ...pt(i + 1, j), ...pt(i + 1, j + 1));
        tris.push(...pt(i, j), ...pt(i + 1, j + 1), ...pt(i, j + 1));
      }
    const cell = 0.25;
    const g = meshToHeights(Float64Array.from(tris), cell);
    expect(g.cols).toBe(40);
    expect(g.depth).toBeCloseTo(5, 6);
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const x = (c + 0.5) * cell - 5;
        const y = (r + 0.5) * cell - 5;
        const d = Math.hypot(x, y);
        if (d > 4.5) continue; // the rim is steeper than one cell can resolve
        const h = g.z[r * g.cols + c] as number;
        // Facets sit inside the sphere; the error is well under a cell's worth of slope.
        expect(Math.abs(h - Math.sqrt(R * R - d * d))).toBeLessThan(cell);
      }
  });

  it('leaves uncovered cells at 0 and keeps the highest surface', () => {
    // Two stacked horizontal triangles: the upper one wins where they overlap.
    const tris = Float64Array.from([0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 2, 2, 0, 2, 0, 2, 2]);
    const g = meshToHeights(tris, 1);
    expect(g.cols).toBe(4);
    expect(g.z[0]).toBe(2); // centre (0.5, 0.5): under both
    expect(g.z[3]).toBe(0); // (3.5, 0.5): under the lower one only
    expect(g.z[15]).toBe(0); // (3.5, 3.5): outside both
  });
});
