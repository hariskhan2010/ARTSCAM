import type { Segment } from '../model/schema';
import { normalize, type Region } from '../vector/clip';
import { flatten } from '../vector/flatten';
import { length, pointAt, transformSegments, type Matrix, type Vec2 } from '../vector/path';
import { toSfnt } from './woff';

/**
 * Text → vectors (plan.md T3.1–T3.2). Shaping is HarfBuzz (WASM), so Arabic
 * and Urdu get correct joining forms, ligatures, mark placement and the
 * Nastaliq cascading baseline. Glyph outlines are united with the nonzero
 * rule (fonts overlap contours freely, Nastaliq especially), giving clean
 * closed regions that CAM can use directly.
 *
 * HarfBuzz is imported lazily so code that never touches text never loads it.
 */

type HB = typeof import('harfbuzzjs');
let hbPromise: Promise<HB> | undefined;
function harfbuzz(): Promise<HB> {
  hbPromise ??= import('harfbuzzjs');
  return hbPromise;
}

export interface LoadedFont {
  name: string;
  /** Font units per em. */
  upem: number;
  ascender: number;
  descender: number;
  lineGap: number;
  /** True when the font maps this code point to a real glyph. */
  has(codePoint: number): boolean;
  /** @internal shaping handle */
  readonly hb: { font: import('harfbuzzjs').Font; hb: HB };
}

/** Loads a TTF, OTF or WOFF font. */
export async function loadFont(bytes: Uint8Array, name = 'Font'): Promise<LoadedFont> {
  const hb = await harfbuzz();
  const face = new hb.Face(new hb.Blob(toSfnt(bytes)), 0);
  const font = new hb.Font(face);
  const ext = font.hExtents();
  return {
    name,
    upem: face.upem,
    ascender: ext.ascender,
    descender: ext.descender,
    lineGap: ext.lineGap,
    has: (cp) => {
      const g = font.nominalGlyph(cp);
      return g !== undefined && g !== 0;
    },
    hb: { font, hb },
  };
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextOptions {
  /** Font size (em height) in mm. */
  size: number;
  /** Fonts tried in order for each character (e.g. Arabic subset, then Latin subset). */
  fonts: readonly LoadedFont[];
  align?: TextAlign;
  /** Multiple of the font's natural line height. Default 1. */
  lineSpacing?: number;
  /** Extra space between glyphs in mm (tracking). Default 0. */
  letterSpacing?: number;
  /** Max deviation (mm) when flattening glyph curves. Default 0.01. */
  tolerance?: number;
  /**
   * Lay the text along this path instead of a straight baseline (T6.8). The
   * text becomes one line; `align` places it at the start, middle or end of
   * the path, and each glyph is turned to follow it, `offset` mm to its left
   * (above a left-to-right path).
   */
  path?: TextPath;
}

export interface TextPath {
  segments: Segment[];
  closed: boolean;
  /** Distance of the baseline from the path, mm (positive: to the left of its direction). */
  offset: number;
  /** Run the text the other way along the path (and onto its other side). Default false. */
  flip?: boolean | undefined;
}

export interface TextLayout {
  /** Clean region: outer rings counter-clockwise, holes clockwise (mm, baseline of line 1 at y = 0). */
  region: Region;
  /** Code points no font could draw. */
  missing: string[];
  /** Width of each line (mm). */
  lineWidths: number[];
  lineHeight: number;
}

/** Right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, NKo, Arabic presentation forms. */
function isRtl(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x08ff) ||
    (cp >= 0xfb1d && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff) ||
    (cp >= 0x10800 && cp <= 0x10fff) ||
    (cp >= 0x1e800 && cp <= 0x1efff)
  );
}

