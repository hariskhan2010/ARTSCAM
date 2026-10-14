import type { Segment } from '../model/schema';
import { formatFixed } from '../model/units';
import {
  IDENTITY,
  bbox,
  multiply,
  rotation,
  scaling,
  transformSegments,
  translation,
  type Matrix,
} from './path';
import { arcToCubics, ellipse, rectangle } from './shapes';
import { parseXml, type XmlElement } from './xml';

/**
 * SVG import/export (plan.md T1.6).
 *
 * SVG's Y axis points down; ours points up with the origin at the bottom-left
 * of the document, so import flips Y about the document height and export
 * flips it back. Lengths in the file are converted to mm from the root
 * `width`/`height` units and `viewBox`; without units, 1 user unit = 1 CSS px
 * = 1/96 in.
 */

export interface ImportedVector {
  segments: Segment[];
  closed: boolean;
  /** The SVG element id, when it had one. */
  name?: string;
}

export interface SvgImport {
  /** Document size in mm (0 when the file gives none). */
  width: number;
  height: number;
  vectors: ImportedVector[];
  /** Things skipped or approximated (unsupported elements, etc.). */
  warnings: string[];
}

export class SvgError extends Error {}

const PX_MM = 25.4 / 96;
const UNIT_MM: Record<string, number> = {
  '': PX_MM,
  px: PX_MM,
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  q: 0.25,
};

/** Parses an SVG length like "210mm" or "12" into mm (undefined for % or garbage). */
export function parseLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (!m) return undefined;
  const factor = UNIT_MM[(m[2] as string).toLowerCase()];
  return factor === undefined ? undefined : Number(m[1]) * factor;
}

// --- Path data ---------------------------------------------------------------

const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

class PathScanner {
  i = 0;
  constructor(readonly d: string) {}
  skip() {
    while (this.i < this.d.length && /[\s,]/.test(this.d[this.i] as string)) this.i++;
  }
  done() {
    this.skip();
    return this.i >= this.d.length;
  }
  peekCommand(): string | undefined {
    this.skip();
    const ch = this.d[this.i];
    return ch !== undefined && /[MmLlHhVvCcSsQqTtAaZz]/.test(ch) ? ch : undefined;
  }
  number(): number {
    this.skip();
    NUMBER_RE.lastIndex = this.i;
    const m = NUMBER_RE.exec(this.d);
    if (!m) throw new SvgError(`Expected a number at offset ${this.i} in path data`);
    this.i = NUMBER_RE.lastIndex;
    return Number(m[0]);
  }
  flag(): boolean {
    this.skip();
    const ch = this.d[this.i];
    if (ch !== '0' && ch !== '1') throw new SvgError(`Expected an arc flag at offset ${this.i}`);
    this.i++;
    return ch === '1';
  }
}

/**
 * Converts an SVG elliptical arc (endpoint form) to cubics (SVG 1.1 F.6.5),
 * including out-of-range radius correction.
 */
function svgArc(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  large: boolean,
  sweepFlag: boolean,
  x2: number,
  y2: number,
): Segment[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ type: 'line', p: [x2, y2] }];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweepFlag) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const start = angle(1, 0, ux, uy);
  let sweep = angle(ux, uy, vx, vy);
  if (!sweepFlag && sweep > 0) sweep -= 2 * Math.PI;
  else if (sweepFlag && sweep < 0) sweep += 2 * Math.PI;
  const segs = arcToCubics(cx, cy, rx, ry, phi, start, sweep);
  // Land exactly on the requested endpoint.
  const last = segs.at(-1);
  if (last && last.type === 'cubic') last.p = [x2, y2];
  return segs;
}

