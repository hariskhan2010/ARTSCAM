import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Stock, Tool } from '../model/schema';
import { checkGcode, stockBounds, type CheckContext, type Operation, type RuleId } from './checker';

const dir = (sub: string) =>
  fileURLToPath(new URL(`../../../../fixtures/gcode/${sub}/`, import.meta.url));
const listNc = (sub: string) =>
  readdirSync(dir(sub))
    .filter((f) => f.endsWith('.nc'))
    .sort();
const read = (sub: string, name: string) => readFileSync(dir(sub) + name, 'utf8');

/** Default job: plan.md §6 stock and machine. */
const baseContext = (): CheckContext => ({
  machine: { travel: [800, 800, 100], maxFeed: 5000, safeZ: 5 },
  stock: { width: 300, height: 200, thickness: 18, origin: 'bottom-left', zZero: 'top' },
  clearance: 10,
  simulated: true,
});

/** Applies a fixture's "(CONTEXT key=value ...)" line to the default job. */
function contextFor(text: string): CheckContext {
  const ctx = baseContext();
  const m = /\(CONTEXT ([^)]*)\)/.exec(text);
  for (const pair of m?.[1]?.split(/\s+/) ?? []) {
    const [key, value = ''] = pair.split('=');
    if (key === 'origin') ctx.stock.origin = value as Stock['origin'];
    else if (key === 'zZero') ctx.stock.zZero = value as Stock['zZero'];
    else if (key === 'simulated') ctx.simulated = value === 'true';
    else if (key === 'operation') ctx.operation = value as Operation;
    else if (key === 'tool') ctx.tool = { type: value as Tool['type'] };
    else throw new Error(`Unknown CONTEXT key "${key}"`);
  }
  return ctx;
}

function expectation(text: string): { rule: RuleId; line: number } {
  const m = /\(EXPECT rule=(\w+) line=(\d+)\)/.exec(text);
  if (!m) throw new Error('Fixture has no (EXPECT rule=... line=...) comment');
  return { rule: m[1] as RuleId, line: Number(m[2]) };
}

const errorsOf = (text: string, ctx = contextFor(text)) =>
  checkGcode(text, ctx).issues.filter((i) => i.severity === 'error');