/** Letters decide direction; digits, spaces and punctuation are neutral. */
function strongDir(cp: number): 'rtl' | 'ltr' | undefined {
  if (isRtl(cp)) {
    // Arabic-Indic digits and Arabic punctuation are not strong.
    if ((cp >= 0x0660 && cp <= 0x0669) || (cp >= 0x06f0 && cp <= 0x06f9)) return undefined;
    if (cp === 0x060c || cp === 0x061b || cp === 0x061f || cp === 0x06d4) return undefined;
    return 'rtl';
  }
  const ch = String.fromCodePoint(cp);
  return /\p{L}/u.test(ch) ? 'ltr' : undefined;
}

interface Run {
  text: string;
  font: LoadedFont;
  dir: 'ltr' | 'rtl';
  /** A number: always laid out left to right, even inside right-to-left text. */
  number?: boolean;
}

const isDigit = (ch: string) => /\p{Nd}/u.test(ch);
/** Separators that stay inside a number when followed by a digit, e.g. 1,250.50 or 12:30. */
const NUMBER_SEPARATORS = new Set(['.', ',', ':', '/', '٫', '٬']);

/**
 * Splits a line into runs that share a font and a direction (a simplified
 * Unicode bidi): letters decide direction; digit sequences form their own
 * left-to-right runs; other neutral characters (spaces, punctuation) join the
 * run before them, or the next one at the start of a line.
 */
function itemize(line: string, fonts: readonly LoadedFont[], missing: Set<string>): Run[] {
  const runs: Run[] = [];
  const chars = [...line];
  let pendingNeutral = '';
  chars.forEach((ch, i) => {
    const cp = ch.codePointAt(0) as number;
    const font = fonts.find((f) => f.has(cp));
    if (!font && !/\s/u.test(ch)) missing.add(ch);
    const last = runs.at(-1);

    if (isDigit(ch) || (last?.number && NUMBER_SEPARATORS.has(ch) && isDigit(chars[i + 1] ?? ''))) {
      const f = font ?? last?.font ?? fonts[0];
      if (!f) return;
      if (last?.number && last.font === f) last.text += ch;
      else {
        runs.push({ text: pendingNeutral + ch, font: f, dir: 'ltr', number: true });
        pendingNeutral = '';
      }
      return;
    }

    const dir = strongDir(cp);
    if (!dir) {
      // Neutral: keep with the current run if its font can draw it.
      if (last && (!font || last.font.has(cp) || /\s/u.test(ch))) last.text += ch;
      else if (!last) pendingNeutral += ch;
      else runs.push({ text: ch, font: font ?? last.font, dir: last.dir });
      return;
    }
    const f = font ?? fonts[0];
    if (!f) return;
    if (last && !last.number && last.dir === dir && last.font === f) last.text += ch;
    else runs.push({ text: pendingNeutral + ch, font: f, dir });
    pendingNeutral = '';
  });
  if (pendingNeutral) {
    const f =
      fonts.find((x) => [...pendingNeutral].every((c) => x.has(c.codePointAt(0) as number))) ??
      fonts[0];
    if (f) runs.push({ text: pendingNeutral, font: f, dir: 'ltr' });
  }
  return runs;
}

/** Glyph outline in font units (Y up) → segments, scaled and offset to mm. */
function glyphSegments(
  font: LoadedFont,
  glyph: number,
  scale: number,
  ox: number,
  oy: number,
): Segment[] {
  const cmds = font.hb.font.glyphToJson(glyph);
  const P = (x: number, y: number): [number, number] => [ox + x * scale, oy + y * scale];
  const out: Segment[] = [];
  for (const c of cmds) {
    const v = c.values;
    switch (c.type) {
      case 'M':
        out.push({ type: 'move', p: P(v[0] as number, v[1] as number) });
        break;
      case 'L':
        out.push({ type: 'line', p: P(v[0] as number, v[1] as number) });
        break;
      case 'Q':
        out.push({
          type: 'quad',
          c: P(v[0] as number, v[1] as number),
          p: P(v[2] as number, v[3] as number),
        });
        break;
      case 'C':
        out.push({
          type: 'cubic',
          c1: P(v[0] as number, v[1] as number),
          c2: P(v[2] as number, v[3] as number),
          p: P(v[4] as number, v[5] as number),
        });
        break;
      case 'Z':
        out.push({ type: 'close' });
        break;
    }
  }
  return out;
}