/** Parses SVG path data into absolute segments (in SVG user space, Y down). */
export function parsePathData(d: string): Segment[] {
  const s = new PathScanner(d);
  const out: Segment[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrl: [number, number] | undefined;
  let lastType = '';
  let cmd: string | undefined;

  while (!s.done()) {
    const next = s.peekCommand();
    if (next) {
      cmd = next;
      s.i++;
    } else if (!cmd || cmd === 'Z' || cmd === 'z') {
      throw new SvgError(`Unexpected "${d[s.i]}" at offset ${s.i} in path data`);
    }
    const c = cmd as string;
    const rel = c === c.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const upper = c.toUpperCase();
    let ctrl: [number, number] | undefined;

    switch (upper) {
      case 'M': {
        x = ox + s.number();
        y = oy + s.number();
        startX = x;
        startY = y;
        out.push({ type: 'move', p: [x, y] });
        cmd = rel ? 'l' : 'L'; // further pairs are implicit lineto
        break;
      }
      case 'L':
        x = ox + s.number();
        y = oy + s.number();
        out.push({ type: 'line', p: [x, y] });
        break;
      case 'H':
        x = ox + s.number();
        out.push({ type: 'line', p: [x, y] });
        break;
      case 'V':
        y = oy + s.number();
        out.push({ type: 'line', p: [x, y] });
        break;
      case 'C': {
        const c1: [number, number] = [ox + s.number(), oy + s.number()];
        const c2: [number, number] = [ox + s.number(), oy + s.number()];
        x = ox + s.number();
        y = oy + s.number();
        out.push({ type: 'cubic', c1, c2, p: [x, y] });
        ctrl = c2;
        break;
      }
      case 'S': {
        const c1: [number, number] =
          lastCtrl && (lastType === 'C' || lastType === 'S')
            ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]]
            : [x, y];
        const c2: [number, number] = [ox + s.number(), oy + s.number()];
        x = ox + s.number();
        y = oy + s.number();
        out.push({ type: 'cubic', c1, c2, p: [x, y] });
        ctrl = c2;
        break;
      }
      case 'Q': {
        const q: [number, number] = [ox + s.number(), oy + s.number()];
        x = ox + s.number();
        y = oy + s.number();
        out.push({ type: 'quad', c: q, p: [x, y] });
        ctrl = q;
        break;
      }
      case 'T': {
        const q: [number, number] =
          lastCtrl && (lastType === 'Q' || lastType === 'T')
            ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]]
            : [x, y];
        x = ox + s.number();
        y = oy + s.number();
        out.push({ type: 'quad', c: q, p: [x, y] });
        ctrl = q;
        break;
      }
      case 'A': {
        const rx = s.number();
        const ry = s.number();
        const rot = s.number();
        const large = s.flag();
        const sweep = s.flag();
        const nx = ox + s.number();
        const ny = oy + s.number();
        out.push(...svgArc(x, y, rx, ry, rot, large, sweep, nx, ny));
        x = nx;
        y = ny;
        break;
      }
      case 'Z':
        out.push({ type: 'close' });
        x = startX;
        y = startY;
        break;
    }
    lastCtrl = ctrl;
    lastType = upper;
  }
  if (out.length > 0 && out[0]?.type !== 'move') {
    throw new SvgError('Path data must start with a moveto');
  }
  return out;
}

// --- Transforms --------------------------------------------------------------

/** Parses an SVG `transform` attribute into a matrix. */
export function parseTransform(text: string | undefined): Matrix {
  if (!text) return IDENTITY;
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const match of text.matchAll(re)) {
    const args = (match[2] as string)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (args.some((a) => !Number.isFinite(a))) throw new SvgError(`Bad transform "${match[0]}"`);
    const [a = 0, b, c] = args;
    let t: Matrix;
    switch (match[1]) {
      case 'matrix':
        if (args.length !== 6) throw new SvgError(`matrix() needs 6 numbers`);
        t = args as unknown as Matrix;
        break;
      case 'translate':
        t = translation(a, b ?? 0);
        break;
      case 'scale':
        t = scaling(a, b ?? a);
        break;
      case 'rotate':
        t = rotation((a * Math.PI) / 180, b ?? 0, c ?? 0);
        break;
      case 'skewX':
        t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = multiply(m, t);
  }
  return m;
}

