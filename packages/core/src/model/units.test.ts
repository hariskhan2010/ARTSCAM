import { describe, expect, it } from 'vitest';
import {
  LENGTH_EPSILON_MM,
  MM_PER_INCH,
  PRECISION,
  formatFixed,
  formatLength,
  fromMm,
  nearlyEqual,
  roundTo,
  toGcodeUnits,
  toMm,
} from './units';

describe('toMm / fromMm', () => {
  it('converts exact reference values', () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(toMm(1, 'inch')).toBe(25.4);
    expect(fromMm(25.4, 'inch')).toBe(1);
    expect(toMm(12, 'inch')).toBe(304.8);
    expect(fromMm(304.8, 'inch')).toBe(12);
  });

  it('is the identity for mm', () => {
    expect(toMm(0.1 + 0.2, 'mm')).toBe(0.1 + 0.2);
    expect(fromMm(-3.25, 'mm')).toBe(-3.25);
  });

  it('round-trips within float64 precision', () => {
    for (const v of [0, 1e-9, 0.1, 1 / 3, 2.54, 17.123456789, 1219.2, -0.0254, 99999.9999]) {
      expect(fromMm(toMm(v, 'inch'), 'inch')).toBeCloseTo(v, 12);
      expect(toMm(fromMm(v, 'inch'), 'inch')).toBeCloseTo(v, 12);
    }
  });

  it('is exact for every 1/64 inch up to 2000 in (where ×25.4 is not)', () => {
    // Reference: k/64 in = k·254/640 mm, a terminating decimal computed exactly with BigInt.
    const exactMm = (k: number) => {
      const digits = ((BigInt(k) * 254n * 10n ** 12n) / 640n).toString().padStart(13, '0');
      return Number(`${digits.slice(0, -12)}.${digits.slice(-12)}`);
    };
    let naiveWrong = 0;
    for (let k = 0; k <= 64 * 2000; k++) {
      const mm = exactMm(k);
      if ((k / 64) * MM_PER_INCH !== mm) naiveWrong++;
      if (toMm(k / 64, 'inch') !== mm)
        expect.fail(`toMm(${k}/64 in) = ${toMm(k / 64, 'inch')}, want ${mm}`);
      if (fromMm(mm, 'inch') !== k / 64)
        expect.fail(`fromMm(${mm} mm) = ${fromMm(mm, 'inch')}, want ${k}/64`);
    }
    expect(naiveWrong).toBeGreaterThan(40000); // why the naive formula is not used
  });

  it('leaves float error on other values for precision rules to absorb', () => {
    expect(toMm(0.017, 'inch')).toBe(0.4318000000000001);
    expect(toGcodeUnits(toMm(0.017, 'inch'), 'mm')).toBe(0.432);
    expect(formatLength(toMm(0.017, 'inch'), 'inch')).toBe('0.0170 in');
  });

  it('rejects non-finite input', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => toMm(bad, 'inch')).toThrow(RangeError);
      expect(() => fromMm(bad, 'mm')).toThrow(RangeError);
    }
  });
});

describe('roundTo', () => {
  it('rounds half away from zero on decimal values that toFixed gets wrong', () => {
    expect((1.005).toFixed(2)).toBe('1.00'); // the bug being avoided
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(roundTo(1.0005, 3)).toBe(1.001);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(0.0005, 3)).toBe(0.001);
  });

  it('rounds down below the half', () => {
    expect(roundTo(1.0049999, 2)).toBe(1);
    expect(roundTo(-0.00049, 3)).toBe(0);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundTo(-0.0004, 3), 0)).toBe(true);
    expect(Object.is(roundTo(-0, 2), 0)).toBe(true);
  });

  it('handles values printed in exponent notation', () => {
    expect(roundTo(1e-7, 3)).toBe(0);
    expect(roundTo(5e-7, 6)).toBe(0.000001);
    expect(roundTo(1.23456e-5, 7)).toBe(0.0000123);
    expect(roundTo(1e21, 2)).toBe(1e21);
  });

  it('leaves already-representable values unchanged', () => {
    for (const v of [0, 1, 25.4, 0.125, 123.456, -7.5]) expect(roundTo(v, 3)).toBe(v);
  });

  it('rejects bad decimals and non-finite values', () => {
    expect(() => roundTo(1, -1)).toThrow(RangeError);
    expect(() => roundTo(1, 1.5)).toThrow(RangeError);
    expect(() => roundTo(1, 11)).toThrow(RangeError);
    expect(() => roundTo(NaN, 2)).toThrow(RangeError);
  });
});

describe('formatFixed', () => {
  it('pads to the requested places', () => {
    expect(formatFixed(12.7, 3)).toBe('12.700');
    expect(formatFixed(1.005, 2)).toBe('1.01');
    expect(formatFixed(2, 0)).toBe('2');
  });

  it('trims trailing zeros when asked', () => {
    expect(formatFixed(1.5, 3, true)).toBe('1.5');
    expect(formatFixed(2, 3, true)).toBe('2');
    expect(formatFixed(100, 3, true)).toBe('100');
    expect(formatFixed(0.0004, 3, true)).toBe('0');
  });

  it('never prints "-0" or exponent notation', () => {
    expect(formatFixed(-0.0004, 3)).toBe('0.000');
    expect(formatFixed(-0.0004, 3, true)).toBe('0');
    expect(formatFixed(1e-7, 4)).toBe('0.0000');
    expect(formatFixed(123456789012.3456, 3)).toBe('123456789012.346');
  });

  it('refuses magnitudes too large to print plainly', () => {
    expect(() => formatFixed(1e21, 3)).toThrow(RangeError);
  });
});

describe('formatLength', () => {
  it('formats in the display unit with its precision', () => {
    expect(formatLength(12.7, 'mm')).toBe('12.700 mm');
    expect(formatLength(12.7, 'inch')).toBe('0.5000 in');
    expect(formatLength(toMm(0.1, 'inch'), 'inch')).toBe('0.1000 in');
    expect(formatLength(-0.00001, 'mm')).toBe('0.000 mm');
  });
});

describe('toGcodeUnits', () => {
  it('uses 3 decimals for mm and 4 for inch (0.001 mm / 0.0001 in resolution)', () => {
    expect(PRECISION).toEqual({ mm: { display: 3, gcode: 3 }, inch: { display: 4, gcode: 4 } });
  });

  it('converts and rounds to G-code precision', () => {
    expect(toGcodeUnits(25.4, 'inch')).toBe(1);
    expect(toGcodeUnits(10, 'inch')).toBe(0.3937);
    expect(toGcodeUnits(1.23456, 'mm')).toBe(1.235);
    expect(toGcodeUnits(toMm(0.1, 'inch'), 'mm')).toBe(2.54);
  });

  it('converts feed rates with the same factor', () => {
    expect(toGcodeUnits(1200, 'inch')).toBe(47.2441); // 1200 mm/min → in/min
  });
});

describe('nearlyEqual', () => {
  it('compares within the default epsilon', () => {
    expect(nearlyEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(nearlyEqual(1, 1 + LENGTH_EPSILON_MM)).toBe(true);
    expect(nearlyEqual(1, 1 + 2 * LENGTH_EPSILON_MM)).toBe(false);
    expect(nearlyEqual(1, 1.05, 0.1)).toBe(true);
  });

  it('rejects non-finite input', () => {
    expect(() => nearlyEqual(NaN, NaN)).toThrow(RangeError);
  });
});