export interface ShapedGlyph {
  font: LoadedFont;
  glyph: number;
  /** Index (in UTF-16 code units) of the first character this glyph came from. */
  cluster: number;
  /** Pen position of the glyph origin, mm, after offsets. */
  x: number;
  y: number;
}

export interface ShapedLine {
  glyphs: ShapedGlyph[];
  /** Advance width of the line (mm). */
  width: number;
  rtl: boolean;
}

/**
 * Shapes one line in visual order (left to right on the page). Runs are
 * shaped separately with their own font and direction; in a right-to-left
 * paragraph the runs are placed right to left.
 */
export function shapeLine(
  line: string,
  fonts: readonly LoadedFont[],
  size: number,
  letterSpacing = 0,
  missing = new Set<string>(),
): ShapedLine {
  const primary = fonts[0];
  if (!primary) throw new RangeError('shapeLine needs at least one font');
  const { hb } = primary.hb;
  const runs = itemize(line, fonts, missing);
  const rtl =
    runs.find((r) => [...r.text].some((c) => strongDir(c.codePointAt(0) as number)))?.dir === 'rtl';
  // Cluster offsets of each run within the line, for reporting clusters line-relative.
  const starts: number[] = [];
  let at = 0;
  for (const r of runs) {
    starts.push(at);
    at += r.text.length;
  }
  const order = rtl ? runs.map((_, i) => runs.length - 1 - i) : runs.map((_, i) => i);
  const glyphs: ShapedGlyph[] = [];
  let x = 0;
  for (const ri of order) {
    const run = runs[ri] as Run;
    const scale = size / run.font.upem;
    const buf = new hb.Buffer();
    buf.addText(run.text);
    buf.guessSegmentProperties();
    buf.setDirection(run.dir === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
    hb.shape(run.font.hb.font, buf);
    for (const g of buf.getGlyphInfosAndPositions()) {
      glyphs.push({
        font: run.font,
        glyph: g.codepoint,
        cluster: (starts[ri] as number) + g.cluster,
        x: x + (g.xOffset ?? 0) * scale,
        y: (g.yOffset ?? 0) * scale,
      });
      x += (g.xAdvance ?? 0) * scale + (g.xAdvance ? letterSpacing : 0);
    }
  }
  return { glyphs, width: Math.max(0, x - (glyphs.length ? letterSpacing : 0)), rtl };
}

/** Lays out text and returns its outline as a clean region. */
export function layoutText(text: string, options: TextOptions): TextLayout {
  const { fonts } = options;
  const primary = fonts[0];
  if (!primary) throw new RangeError('layoutText needs at least one font');
  if (!(options.size > 0)) throw new RangeError('Text size must be > 0');
  const tolerance = options.tolerance ?? 0.01;
  const lineHeight =
    ((primary.ascender - primary.descender + primary.lineGap) / primary.upem) *
    options.size *
    (options.lineSpacing ?? 1);
  const missing = new Set<string>();
  const rings: Vec2[][] = [];
  const lineWidths: number[] = [];

  if (options.path) {
    const shaped = shapeLine(
      text.replace(/\s*[\r\n]+\s*/g, ' '),
      fonts,
      options.size,
      options.letterSpacing ?? 0,
      missing,
    );
    lineWidths.push(shaped.width);
    for (const segs of glyphsOnPath(shaped, options.size, options.path, options.align ?? 'left')) {
      for (const poly of flatten(segs, tolerance, true)) {
        if (poly.points.length >= 3) rings.push(poly.points);
      }
    }
    return { region: normalize(rings, 'nonZero'), missing: [...missing], lineWidths, lineHeight };
  }

  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, li) => {
      const shaped = shapeLine(line, fonts, options.size, options.letterSpacing ?? 0, missing);
      lineWidths.push(shaped.width);
      const align = options.align ?? (shaped.rtl ? 'right' : 'left');
      const shift = align === 'left' ? 0 : align === 'center' ? -shaped.width / 2 : -shaped.width;
      const y = -li * lineHeight;
      for (const g of shaped.glyphs) {
        const segs = glyphSegments(
          g.font,
          g.glyph,
          options.size / g.font.upem,
          g.x + shift,
          g.y + y,
        );
        for (const poly of flatten(segs, tolerance, true)) {
          if (poly.points.length >= 3) rings.push(poly.points);
        }
      }
    });

  return { region: normalize(rings, 'nonZero'), missing: [...missing], lineWidths, lineHeight };
}