// --- Import ------------------------------------------------------------------

const SKIP = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'marker',
  'pattern',
  'title',
  'desc',
  'metadata',
  'style',
  'script',
  'linearGradient',
  'radialGradient',
  'filter',
  'sodipodi:namedview',
]);

function styleProp(el: XmlElement, name: string): string | undefined {
  const fromStyle = el.attrs.style
    ?.split(';')
    .map((d) => d.split(':').map((x) => x.trim()))
    .find(([k]) => k === name)?.[1];
  return fromStyle ?? el.attrs[name];
}

const num = (el: XmlElement, name: string, fallback = 0) => {
  const v = el.attrs[name];
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

function pointsAttr(text: string | undefined): [number, number][] {
  const nums = (text ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i] as number, nums[i + 1] as number]);
  return pts;
}

/** Shape segments in user space (Y down), or undefined for non-shape elements. */
function shapeSegments(el: XmlElement): { segments: Segment[]; closed: boolean } | undefined {
  switch (el.name) {
    case 'path': {
      const segments = parsePathData(el.attrs.d ?? '');
      const closed =
        segments.length > 0 &&
        segments.every(
          (s, i) => s.type !== 'move' || i === 0 || segments[i - 1]?.type === 'close',
        ) &&
        segments.at(-1)?.type === 'close';
      return { segments, closed };
    }
    case 'rect': {
      const w = num(el, 'width');
      const h = num(el, 'height');
      if (w <= 0 || h <= 0) return { segments: [], closed: true };
      const rx = el.attrs.rx !== undefined ? num(el, 'rx') : num(el, 'ry');
      return { segments: rectangle(num(el, 'x'), num(el, 'y'), w, h, rx), closed: true };
    }
    case 'circle': {
      const r = num(el, 'r');
      return { segments: r > 0 ? ellipse(num(el, 'cx'), num(el, 'cy'), r) : [], closed: true };
    }
    case 'ellipse': {
      const rx = num(el, 'rx');
      const ry = num(el, 'ry');
      return {
        segments: rx > 0 && ry > 0 ? ellipse(num(el, 'cx'), num(el, 'cy'), rx, ry) : [],
        closed: true,
      };
    }
    case 'line':
      return {
        segments: [
          { type: 'move', p: [num(el, 'x1'), num(el, 'y1')] },
          { type: 'line', p: [num(el, 'x2'), num(el, 'y2')] },
        ],
        closed: false,
      };
    case 'polyline':
    case 'polygon': {
      const pts = pointsAttr(el.attrs.points);
      if (pts.length === 0) return { segments: [], closed: el.name === 'polygon' };
      const segments: Segment[] = pts.map((p, i) => ({ type: i === 0 ? 'move' : 'line', p }));
      if (el.name === 'polygon') segments.push({ type: 'close' });
      return { segments, closed: el.name === 'polygon' };
    }
    default:
      return undefined;
  }
}

