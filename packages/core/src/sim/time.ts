import type { GcodeProgram } from '../gcode/parser';
import type { Machine } from '../model/schema';

/**
 * Cutting-time estimate (plan.md T2.6), modelled on GRBL's planner:
 * - each line is a block with a nominal speed (F, or the rapid rate for G0),
 *   capped by per-axis max rate;
 * - acceleration is limited per axis (the block gets the smallest
 *   a_axis / |unit_axis|);
 * - corner speed comes from junction deviation, like GRBL's
 *   `$11`; a reversal stops, a straight continuation does not slow down;
 * - the planner only looks `bufferBlocks` ahead, so speed is also limited by
 *   being able to stop within the queued blocks (GRBL's buffer);
 * - every block runs a trapezoid (or triangle) velocity profile;
 * - dwells (G4 P) add their time; the program starts and ends at rest.
 *
 * The estimate reads the G-code text (via the parser), not the internal model.
 */

export interface TimeOptions {
  /** Planner buffer in blocks (GRBL on an Uno: 16). Default 16. */
  bufferBlocks?: number;
}

export interface TimeEstimate {
  /** Total seconds. */
  seconds: number;
  /** Seconds spent on G0. */
  rapidSeconds: number;
  /** Seconds spent on G1/G2/G3. */
  cuttingSeconds: number;
  dwellSeconds: number;
  /** Path lengths (mm). */
  cuttingLength: number;
  rapidLength: number;
}

export const DEFAULT_ACCELERATION: readonly [number, number, number] = [500, 500, 200];
export const DEFAULT_JUNCTION_DEVIATION = 0.01;

interface Block {
  length: number;
  unit: [number, number, number];
  /** Nominal speed, mm/s. */
  nominal: number;
  /** Acceleration along the block, mm/s². */
  accel: number;
  rapid: boolean;
  /** Stop before this block (after a dwell or spindle change). */
  stopBefore: boolean;
}