/**
 * Glyph outlines placed along a path: each glyph's centre (along the line)
 * goes to its distance along the path, turned to the path's direction there.
 * Past the end of an open path the glyphs continue in a straight line; a
 * closed path wraps around.
 */
function glyphsOnPath(
  shaped: ShapedLine,
  size: number,
  path: TextPath,
  align: TextAlign,
): Segment[][] {
  const L = length(path.segments, path.closed);
  // Open paths: align to their start, middle or end. Closed paths have no ends:
  // align to the point where the text reads level (heading most to the right).
  let anchor = align === 'left' ? 0 : align === 'center' ? L / 2 : L;
  if (path.closed && L > 0) {
    let best = -Infinity;
    for (let k = 0; k < 720; k++) {
      const s = (k / 720) * L;
      const p = pointAt(path.segments, path.flip ? L - s : s, true);
      const heading = p ? (path.flip ? -p.tangent[0] : p.tangent[0]) : -Infinity;
      if (heading > best + 1e-9) {
        best = heading;
        anchor = s;
      }
    }
  }
  const start =
    align === 'left'
      ? path.closed
        ? anchor
        : 0
      : align === 'center'
        ? anchor - shaped.width / 2
        : anchor - shaped.width;
  const at = (along: number) => {
    // Flipped: the same path walked backwards.
    let s = path.flip ? L - along : along;
    if (path.closed && L > 0) s = ((s % L) + L) % L;
    const clamped = Math.min(L, Math.max(0, s));
    const p = pointAt(path.segments, clamped, path.closed);
    if (!p) return undefined;
    // Beyond an open path's ends, carry on along the end tangent.
    const over = s - clamped;
    return {
      point: [p.point[0] + p.tangent[0] * over, p.point[1] + p.tangent[1] * over] as Vec2,
      tangent: (path.flip ? [-p.tangent[0], -p.tangent[1]] : p.tangent) as Vec2,
    };
  };
  const gs = shaped.glyphs;
  return gs.flatMap((g, i) => {
    const next = gs[i + 1];
    const advance = Math.max(0, (next ? next.x : shaped.width) - g.x);
    const mid = g.x + advance / 2;
    const p = at(start + mid);
    if (!p) return [];
    const [tx, ty] = p.tangent;
    // Glyph drawn with its centre at the origin, then turned and moved onto the path.
    const local = glyphSegments(g.font, g.glyph, size / g.font.upem, g.x - mid, g.y);
    const m: Matrix = [
      tx,
      ty,
      -ty,
      tx,
      p.point[0] - ty * path.offset,
      p.point[1] + tx * path.offset,
    ];
    return [transformSegments(local, m)];
  });
}

/** Region rings as one closed vector's segments (outer rings and holes together). */
export function regionToSegments(region: Region): Segment[] {
  const segs: Segment[] = [];
  for (const ring of region) {
    ring.forEach((p, i) => segs.push({ type: i === 0 ? 'move' : 'line', p: [p[0], p[1]] }));
    segs.push({ type: 'close' });
  }
  return segs;
}