export function importSvg(text: string): SvgImport {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (e) {
    throw new SvgError(`Not valid XML: ${(e as Error).message}`);
  }
  if (root.name !== 'svg' && !root.name.endsWith(':svg'))
    throw new SvgError('Root element is not <svg>');

  const warnings: string[] = [];
  const viewBox = root.attrs.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vb =
    viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite) ? viewBox : undefined;
  let widthMm = parseLength(root.attrs.width);
  let heightMm = parseLength(root.attrs.height);

  let user: Matrix = scaling(PX_MM);
  if (vb) {
    const [minX, minY, vbW, vbH] = vb as [number, number, number, number];
    widthMm ??= vbW * PX_MM;
    heightMm ??= vbH * PX_MM;
    if (vbW > 0 && vbH > 0) {
      const sx = widthMm / vbW;
      const sy = heightMm / vbH;
      if (Math.abs(sx - sy) > 1e-9 * Math.max(sx, sy)) {
        warnings.push('viewBox aspect ratio differs from width/height; scaled non-uniformly');
      }
      user = multiply(scaling(sx, sy), translation(-minX, -minY));
    }
  }
  const height = heightMm ?? 0;
  // Flip Y: SVG y (down from the top) → our y (up from the bottom).
  const base = multiply([1, 0, 0, -1, 0, height], user);

  const vectors: ImportedVector[] = [];
  const skipped = new Set<string>();

  const walk = (el: XmlElement, parent: Matrix) => {
    if (SKIP.has(el.name)) return;
    if (styleProp(el, 'display') === 'none' || styleProp(el, 'visibility') === 'hidden') return;
    const m = multiply(parent, parseTransform(el.attrs.transform));
    const shape = shapeSegments(el);
    if (shape) {
      if (shape.segments.length > 0) {
        vectors.push({
          segments: transformSegments(shape.segments, m),
          closed: shape.closed,
          ...(el.attrs.id ? { name: el.attrs.id } : {}),
        });
      }
      return;
    }
    if (el.name === 'g' || el.name === 'a' || el === root) {
      for (const child of el.children) walk(child, m);
      return;
    }
    skipped.add(el.name);
  };
  walk(root, base);

  for (const name of skipped) {
    warnings.push(
      name === 'text'
        ? 'Text was skipped: convert text to paths before exporting the SVG'
        : `Unsupported element <${name}> was skipped`,
    );
  }
  if (heightMm === undefined && vectors.length > 0) {
    // Flipping about Y 0 put everything below the axis; lift it back up.
    const minY = Math.min(...vectors.map((v) => bbox(v.segments)?.minY ?? Infinity));
    for (const v of vectors) v.segments = transformSegments(v.segments, translation(0, -minY));
    warnings.push('No document height: placed shapes with their lowest point at Y 0');
  }
  return { width: widthMm ?? 0, height, vectors, warnings };
}

// --- Export ------------------------------------------------------------------

export interface SvgExportOptions {
  /** Document size in mm. Defaults to the bounding box of the vectors. */
  width?: number;
  height?: number;
  /** Decimal places for coordinates (default 4). */
  decimals?: number;
}

export interface ExportVector {
  segments: readonly Segment[];
  closed?: boolean;
  id?: string;
}

/** Writes vectors as an SVG document in mm (1 user unit = 1 mm). */
export function exportSvg(
  vectors: readonly ExportVector[],
  options: SvgExportOptions = {},
): string {
  let box = { maxX: 0, maxY: 0 };
  for (const v of vectors) {
    const b = bbox(v.segments);
    if (b) box = { maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) };
  }
  const width = options.width ?? box.maxX;
  const height = options.height ?? box.maxY;
  const dec = options.decimals ?? 4;
  const f = (n: number) => formatFixed(n, dec, true);
  const pt = (p: readonly [number, number]) => `${f(p[0])} ${f(height - p[1])}`;

  const paths = vectors.map((v) => {
    const parts = v.segments.map((s) => {
      switch (s.type) {
        case 'move':
          return `M${pt(s.p)}`;
        case 'line':
          return `L${pt(s.p)}`;
        case 'quad':
          return `Q${pt(s.c)} ${pt(s.p)}`;
        case 'cubic':
          return `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.p)}`;
        case 'close':
          return 'Z';
      }
    });
    if (v.closed && v.segments.at(-1)?.type !== 'close') parts.push('Z');
    const id = v.id ? ` id="${v.id.replace(/[<>&"]/g, '_')}"` : '';
    return `  <path${id} d="${parts.join(' ')}"/>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}mm" height="${f(height)}mm" viewBox="0 0 ${f(width)} ${f(height)}">`,
    '<g fill="none" stroke="#000" stroke-width="0.25">',
    ...paths,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