/** Formats seconds as h:mm:ss or m:ss. */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function estimateTime(
  program: GcodeProgram,
  machine: Pick<Machine, 'maxFeed' | 'rapidFeed' | 'acceleration' | 'junctionDeviation'>,
  options: TimeOptions = {},
): TimeEstimate {
  const accelAxes = machine.acceleration ?? DEFAULT_ACCELERATION;
  const jd = machine.junctionDeviation ?? DEFAULT_JUNCTION_DEVIATION;
  const maxRate = machine.maxFeed / 60;
  const rapidRate = (machine.rapidFeed ?? machine.maxFeed) / 60;
  const buffer = Math.max(2, options.bufferBlocks ?? 16);

  // Dwells, keyed by source line, and lines where the spindle state changes (a full stop).
  const dwellAt = new Map<number, number>();
  for (const b of program.blocks) {
    const g4 = b.words.some((w) => w.letter === 'G' && w.value === 4);
    const p = b.words.find((w) => w.letter === 'P');
    if (g4 && p) dwellAt.set(b.line, p.value);
  }

  const blocks: Block[] = [];
  let dwellSeconds = 0;
  let lastLine = 0;
  let lastSpindle: string | undefined;
  let pendingStop = true;
  const dwellBetween = (from: number, to: number) => {
    let t = 0;
    for (const [line, sec] of dwellAt) if (line > from && line < to) t += sec;
    return t;
  };

  for (const m of program.moves) {
    const d = dwellBetween(lastLine, m.line);
    if (d > 0) {
      dwellSeconds += d;
      pendingStop = true;
    }
    if (lastSpindle !== undefined && m.state.spindle !== lastSpindle) pendingStop = true;
    lastSpindle = m.state.spindle;
    lastLine = m.line;

    let prev = m.from;
    for (const p of m.points) {
      const [fx, fy, fz] = prev;
      const [tx, ty, tz] = p;
      prev = p;
      if (fx === null || fy === null || fz === null || tx === null || ty === null || tz === null)
        continue;
      const dx = tx - fx;
      const dy = ty - fy;
      const dz = tz - fz;
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-9) continue;
      const unit: [number, number, number] = [dx / length, dy / length, dz / length];
      let accel = Infinity;
      unit.forEach((u, i) => {
        if (Math.abs(u) > 1e-12) accel = Math.min(accel, (accelAxes[i] as number) / Math.abs(u));
      });
      const rapid = m.type === 'rapid';
      const feed = rapid ? rapidRate : Math.min((m.state.feed ?? machine.maxFeed) / 60, maxRate);
      blocks.push({
        length,
        unit,
        nominal: Math.min(feed, rapid ? rapidRate : maxRate),
        accel,
        rapid,
        stopBefore: pendingStop,
      });
      pendingStop = false;
    }
  }
  dwellSeconds += dwellBetween(lastLine, Infinity);

  const n = blocks.length;
  // Max entry speed at each junction (between block i-1 and i).
  const vMaxEntry = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const b = blocks[i] as Block;
    if (i === 0 || b.stopBefore) {
      vMaxEntry[i] = 0;
      continue;
    }
    const a = blocks[i - 1] as Block;
    // GRBL: cos θ between the reversed previous direction and the next direction.
    const cos = -(a.unit[0] * b.unit[0] + a.unit[1] * b.unit[1] + a.unit[2] * b.unit[2]);
    let vj: number;
    if (cos > 0.999999)
      vj = 0; // reversal
    else if (cos < -0.999999)
      vj = Infinity; // straight on
    else {
      const sinHalf = Math.sqrt(0.5 * (1 - cos));
      const acc = Math.min(a.accel, b.accel);
      vj = Math.sqrt((acc * jd * sinHalf) / (1 - sinHalf));
    }
    vMaxEntry[i] = Math.min(vj, a.nominal, b.nominal);
  }
  vMaxEntry[n] = 0;

  // Lookahead limit: from block i, the machine must be able to stop within the buffer.
  const suffix = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--)
    suffix[i] = (suffix[i + 1] as number) + (blocks[i] as Block).length;
  const entry = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const end = Math.min(n, i + buffer - 1);
    const queued = (suffix[i] as number) - (suffix[end] as number);
    const acc = (blocks[i] as Block).accel;
    entry[i] = Math.min(vMaxEntry[i] as number, Math.sqrt(2 * acc * queued));
  }
  entry[n] = 0;
  // Backward pass: be able to decelerate into the next junction.
  for (let i = n - 1; i >= 0; i--) {
    const b = blocks[i] as Block;
    entry[i] = Math.min(
      entry[i] as number,
      Math.sqrt((entry[i + 1] as number) ** 2 + 2 * b.accel * b.length),
    );
  }
  // Forward pass: be able to accelerate out of the previous junction.
  for (let i = 0; i < n; i++) {
    const b = blocks[i] as Block;
    entry[i + 1] = Math.min(
      entry[i + 1] as number,
      Math.sqrt((entry[i] as number) ** 2 + 2 * b.accel * b.length),
    );
  }

  let rapidSeconds = 0;
  let cuttingSeconds = 0;
  let rapidLength = 0;
  let cuttingLength = 0;
  for (let i = 0; i < n; i++) {
    const b = blocks[i] as Block;
    const t = trapezoidTime(
      b.length,
      entry[i] as number,
      entry[i + 1] as number,
      b.nominal,
      b.accel,
    );
    if (b.rapid) {
      rapidSeconds += t;
      rapidLength += b.length;
    } else {
      cuttingSeconds += t;
      cuttingLength += b.length;
    }
  }
  return {
    seconds: rapidSeconds + cuttingSeconds + dwellSeconds,
    rapidSeconds,
    cuttingSeconds,
    dwellSeconds,
    rapidLength,
    cuttingLength,
  };
}

/** Time to cover `length` starting at v0, ending at v1, cruising at most `vmax`, with accel `a`. */
export function trapezoidTime(
  length: number,
  v0: number,
  v1: number,
  vmax: number,
  a: number,
): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(a)) return length / vmax;
  // Peak speed reachable with accel then decel inside the block.
  const vPeak = Math.sqrt((2 * a * length + v0 * v0 + v1 * v1) / 2);
  const vc = Math.min(vmax, vPeak);
  const dAcc = Math.max(0, (vc * vc - v0 * v0) / (2 * a));
  const dDec = Math.max(0, (vc * vc - v1 * v1) / (2 * a));
  const cruise = Math.max(0, length - dAcc - dDec);
  return Math.max(0, vc - v0) / a + Math.max(0, vc - v1) / a + cruise / vc;
}