describe('safe fixture set', () => {
  const files = listNc('safe');

  it('has fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files)('%s passes with no issues', (name) => {
    const text = read('safe', name);
    const result = checkGcode(text, contextFor(text));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('unsafe fixture set (T0.6 acceptance)', () => {
  const files = listNc('unsafe');

  it('has at least 12 cases covering every rule', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    const rules = new Set(files.map((f) => expectation(read('unsafe', f)).rule));
    const all: RuleId[] = [
      'parse',
      'empty',
      'envelope',
      'depth',
      'rapid',
      'feed',
      'spindle',
      'modal',
      'tool',
      'preview',
    ];
    expect([...rules].sort()).toEqual([...all].sort());
  });

  it.each(files)('%s is blocked by exactly the expected rule', (name) => {
    const text = read('unsafe', name);
    const { rule, line } = expectation(text);
    const result = checkGcode(text, contextFor(text));
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(result.ok).toBe(false);
    expect(new Set(errors.map((e) => e.rule))).toEqual(new Set([rule]));
    expect(errors.map((e) => e.line)).toContain(line);
  });
});

describe('rules in detail', () => {
  const header = 'G21 G90 G17 G54\nM3 S18000\nG0 Z5\nG0 X10 Y10\n';
  const footer = '\nG0 Z5\nM5\nM30';
  const job = (body: string) => header + body + footer;

  it('allows cuts into the spoilboard only within the allowance', () => {
    const text = job('G1 Z-18.5 F300');
    expect(errorsOf(text).map((e) => e.rule)).toEqual(['depth']);
    expect(errorsOf(text, { ...baseContext(), spoilboardAllowance: 0.5 })).toEqual([]);
    expect(errorsOf(text, { ...baseContext(), spoilboardAllowance: 0.4 })).toHaveLength(1);
  });

  it('treats the stock bottom itself as allowed', () => {
    expect(errorsOf(job('G1 Z-18 F300'))).toEqual([]);
  });

  it('measures safe Z from the stock top when Z0 is on the bed', () => {
    const bed = { ...baseContext(), stock: { ...baseContext().stock, zZero: 'bed' as const } };
    // Stock top is Z18, so safe Z is 23: a rapid at Z5 crashes through the stock.
    expect(
      errorsOf('G21 G90 G54\nM3 S1000\nG0 Z5\nG0 X10 Y10\nM5', bed).map((e) => e.rule),
    ).toEqual(expect.arrayContaining(['rapid']));
    expect(errorsOf('G21 G90 G54\nM3 S1000\nG0 Z23\nG0 X10 Y10\nM5', bed)).toEqual([]);
  });

  it('allows a rapid down to just above the stock but not into it', () => {
    expect(errorsOf(job('G0 Z0.5\nG1 Z-1 F300'))).toEqual([]);
    expect(errorsOf(job('G0 Z0\nG1 Z-1 F300'))).toEqual([]);
    expect(errorsOf(job('G0 Z-0.1')).map((e) => e.rule)).toEqual(['rapid']);
  });

  it('flags a diagonal rapid that dips below safe Z', () => {
    expect(errorsOf(job('G0 X50 Y50 Z1')).map((e) => e.rule)).toEqual(['rapid']);
  });

  it('accepts feed exactly at the machine maximum', () => {
    expect(errorsOf(job('G1 Z-1 F300\nG1 X50 F5000'))).toEqual([]);
    expect(errorsOf(job('G1 Z-1 F300\nG1 X50 F5000.01')).map((e) => e.rule)).toEqual(['feed']);
  });

  it('converts inch feeds before comparing with the machine maximum', () => {
    // F200 in/min = 5080 mm/min > 5000.
    const text = 'G20 G90 G54\nM3 S1000\nG0 Z0.2\nG0 X1 Y1\nG1 Z-0.05 F200\nG0 Z0.2\nM5';
    expect(errorsOf(text).map((e) => e.rule)).toEqual(['feed']);
  });

  it('respects each stock origin', () => {
    const at = (origin: Stock['origin'], x: number, y: number) =>
      errorsOf(job(`G1 Z-1 F300\nG1 X${x} Y${y} F1000`).replace('X10 Y10', `X${x} Y${y}`), {
        ...baseContext(),
        stock: { ...baseContext().stock, origin },
      }).map((e) => e.rule);
    const onlyEnvelope = (rules: RuleId[]) =>
      rules.length > 0 && rules.every((r) => r === 'envelope');
    expect(at('bottom-left', 290, 190)).toEqual([]);
    expect(onlyEnvelope(at('bottom-left', -20, 10))).toBe(true);
    expect(at('top-right', -290, -190)).toEqual([]);
    expect(onlyEnvelope(at('top-right', 20, -10))).toBe(true);
    expect(at('center', -140, 90)).toEqual([]);
    expect(onlyEnvelope(at('center', 170, 0))).toBe(true);
    expect(at('top-left', 290, -190)).toEqual([]);
    expect(at('bottom-right', -290, 190)).toEqual([]);
  });

  it('computes stock bounds for every origin and Z zero', () => {
    const s = { width: 300, height: 200, thickness: 18 };
    expect(stockBounds({ ...s, origin: 'bottom-left', zZero: 'top' })).toEqual({
      min: [0, 0, -18],
      max: [300, 200, 0],
    });
    expect(stockBounds({ ...s, origin: 'center', zZero: 'bed' })).toEqual({
      min: [-150, -100, 0],
      max: [150, 100, 18],
    });
    expect(stockBounds({ ...s, origin: 'top-right', zZero: 'top' })).toEqual({
      min: [-300, -200, -18],
      max: [0, 0, 0],
    });
  });

  it('checks the tool only for operations that restrict it', () => {
    const text = job('G1 Z-1 F300');
    const withTool = (operation: Operation, type?: Tool['type']) =>
      errorsOf(text, { ...baseContext(), operation, ...(type ? { tool: { type } } : {}) }).map(
        (e) => e.rule,
      );
    expect(withTool('vcarve', 'vbit')).toEqual([]);
    expect(withTool('vcarve', 'ballnose')).toEqual(['tool']);
    expect(withTool('vcarve')).toEqual(['tool']);
    expect(withTool('finish3d', 'ballnose')).toEqual([]);
    expect(withTool('finish3d', 'flat')).toEqual(['tool']);
    expect(withTool('profile', 'flat')).toEqual([]);
  });

  it('warns (without blocking) when the spindle is left on', () => {
    const result = checkGcode(header + 'G1 Z-1 F300\nG0 Z5', baseContext());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({ rule: 'spindle', severity: 'warning' }),
    ]);
  });

  it('blocks on every parser diagnostic', () => {
    const result = checkGcode(job('G1 Z-1 F300\nG0 A5'), baseContext());
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ rule: 'parse', message: 'Unsupported word "A"' });
  });

  it('rejects invalid context values', () => {
    expect(() => checkGcode('', { ...baseContext(), clearance: -1 })).toThrow(RangeError);
    expect(() => checkGcode('', { ...baseContext(), spoilboardAllowance: -1 })).toThrow(RangeError);
  });

  it('flags the parser fixtures that are not export-ready', () => {
    // arcs.nc circles the origin, reaching X-10 Y-10 (outside a bottom-left stock with
    // 5 mm clearance); messy-format.nc has no G54.
    const tight = { ...baseContext(), clearance: 5 };
    const parent = (n: string) =>
      readFileSync(
        fileURLToPath(new URL(`../../../../fixtures/gcode/${n}`, import.meta.url)),
        'utf8',
      );
    expect(errorsOf(parent('arcs.nc'), tight).map((e) => e.rule)).toContain('envelope');
    expect(errorsOf(parent('messy-format.nc'), baseContext()).map((e) => e.rule)).toContain(
      'modal',
    );
    expect(checkGcode(parent('square-profile.nc'), baseContext()).ok).toBe(true);
  });
});
