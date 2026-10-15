import type { Segment } from '../model/schema';
import { distToSegment, signedArea } from './flatten';
import type { Vec2 } from './path';

/**
 * Bitmap trace (plan.md T6.14): a grayscale image becomes one closed vector
 * whose rings outline the dark parts (or the light parts with `invert`).
 *
 * Method: marching squares on the pixel centres, with each edge crossing
 * placed between two samples by linear interpolation of their gray values,
 * so anti-aliased edges trace to sub-pixel accuracy. Contours are level
 * lines, so they never cross and nest correctly; every contour is walked with
 * the inside on the same side, which makes outers counter-clockwise and holes
 * clockwise (Y up) without a separate pass. Then tiny contours are dropped,
 * each ring is simplified (Douglas–Peucker) and, optionally, smooth runs are
 * fitted with Bézier curves while sharp corners stay sharp.
 */

export interface TraceOptions {
  /** Gray level 0–255: pixels darker than this are traced (lighter with `invert`). */
  threshold: number;
  /** Trace the light parts instead of the dark ones. */
  invert?: boolean;
  /** Drop outlines enclosing fewer than this many pixels (specks and pin holes). Default 2. */
  turdSize?: number;
  /** 0 = straight lines between points; up to 1 = smooth curves through them. Default 0. */
  smooth?: number;
  /** Size of one pixel on the material (mm). */
  pixelSize: number;
  /** Where the image's bottom-left corner sits on the material (mm). */
  origin: Vec2;
}

/** Douglas–Peucker tolerance (pixels). */
const SIMPLIFY_PX = 0.3;
/** Turns sharper than this (radians) stay corners when smoothing. */
const CORNER_ANGLE = (75 * Math.PI) / 180;

/**
 * Traces `gray` (w × h bytes, row 0 at the top) into the segments of one
 * closed vector, in mm. Returns [] when nothing is traced.
 */
export function traceBitmap(
  gray: Uint8Array,
  w: number,
  h: number,
  options: TraceOptions,
): Segment[] {
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) || gray.length !== w * h) {
    throw new RangeError(`Image is ${gray.length} bytes, expected ${w} × ${h}`);
  }
  if (!(options.pixelSize > 0)) {
    throw new RangeError(`pixelSize must be > 0, got ${options.pixelSize}`);
  }
  const turd = options.turdSize ?? 2;
  const smooth = Math.min(1, Math.max(0, options.smooth ?? 0));

  const rings = contours(gray, w, h, options.threshold, options.invert ?? false)
    .filter((r) => Math.abs(signedArea(r)) >= turd && Math.abs(signedArea(r)) > 0)
    .map((r) => simplifyRing(r, SIMPLIFY_PX))
    .filter((r) => r.length >= 3);

  // Pixel space (x right, y down, image top-left at 0, 0) to mm (Y up).
  const [ox, oy] = options.origin;
  const s = options.pixelSize;
  const toMm = (p: Vec2): [number, number] => [ox + p[0] * s, oy + (h - p[1]) * s];

  const segs: Segment[] = [];
  for (const ring of rings) {
    // Flipping y mirrors the walk: reverse it so outers end up counter-clockwise.
    const mm = ring.map(toMm).reverse();
    if (smooth > 0) segs.push(...fitCurves(mm, smooth));
    else mm.forEach((p, i) => segs.push({ type: i === 0 ? 'move' : 'line', p }));
    segs.push({ type: 'close' });
  }
  return segs;
}

/**
 * Closed contours of the region {v < threshold} in pixel units (y down), where
 * v is the gray value (inverted when `invert`). The image is padded with an
 * outside border so contours touching the edge still close.
 */
