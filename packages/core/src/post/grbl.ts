import type { CamProgram } from '../cam/types';
import { toolLabel } from '../cam/tools';
import type { Units } from '../model/schema';
import { PRECISION, formatFixed, fromMm, roundTo } from '../model/units';

/**
 * GRBL post-processor (plan.md T2.5). Output uses only what GRBL 1.1 runs:
 * G0/G1/G4, G17/G21/G20/G90/G94/G54, M3/M5/M30, F, S. No canned cycles, no
 * tool change (one tool per file). Units are converted here and nowhere else
 * (plan.md §5 rule 5).
 *
 * Every file produced here must still pass the G-code checker before export.
 */

export interface PostOptions {
  units: Units;
  /** Seconds to wait after M3 for the spindle to reach speed. Default 2; 0 disables. */
  spinUp?: number;
  /** Extra comment lines for the header. */
  notes?: readonly string[];
}

/** Parentheses would end/nest a G-code comment; non-ASCII may upset senders. */
export function commentText(text: string): string {
  return text.replace(/[()]/g, (c) => (c === '(' ? '[' : ']')).replace(/[^\x20-\x7e]/g, '?');
}

export function postGrbl(program: CamProgram, options: PostOptions): string {
  const { units } = options;
  const dec = PRECISION[units].gcode;
  const num = (mm: number) => formatFixed(fromMm(mm, units), dec, true);
  // Z rounds toward the top so rounding never cuts deeper than asked (a
  // through-cut in inches would otherwise land 0.001 mm under the stock).
  const numZ = (mm: number) => {
    const v = fromMm(mm, units);
    let r = roundTo(v, dec);
    if (r < v - 1e-12) r = roundTo(r + 10 ** -dec, dec);
    return formatFixed(r, dec, true);
  };
  const feed = (mmPerMin: number) =>
    formatFixed(fromMm(mmPerMin, units), units === 'mm' ? 0 : 2, true);
  const { tool } = program;
  const spinUp = options.spinUp ?? 2;

  const lines: string[] = [
    `(${commentText(program.name)})`,
    `(Tool: ${commentText(toolLabel(tool, units))}, diameter ${num(tool.diameter)} ${units === 'mm' ? 'mm' : 'in'})`,
    ...(options.notes ?? []).map((n) => `(${commentText(n)})`),
    `${units === 'mm' ? 'G21' : 'G20'} G90 G94 G17`,
    'G54',
    `G0 Z${numZ(program.safeZ)}`,
    `M3 S${formatFixed(tool.rpm, 0)}`,
  ];
  if (spinUp > 0) lines.push(`G4 P${formatFixed(spinUp, 1, true)}`);

  let x: string | undefined;
  let y: string | undefined;
  let z: string | undefined = numZ(program.safeZ);
  let f: string | undefined;
  for (const m of program.moves) {
    if (m.kind === 'dwell') {
      lines.push(`G4 P${formatFixed(m.seconds, 2, true)}`);
      continue;
    }
    const [mx, my, mz] = m.to;
    const nx = num(mx);
    const ny = num(my);
    const nz = numZ(mz);
    let words = '';
    if (nx !== x) words += ` X${nx}`;
    if (ny !== y) words += ` Y${ny}`;
    if (nz !== z) words += ` Z${nz}`;
    if (!words) continue; // rounds to the same position
    x = nx;
    y = ny;
    z = nz;
    if (m.kind === 'rapid') {
      lines.push(`G0${words}`);
    } else {
      const nf = feed(m.kind === 'plunge' ? tool.plunge : tool.feed);
      lines.push(`G1${words}${nf !== f ? ` F${nf}` : ''}`);
      f = nf;
    }
  }
  if (z !== numZ(program.safeZ)) lines.push(`G0 Z${numZ(program.safeZ)}`);
  lines.push('M5', 'M30');
  return lines.join('\n') + '\n';
}
