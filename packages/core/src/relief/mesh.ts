/**
 * Mesh import for relief clipart (plan.md T6.10): STL (binary and ASCII) and
 * OBJ files become a flat triangle list, which is then seen from above (+Z up)
 * as a height grid. A mesh is a Float64Array of 9 numbers per triangle
 * (x, y, z of each corner); units are whatever the file used (taken as mm).
 */

export class MeshError extends Error {
  override name = 'MeshError';
}

/** Height grid of a mesh seen from above. Row 0 is at the bottom (lowest Y), like a relief. */
export interface MeshHeights {
  cols: number;
  rows: number;
  /** mm per cell. */
  cell: number;
  /** Heights above the mesh's lowest point (mm); 0 where no triangle covers a cell. */
  z: Float32Array;
  /** Size of the grid (cols·cell × rows·cell) and the mesh's height range, mm. */
  width: number;
  height: number;
  depth: number;
}

/** Upper bound on triangles read from one file (a 2 GB STL holds ~40M). */
const MAX_TRIANGLES = 20_000_000;

function finite3(x: number, y: number, z: number, where: string): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
    throw new MeshError(`Bad number in ${where}`);
}

/**
 * Reads an STL file. Binary when the size matches the triangle count in the
 * header (some binary files also start with "solid"), otherwise ASCII.
 */
export function parseStl(bytes: Uint8Array): Float64Array {
  if (bytes.length >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = view.getUint32(80, true);
    if (84 + 50 * n === bytes.length) {
      if (n > MAX_TRIANGLES) throw new MeshError('The STL file has too many triangles');
      const out = new Float64Array(n * 9);
      for (let t = 0; t < n; t++) {
        // 12 bytes of normal, then 3 corners of 3 floats, then 2 attribute bytes.
        const o = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(o + k * 4, true);
        for (let k = 0; k < 3; k++)
          finite3(
            out[t * 9 + k * 3] as number,
            out[t * 9 + k * 3 + 1] as number,
            out[t * 9 + k * 3 + 2] as number,
            `triangle ${t + 1}`,
          );
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid\b/i.test(text)) throw new MeshError('Not an STL file');
  return parseAsciiStl(text);
}

function parseAsciiStl(text: string): Float64Array {
  const coords: number[] = [];
  const re = /\bvertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    const z = Number(m[3]);
    finite3(x, y, z, `vertex ${coords.length / 3 + 1}`);
    coords.push(x, y, z);
  }
  if (coords.length % 9 !== 0) throw new MeshError('A facet does not have three vertices');
  if (coords.length === 0) throw new MeshError('The STL file has no triangles');
  return Float64Array.from(coords);
}

/** Reads an OBJ file's vertices (`v`) and faces (`f`); polygons are split into triangle fans. */
export function parseObj(text: string): Float64Array {
  const verts: number[] = [];
  const out: number[] = [];
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const parts = (lines[ln] as string).trim().split(/\s+/);
    const kind = parts[0];
    if (kind === 'v') {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      finite3(x, y, z, `line ${ln + 1}`);
      verts.push(x, y, z);
    } else if (kind === 'f') {
      const nv = verts.length / 3;
      const idx = parts.slice(1).map((p) => {
        // "i", "i/t", "i/t/n" or "i//n"; negative indices count back from the last vertex.
        const i = Number(p.split('/')[0]);
        const k = i < 0 ? nv + i : i - 1;
        if (!Number.isInteger(i) || i === 0 || k < 0 || k >= nv)
          throw new MeshError(`Bad vertex index "${p}" on line ${ln + 1}`);
        return k;
      });
      if (idx.length < 3) throw new MeshError(`A face needs three vertices (line ${ln + 1})`);
      for (let j = 1; j + 1 < idx.length; j++) {
        for (const k of [idx[0], idx[j], idx[j + 1]] as number[])
          out.push(verts[k * 3] as number, verts[k * 3 + 1] as number, verts[k * 3 + 2] as number);
      }
    }
  }
  if (out.length === 0) throw new MeshError('The OBJ file has no faces');
  if (out.length / 9 > MAX_TRIANGLES) throw new MeshError('The OBJ file has too many triangles');
  return Float64Array.from(out);
}

/** Reads a mesh file by its name's extension (.stl or .obj). */
export function parseMesh(bytes: Uint8Array, fileName: string): Float64Array {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'stl') return parseStl(bytes);
  if (ext === 'obj') return parseObj(new TextDecoder().decode(bytes));
  throw new MeshError('Choose an .stl or .obj file');
}

export function meshBounds(tris: Float64Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = tris[i + a] as number;
      if (v < (min[a] as number)) min[a] = v;
      if (v > (max[a] as number)) max[a] = v;
    }
  }
  return { min, max };
}

/** Grids larger than this are refused (a 2000 × 2000 grid is plenty for clipart). */
export const MAX_MESH_CELLS = 4_000_000;

/**
 * The mesh seen from above: each cell's height is the highest triangle over
 * its centre (barycentric interpolation), measured from the mesh's lowest
 * point. The grid is centred on the mesh's X/Y extent with `cell` mm cells.
 */
export function meshToHeights(tris: Float64Array, cell: number): MeshHeights {
  if (!(cell > 0)) throw new RangeError('cell must be > 0');
  if (tris.length < 9) throw new MeshError('The mesh has no triangles');
  const { min, max } = meshBounds(tris);
  const [minX, minY, minZ] = min as [number, number, number];
  const [maxX, maxY, maxZ] = max as [number, number, number];
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell - 1e-9));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell - 1e-9));
  if (cols * rows > MAX_MESH_CELLS)
    throw new MeshError('The mesh is too large for that detail; use a coarser grid');
  const x0 = (minX + maxX - cols * cell) / 2;
  const y0 = (minY + maxY - rows * cell) / 2;
  const z = new Float32Array(cols * rows).fill(-Infinity);

  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t] as number;
    const ay = tris[t + 1] as number;
    const az = tris[t + 2] as number;
    const bx = tris[t + 3] as number;
    const by = tris[t + 4] as number;
    const bz = tris[t + 5] as number;
    const cx = tris[t + 6] as number;
    const cy = tris[t + 7] as number;
    const cz = tris[t + 8] as number;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    // Seen edge-on from above (a vertical wall): it covers no cell centre.
    if (Math.abs(det) < 1e-12) continue;
    const c0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / cell - 0.5));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cell - 0.5));
    const r0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / cell - 0.5));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by, cy) - y0) / cell - 0.5));
    // A small tolerance so centres on a shared edge are not missed by both triangles.
    const eps = -1e-9;
    for (let r = r0; r <= r1; r++) {
      const py = y0 + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const px = x0 + (c + 0.5) * cell;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < eps || l2 < eps || l3 < eps) continue;
        const h = l1 * az + l2 * bz + l3 * cz - minZ;
        const i = r * cols + c;
        if (h > (z[i] as number)) z[i] = h;
      }
    }
  }
  for (let i = 0; i < z.length; i++) if (z[i] === -Infinity) z[i] = 0;
  return {
    cols,
    rows,
    cell,
    z,
    width: cols * cell,
    height: rows * cell,
    depth: maxZ - minZ,
  };
}
