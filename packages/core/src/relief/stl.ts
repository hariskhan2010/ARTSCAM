import type { Grid } from './relief';

/**
 * Binary STL of a relief as a closed solid (plan.md M4 "STL export"): the
 * relief surface on top, a flat bottom at z = 0, and side walls joining them,
 * so the mesh is watertight. Heights sit on a base plate of `base` mm. Large
 * grids are sampled every `step` cells so the file stays a sensible size.
 */

export interface StlOptions {
  /** Thickness under the lowest point of the relief (mm). Default 1. */
  base?: number;
  /** Use every n-th cell. Default: chosen to keep about `maxTriangles` triangles. */
  step?: number;
  maxTriangles?: number;
}

export function reliefToStl(g: Grid, options: StlOptions = {}): Uint8Array {
  const base = options.base ?? 1;
  const maxTri = options.maxTriangles ?? 2_000_000;
  // Top + bottom ≈ 4 triangles per sampled cell.
  const step = Math.max(1, options.step ?? Math.ceil(Math.sqrt((4 * g.cols * g.rows) / maxTri)));
  const cs: number[] = [];
  for (let c = 0; c < g.cols; c += step) cs.push(c);
  if (cs.at(-1) !== g.cols - 1) cs.push(g.cols - 1);
  const rs: number[] = [];
  for (let r = 0; r < g.rows; r += step) rs.push(r);
  if (rs.at(-1) !== g.rows - 1) rs.push(g.rows - 1);
  const nc = cs.length;
  const nr = rs.length;
  if (nc < 2 || nr < 2) throw new RangeError('Relief is too small for an STL');

  let min = Infinity;
  for (let i = 0; i < g.z.length; i++) min = Math.min(min, g.z[i] as number);
  const lift = base - min;
  const X = (i: number) => ((cs[i] as number) + 0.5) * g.resolution;
  const Y = (j: number) => ((rs[j] as number) + 0.5) * g.resolution;
  const Z = (i: number, j: number) =>
    (g.z[(rs[j] as number) * g.cols + (cs[i] as number)] as number) + lift;

  const quads = (nc - 1) * (nr - 1);
  const walls = 2 * (nc - 1) + 2 * (nr - 1);
  const count = 4 * quads + 2 * walls;
  const out = new Uint8Array(84 + 50 * count);
  const view = new DataView(out.buffer);
  new TextEncoder().encodeInto('Naqsh relief (binary STL, mm)', out);
  view.setUint32(80, count, true);
  let o = 84;
  type P = [number, number, number];
  const tri = (a: P, b: P, c: P) => {
    // Normal from the winding (counter-clockwise seen from outside).
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const v of [nx, ny, nz, ...a, ...b, ...c]) {
      view.setFloat32(o, v, true);
      o += 4;
    }
    o += 2; // attribute byte count
  };
  const top = (i: number, j: number): P => [X(i), Y(j), Z(i, j)];
  const bot = (i: number, j: number): P => [X(i), Y(j), 0];

  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      // Top faces up (CCW from above), bottom faces down (reversed).
      tri(top(i, j), top(i + 1, j), top(i + 1, j + 1));
      tri(top(i, j), top(i + 1, j + 1), top(i, j + 1));
      tri(bot(i, j), bot(i + 1, j + 1), bot(i + 1, j));
      tri(bot(i, j), bot(i, j + 1), bot(i + 1, j + 1));
    }
  }
  // Walls, wound to face outward.
  for (let i = 0; i < nc - 1; i++) {
    tri(bot(i, 0), bot(i + 1, 0), top(i + 1, 0)); // front (y min)
    tri(bot(i, 0), top(i + 1, 0), top(i, 0));
    tri(bot(i + 1, nr - 1), bot(i, nr - 1), top(i, nr - 1)); // back (y max)
    tri(bot(i + 1, nr - 1), top(i, nr - 1), top(i + 1, nr - 1));
  }
  for (let j = 0; j < nr - 1; j++) {
    tri(bot(0, j + 1), bot(0, j), top(0, j)); // left (x min)
    tri(bot(0, j + 1), top(0, j), top(0, j + 1));
    tri(bot(nc - 1, j), bot(nc - 1, j + 1), top(nc - 1, j + 1)); // right (x max)
    tri(bot(nc - 1, j), top(nc - 1, j + 1), top(nc - 1, j));
  }
  return out;
}