function contours(
  gray: Uint8Array,
  w: number,
  h: number,
  threshold: number,
  invert: boolean,
): Vec2[][] {
  // Samples on the padded grid: sample (i, j) is pixel (i − 1, j − 1), centre at (i − ½, j − ½).
  const sw = w + 2;
  const sh = h + 2;
  const v = new Float64Array(sw * sh).fill(255);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const g = gray[j * w + i] as number;
      v[(j + 1) * sw + i + 1] = invert ? 255 - g : g;
    }
  }
  // Crossing level: half a step below the threshold, so a hard 0/255 edge
  // traces exactly halfway between pixel centres (on the pixel boundary).
  const level = threshold - 0.5;
  const inside = (k: number) => (v[k] as number) < threshold;

  // Crossing point on a grid edge, keyed by edge id: horizontal edge from
  // sample k to k + 1 is 2k, vertical edge from k to k + sw is 2k + 1.
  const point = (key: number): Vec2 => {
    const k = key >> 1;
    const k2 = key & 1 ? k + sw : k + 1;
    const a = v[k] as number;
    const b = v[k2] as number;
    const t = (level - a) / (b - a);
    const i = k % sw;
    const j = (k - i) / sw;
    return key & 1 ? [i - 0.5, j - 0.5 + t] : [i - 0.5 + t, j - 0.5];
  };

  // Each cell links an exit crossing to an entry crossing; `next` maps the
  // start edge of a contour piece to its end edge.
  const next = new Map<number, number>();
  for (let j = 0; j < sh - 1; j++) {
    for (let i = 0; i < sw - 1; i++) {
      const tl = j * sw + i;
      const tr = tl + 1;
      const br = tr + sw;
      const bl = tl + sw;
      // Corners clockwise (y down) and the edge between each one and the next.
      const corners = [tl, tr, br, bl];
      const edges = [2 * tl, 2 * tr + 1, 2 * bl, 2 * tl + 1];
      const ins = corners.map(inside);
      const n = ins.filter(Boolean).length;
      if (n === 0 || n === 4) continue;
      // Crossings in clockwise order: exit = inside → outside going clockwise.
      const cross: { key: number; exit: boolean }[] = [];
      for (let e = 0; e < 4; e++) {
        const a = ins[e] as boolean;
        const b = ins[(e + 1) % 4] as boolean;
        if (a !== b) cross.push({ key: edges[e] as number, exit: a });
      }
      // Saddle (two diagonal corners inside): the cell centre decides whether
      // the inside corners join (pair each exit with the next entry) or not.
      const saddle = cross.length === 4;
      const centreIn =
        saddle && corners.reduce((sum, k) => sum + (v[k] as number), 0) / 4 < threshold;
      const m = cross.length;
      cross.forEach((c, idx) => {
        if (!c.exit) return;
        const partner = cross[(idx + (centreIn ? 1 : m - 1)) % m] as { key: number };
        next.set(c.key, partner.key);
      });
    }
  }

  // Chain the pieces into closed loops.
  const out: Vec2[][] = [];
  for (const startKey of next.keys()) {
    if (!next.has(startKey)) continue;
    const ring: Vec2[] = [];
    let key: number | undefined = startKey;
    while (key !== undefined && next.has(key)) {
      ring.push(point(key));
      const to: number = next.get(key) as number;
      next.delete(key);
      key = to;
    }
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}

/** Douglas–Peucker on a closed ring (no repeated end point). */
function simplifyRing(ring: readonly Vec2[], tol: number): Vec2[] {
  const n = ring.length;
  if (n <= 3) return [...ring];
  // Split at the point farthest from the first so both halves are open runs.
  const first = ring[0] as Vec2;
  let far = 0;
  let best = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(p[0] - first[0], p[1] - first[1]);
    if (d > best) {
      best = d;
      far = i;
    }
  });
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const run = (a: number, b: number) => {
    // Indices a..b (b may wrap to n meaning 0).
    const stack: [number, number][] = [[a, b]];
    while (stack.length > 0) {
      const [lo, hi] = stack.pop() as [number, number];
      const pa = ring[lo % n] as Vec2;
      const pb = ring[hi % n] as Vec2;
      let idx = -1;
      let dmax = tol;
      for (let i = lo + 1; i < hi; i++) {
        const d = distToSegment(ring[i % n] as Vec2, pa, pb);
        if (d > dmax) {
          dmax = d;
          idx = i;
        }
      }
      if (idx >= 0) {
        keep[idx % n] = 1;
        stack.push([lo, idx], [idx, hi]);
      }
    }
  };
  run(0, far);
  run(far, n);
  return ring.filter((_, i) => keep[i] === 1);
}

/**
 * Closed Catmull–Rom curve through the ring's points as cubic Béziers; at a
 * sharp corner the tangents follow the neighbouring edges (and an edge between
 * two corners stays a line). `k` scales the tangents (0 = polygon, 1 = full).
 */
function fitCurves(ring: readonly [number, number][], k: number): Segment[] {
  const n = ring.length;
  const at = (i: number) => ring[((i % n) + n) % n] as [number, number];
  const corner = ring.map((p, i) => {
    const a = at(i - 1);
    const b = at(i + 1);
    const ang = Math.abs(
      Math.atan2(
        (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]),
        (p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1]),
      ),
    );
    return ang > CORNER_ANGLE;
  });
  // Tangent handle leaving point i towards i + dir (dir = ±1), at most a third of that edge.
  const handle = (i: number, dir: 1 | -1): [number, number] => {
    const p = at(i);
    const q = at(i + dir);
    const edge = Math.hypot(q[0] - p[0], q[1] - p[1]);
    let tx: number;
    let ty: number;
    if (corner[((i % n) + n) % n]) {
      tx = q[0] - p[0];
      ty = q[1] - p[1];
    } else {
      const a = at(i - 1);
      const b = at(i + 1);
      tx = dir * (b[0] - a[0]);
      ty = dir * (b[1] - a[1]);
    }
    const len = Math.hypot(tx, ty);
    if (len === 0) return p;
    const size = (Math.min(len / 2, edge) * k) / 3;
    return [p[0] + (tx / len) * size, p[1] + (ty / len) * size];
  };

  const segs: Segment[] = [{ type: 'move', p: at(0) }];
  for (let i = 0; i < n; i++) {
    const p = at(i + 1);
    if (corner[i] && corner[(i + 1) % n]) segs.push({ type: 'line', p });
    else segs.push({ type: 'cubic', c1: handle(i, 1), c2: handle(i + 1, -1), p });
  }
  return segs;
}
