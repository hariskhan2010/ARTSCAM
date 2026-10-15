import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { booleanOp, normalize, regionArea } from '../vector/clip';
import { signedArea } from '../vector/flatten';
import { arcThrough } from '../vector/edit';
import { bbox } from '../vector/path';
import { ellipse, line } from '../vector/shapes';
import { layoutText, loadFont, regionToSegments, shapeLine, type LoadedFont } from './text';
import { FontFormatError, sniffFont, toSfnt } from './woff';

const require = createRequire(import.meta.url);
const fontFile = (pkg: string, file: string) =>
  new Uint8Array(readFileSync(require.resolve(`${pkg}/files/${file}`)));

let naskh: LoadedFont;
let naskhLatin: LoadedFont;
let nastaliq: LoadedFont;
let nastaliqLatin: LoadedFont;

beforeAll(async () => {
  naskh = await loadFont(
    fontFile('@fontsource/noto-naskh-arabic', 'noto-naskh-arabic-arabic-400-normal.woff'),
    'Naskh',
  );
  naskhLatin = await loadFont(
    fontFile('@fontsource/noto-naskh-arabic', 'noto-naskh-arabic-latin-400-normal.woff'),
    'Naskh Latin',
  );
  nastaliq = await loadFont(
    fontFile('@fontsource/noto-nastaliq-urdu', 'noto-nastaliq-urdu-arabic-400-normal.woff'),
    'Nastaliq',
  );
  nastaliqLatin = await loadFont(
    fontFile('@fontsource/noto-nastaliq-urdu', 'noto-nastaliq-urdu-latin-400-normal.woff'),
    'Nastaliq Latin',
  );
});

const glyphIds = (text: string, fonts: LoadedFont[]) =>
  shapeLine(text, fonts, 10).glyphs.map((g) => g.glyph);

describe('font files', () => {
  it('decodes WOFF to a valid SFNT', () => {
    const woff = fontFile(
      '@fontsource/noto-naskh-arabic',
      'noto-naskh-arabic-arabic-400-normal.woff',
    );
    expect(sniffFont(woff)).toBe('woff');
    const sfnt = toSfnt(woff);
    expect(['ttf', 'otf']).toContain(sniffFont(sfnt));
    expect(toSfnt(sfnt)).toBe(sfnt); // already SFNT: passed through
  });

  it('rejects WOFF2 and non-fonts with a clear message', () => {
    const woff2 = fontFile(
      '@fontsource/noto-naskh-arabic',
      'noto-naskh-arabic-arabic-400-normal.woff2',
    );
    expect(() => toSfnt(woff2)).toThrow(/WOFF2/);
    expect(() => toSfnt(new TextEncoder().encode('hello'))).toThrow(FontFormatError);
  });

  it('reports metrics', () => {
    expect(naskh.upem).toBe(1000);
    expect(naskh.ascender).toBeGreaterThan(0);
    expect(naskh.descender).toBeLessThan(0);
    expect(naskh.has('ب'.codePointAt(0)!)).toBe(true);
    expect(naskh.has('A'.codePointAt(0)!)).toBe(false); // Arabic subset only
  });
});

