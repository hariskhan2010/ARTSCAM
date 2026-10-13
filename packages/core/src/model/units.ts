import type { Units } from './schema';

/**
 * Units and precision rules.
 *
 * Core stores every length in millimetres (float64). Inches exist only at the
 * edges: UI input/display and post-processor output (plan.md §5 rule 5).
 * Feed rates convert with the same factor (mm/min ↔ in/min).
 */

/** Exact by definition (international inch, 1959). */
export const MM_PER_INCH = 25.4;

/** Decimal places per unit: `display` for the UI, `gcode` for post-processor output. */
export const PRECISION: Readonly<Record<Units, { display: number; gcode: number }>> = {
  mm: { display: 3, gcode: 3 },
  inch: { display: 4, gcode: 4 },
};

/** Two lengths closer than this (mm) are treated as equal in geometry checks. */
export const LENGTH_EPSILON_MM = 1e-6;

const MAX_DECIMALS = 10;

/** Far beyond any machine (a light-second is 3e11 mm); keeps toFixed out of exponent notation. */
const MAX_FORMAT_MAGNITUDE = 1e15;

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value))
    throw new RangeError(`${what} must be a finite number, got ${value}`);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`decimals must be an integer 0–${MAX_DECIMALS}, got ${decimals}`);
  }
}

/** Converts a value in `unit` to millimetres. */
export function toMm(value: number, unit: Units): number {
  assertFinite(value, 'value');
  // ×254 then ÷10 rather than ×25.4: 25.4 is not exact in binary, and this
  // gives the correctly rounded result for whole inches and 1/64 fractions.
  return unit === 'mm' ? value : (value * 254) / 10;
}

/** Converts millimetres to `unit`. */
export function fromMm(valueMm: number, unit: Units): number {
  assertFinite(valueMm, 'value');
  // Mirror of toMm: exact for mm values of whole inches and 1/64 fractions.
  return unit === 'mm' ? valueMm : (valueMm * 10) / 254;
}

/** Multiplies by 10^places by editing the decimal exponent, avoiding binary FP error. */
function shift(value: number, places: number): number {
  const [mantissa, exponent = '0'] = String(value).split('e');
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/**
 * Rounds to `decimals` places, half away from zero, using the number's decimal
 * representation (so 1.005 → 1.01 and 2.675 → 2.68, unlike `toFixed`).
 * Never returns -0.
 */
export function roundTo(value: number, decimals: number): number {
  assertFinite(value, 'value');
  assertDecimals(decimals);
  const magnitude = shift(Math.round(shift(Math.abs(value), decimals)), -decimals);
  const result = value < 0 ? -magnitude : magnitude;
  return result === 0 ? 0 : result;
}

/**
 * Formats with exactly `decimals` places (or with trailing zeros removed when
 * `trim` is set). Never prints "-0" or exponent notation.
 */
export function formatFixed(value: number, decimals: number, trim = false): string {
  if (Math.abs(value) >= MAX_FORMAT_MAGNITUDE) {
    throw new RangeError(`value ${value} is too large to format`);
  }
  const rounded = roundTo(value, decimals);
  // roundTo leaves at most `decimals` places, so toFixed only pads with zeros here.
  let text = rounded.toFixed(decimals);
  if (trim && text.includes('.')) text = text.replace(/\.?0+$/, '');
  return text;
}

/** Formats a millimetre length for display in `unit`, e.g. "12.700 mm" or "0.5000 in". */
export function formatLength(valueMm: number, unit: Units): string {
  const text = formatFixed(fromMm(valueMm, unit), PRECISION[unit].display);
  return `${text} ${unit === 'mm' ? 'mm' : 'in'}`;
}

/** Converts a millimetre value to `unit` and rounds it to that unit's G-code precision. */
export function toGcodeUnits(valueMm: number, unit: Units): number {
  return roundTo(fromMm(valueMm, unit), PRECISION[unit].gcode);
}

/** True when two millimetre lengths differ by at most `epsilon`. */
export function nearlyEqual(a: number, b: number, epsilon = LENGTH_EPSILON_MM): boolean {
  assertFinite(a, 'a');
  assertFinite(b, 'b');
  return Math.abs(a - b) <= epsilon;
}