describe('Arabic / Urdu shaping (T3.1)', () => {
  it('joins letters: initial, medial and final forms differ from the isolated form', () => {
    // Naskh draws beh as a body plus a separate dot glyph.
    const isolated = glyphIds('ب', [naskh]);
    const joined = glyphIds('ببب', [naskh]);
    const dot = isolated.find((g) => joined.filter((j) => j === g).length === 3);
    const bodies = joined.filter((g) => g !== dot);
    const isolatedBody = isolated.filter((g) => g !== dot);
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(3); // initial, medial, final are different glyphs
    for (const b of bodies) expect(isolatedBody).not.toContain(b);
  });

  it('forms the lam-alef ligature instead of isolated letters', () => {
    const lam = glyphIds('ل', [naskh])[0];
    const alef = glyphIds('ا', [naskh])[0];
    const la = glyphIds('لا', [naskh]);
    expect(la).not.toContain(lam);
    expect(la).not.toContain(alef);
  });

  it('places right-to-left text with the first letter on the right', () => {
    const line = shapeLine('سلام', [naskh], 10);
    expect(line.rtl).toBe(true);
    const first = line.glyphs.find((g) => g.cluster === 0)!;
    const last = line.glyphs.reduce((a, b) => (b.cluster > a.cluster ? b : a));
    expect(first.x).toBeGreaterThan(last.x);
  });

  it('Nastaliq uses its cascading baseline (vertical glyph offsets)', () => {
    const line = shapeLine('پاکستان', [nastaliq], 10);
    expect(line.glyphs.some((g) => Math.abs(g.y) > 1e-6)).toBe(true);
  });

  it('falls back to the Latin subset for Latin letters and digits', () => {
    expect(layoutText('ABC 123', { size: 10, fonts: [naskh] }).missing).toEqual([...'ABC123']);
    expect(layoutText('ABC 123', { size: 10, fonts: [naskh, naskhLatin] }).missing).toEqual([]);
  });

  it('mixed Urdu + Latin: numbers stay left-to-right inside a right-to-left line', () => {
    const text = 'پاکستان 2024';
    const line = shapeLine(text, [nastaliq, nastaliqLatin], 10);
    expect(line.rtl).toBe(true);
    const at = (ch: string) => line.glyphs.find((g) => g.cluster === text.indexOf(ch))!;
    // Digits read 2-0-2-4 from left to right…
    expect(at('2').x).toBeLessThan(at('0').x);
    // …and the number sits to the left of the Urdu word that starts the line.
    expect(at('2').x).toBeLessThan(line.glyphs.find((g) => g.cluster === 0)!.x);
  });
});

describe('text layout (T3.2)', () => {
  it('scales with size (em height in mm)', () => {
    const a = bbox(regionToSegments(layoutText('ب', { size: 10, fonts: [naskh] }).region))!;
    const b = bbox(regionToSegments(layoutText('ب', { size: 20, fonts: [naskh] }).region))!;
    expect(b.maxX - b.minX).toBeCloseTo(2 * (a.maxX - a.minX), 1);
    expect(b.maxY - b.minY).toBeCloseTo(2 * (a.maxY - a.minY), 1);
  });

  it('aligns lines: right-to-left text is right-aligned at x = 0 by default', () => {
    const r = bbox(regionToSegments(layoutText('سلام', { size: 20, fonts: [naskh] }).region))!;
    expect(r.maxX).toBeLessThanOrEqual(1e-6 + 2); // side bearing only
    expect(r.minX).toBeLessThan(-10);
    const c = layoutText('سلام', { size: 20, fonts: [naskh], align: 'center' });
    const cb = bbox(regionToSegments(c.region))!;
    expect(cb.minX + cb.maxX).toBeCloseTo(0, 0);
  });

  it('stacks lines downwards by the line height', () => {
    const one = layoutText('ب', { size: 10, fonts: [naskh] });
    const two = layoutText('ب\nب', { size: 10, fonts: [naskh] });
    expect(two.lineWidths).toHaveLength(2);
    const b1 = bbox(regionToSegments(one.region))!;
    const b2 = bbox(regionToSegments(two.region))!;
    expect(b2.minY).toBeCloseTo(b1.minY - two.lineHeight, 3);
  });

  it('gives clean closed regions even where Nastaliq strokes overlap', () => {
    const { region } = layoutText('بسم اللہ الرحمٰن الرحیم', {
      size: 25,
      fonts: [nastaliq, nastaliqLatin],
    });
    expect(region.length).toBeGreaterThan(5);
    expect(regionArea(region)).toBeGreaterThan(0);
    // Already normalised: re-normalising with either fill rule changes nothing.
    const again = normalize(region, 'evenOdd');
    expect(Math.abs(regionArea(booleanOp('xor', region, again, 'nonZero')))).toBeLessThan(1e-3);
    // Outers counter-clockwise, holes clockwise; total area positive.
    expect(region.filter((r) => signedArea(r) > 0).length).toBeGreaterThan(0);
  });

  it('turns a region into one closed vector', () => {
    const { region } = layoutText('لا', { size: 10, fonts: [naskh] });
    const segs = regionToSegments(region);
    expect(segs.filter((s) => s.type === 'move')).toHaveLength(region.length);
    expect(segs.filter((s) => s.type === 'close')).toHaveLength(region.length);
  });
});

describe('text on a curve (T6.8)', () => {
  const circle = (r: number) => ellipse(0, 0, r);

  it('on a straight path it matches straight text placed at the start of the path', () => {
    const path = { segments: line([0, 0], [500, 0]), closed: false, offset: 0 };
    const onPath = layoutText('Naqsh', { size: 20, fonts: [naskhLatin], align: 'left', path });
    const straight = layoutText('Naqsh', { size: 20, fonts: [naskhLatin], align: 'left' });
    const a = bbox(regionToSegments(onPath.region))!;
    const b = bbox(regionToSegments(straight.region))!;
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(a[k]).toBeCloseTo(b[k], 2);
    expect(regionArea(onPath.region)).toBeCloseTo(regionArea(straight.region), 0);
  });

  it('a counter-clockwise circle puts the text inside it; flip puts it outside', () => {
    const R = 60;
    const ring = (flip: boolean) =>
      layoutText('WELCOME', {
        size: 12,
        fonts: [naskhLatin],
        align: 'center',
        path: { segments: circle(R), closed: true, offset: 2, flip },
      }).region.flatMap((r) => r.map((p) => Math.hypot(p[0], p[1])));
    const inside = ring(false);
    expect(Math.max(...inside)).toBeLessThan(R - 2 + 4);
    expect(Math.min(...inside)).toBeGreaterThan(R - 2 - 12);
    // Inside, text reads level along the bottom.
    const insideYs = layoutText('WELCOME', {
      size: 12,
      fonts: [naskhLatin],
      align: 'center',
      path: { segments: circle(R), closed: true, offset: 2 },
    }).region.flatMap((r) => r.map((p) => p[1]));
    expect(Math.max(...insideYs)).toBeLessThan(0);
  });

  it('around a circle (flipped) the letters sit outside it, centred across the top where they read level', () => {
    const R = 60;
    const offset = 2;
    const { region } = layoutText('WELCOME', {
      size: 12,
      fonts: [naskhLatin],
      align: 'center',
      path: { segments: circle(R), closed: true, offset, flip: true },
    });
    // Every outline point lies in the ring from the baseline (R + offset, minus descenders) to the cap height.
    for (const ring of region)
      for (const [x, y] of ring) {
        const d = Math.hypot(x, y);
        expect(d).toBeGreaterThan(R + offset - 4);
        expect(d).toBeLessThan(R + offset + 12);
      }
    // Read clockwise outside the circle, text is level at the top: centred there.
    const xs = region.flatMap((r) => r.map((p) => p[0]));
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(0);
    expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(2); // symmetric
    expect(Math.min(...region.flatMap((r) => r.map((p) => p[1])))).toBeGreaterThan(0);
  });

  it('Urdu follows the curve too, without missing glyphs', () => {
    const { region, missing } = layoutText('خوش آمدید', {
      size: 20,
      fonts: [nastaliq],
      align: 'center',
      path: { segments: arcPath(), closed: false, offset: 0 },
    });
    expect(missing).toEqual([]);
    expect(regionArea(region)).toBeGreaterThan(50);
  });
});

/** An upward arc 200 mm wide, for the Urdu test. */
function arcPath() {
  return arcThrough([-100, 0], [0, 40], [100, 0]);
}
