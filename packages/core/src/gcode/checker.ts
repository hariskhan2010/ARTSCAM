import type { Machine, Stock, Tool } from '../model/schema';
import { parseGcode, type GcodeProgram, type Move, type ParseOptions } from './parser';

/**
 * G-code safety checker (plan.md §7). Reads the *output text* (via the
 * parser), never the internal model, so post-processor bugs are caught too.
 * Export must be blocked when `ok` is false (CLAUDE.md: never bypass).
 *
 * Coordinates are work coordinates: the stock sits where `stock.origin` and
 * `stock.zZero` say. `machine.safeZ` is a height above the stock top.
 */

export type RuleId =
  | 'parse' // the file has lines the parser rejected
  | 'empty' // no motion at all
  | 'envelope' // outside stock + clearance, or wider than machine travel
  | 'depth' // below stock bottom (minus spoilboard allowance)
  | 'rapid' // G0 below safe Z, or rapid into the stock
  | 'feed' // feed missing or above machine max
  | 'spindle' // cutting with the spindle off or at 0 rpm
  | 'modal' // G20/G21, G90, work coordinates not set up, or units switched
  | 'tool' // tool type does not suit the operation
  | 'preview'; // not simulated yet

export type Operation = 'profile' | 'pocket' | 'drill' | 'vcarve' | 'rough3d' | 'finish3d';

export interface CheckContext {
  machine: Pick<Machine, 'travel' | 'maxFeed' | 'safeZ'>;
  stock: Pick<Stock, 'width' | 'height' | 'thickness' | 'origin' | 'zZero'>;
  /** How far (mm) moves may go outside the stock in X/Y, e.g. tool radius + lead-in. */
  clearance: number;
  /** How far (mm) cuts may go below the stock bottom into the spoilboard. Default 0. */
  spoilboardAllowance?: number;
  /** Whether this toolpath has been simulated at least once (§7 "Preview"). */
  simulated: boolean;
  /** When given, the tool must suit the operation. */
  operation?: Operation;
  tool?: Pick<Tool, 'type'>;
  parse?: ParseOptions;
}

export interface Issue {
  rule: RuleId;
  severity: 'error' | 'warning';
  /** 1-based source line; 0 for whole-file issues. */
  line: number;
  message: string;
}

export interface CheckResult {
  /** True when there are no errors. Export is allowed only when true. */
  ok: boolean;
  issues: Issue[];
  program: GcodeProgram;
}

/** Tool types each operation may use. Operations not listed accept any tool. */
const TOOLS_FOR: Partial<Record<Operation, readonly Tool['type'][]>> = {
  vcarve: ['vbit'],
  finish3d: ['ballnose', 'taperedball'],
};

const EPS = 1e-6;

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/** Stock bounds in work coordinates. */
export function stockBounds(stock: CheckContext['stock']): Box {
  const { width: w, height: h, thickness: t } = stock;
  const x: [number, number] = stock.origin.endsWith('right')
    ? [-w, 0]
    : stock.origin === 'center'
      ? [-w / 2, w / 2]
      : [0, w];
  const y: [number, number] = stock.origin.startsWith('top')
    ? [-h, 0]
    : stock.origin === 'center'
      ? [-h / 2, h / 2]
      : [0, h];
  const z: [number, number] = stock.zZero === 'top' ? [-t, 0] : [0, t];
  return { min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] };
}

export function checkGcode(text: string, context: CheckContext): CheckResult {
  return checkProgram(parseGcode(text, context.parse), context);
}

export function checkProgram(program: GcodeProgram, context: CheckContext): CheckResult {
  if (!(context.clearance >= 0)) throw new RangeError('clearance must be ≥ 0');
  const allowance = context.spoilboardAllowance ?? 0;
  if (!(allowance >= 0)) throw new RangeError('spoilboardAllowance must be ≥ 0');

  const issues: Issue[] = [];
  const add = (
    rule: RuleId,
    line: number,
    message: string,
    severity: Issue['severity'] = 'error',
  ) => issues.push({ rule, severity, line, message });

  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
  const stock = stockBounds(context.stock);
  const stockTop = stock.max[2];
  const floor = stock.min[2] - allowance;
  const safeLevel = stockTop + context.machine.safeZ;
  const xyMin = [stock.min[0] - context.clearance, stock.min[1] - context.clearance];
  const xyMax = [stock.max[0] + context.clearance, stock.max[1] + context.clearance];

  // --- parse ---
  for (const d of program.diagnostics) add('parse', d.line, d.message);

  // --- preview ---
  if (!context.simulated) add('preview', 0, 'Simulate this toolpath before exporting');

  // --- tool ---
  if (context.operation) {
    const allowed = TOOLS_FOR[context.operation];
    if (allowed) {
      if (!context.tool) add('tool', 0, `No tool given for ${context.operation}`);
      else if (!allowed.includes(context.tool.type)) {
        add(
          'tool',
          0,
          `${context.operation} needs a ${allowed.join(' or ')} tool, not ${context.tool.type}`,
        );
      }
    }
  }

  const moves = program.moves;
  if (moves.length === 0) {
    add('empty', 0, 'The program has no moves');
    return finish();
  }

  // --- modal: header must declare units, G90 and work coordinates before the first move ---
  const first = moves[0] as Move;
  if (first.state.units === null)
    add('modal', first.line, 'Units (G21/G20) not set before the first move');
  if (first.state.distance !== 'absolute') {
    add('modal', first.line, 'Absolute mode (G90) not set before the first move');
  }
  if (first.state.workCoordinates === null) {
    add('modal', first.line, 'Work coordinates (G54–G59) not set before the first move');
  }
  const units = first.state.units;
  const switched = moves.find((m) => units !== null && m.state.units !== units);
  if (switched) {
    add(
      'modal',
      switched.line,
      `Units switched from ${units} to ${switched.state.units} mid-program`,
    );
  }

  // --- per-move rules ---
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const move of moves) {
    const cutting = move.type !== 'rapid';
    let envelopeHit = false;
    let depthHit = false;

    for (const p of move.points) {
      p.forEach((v, i) => {
        if (v === null) return;
        lo[i] = Math.min(lo[i] as number, v);
        hi[i] = Math.max(hi[i] as number, v);
      });
      const [x, y, z] = p;
      if (!envelopeHit) {
        const outX =
          x !== null && (x < (xyMin[0] as number) - EPS || x > (xyMax[0] as number) + EPS);
        const outY =
          y !== null && (y < (xyMin[1] as number) - EPS || y > (xyMax[1] as number) + EPS);
        if (outX || outY) {
          envelopeHit = true;
          add(
            'envelope',
            move.line,
            `Move reaches X${fmt(x ?? 0)} Y${fmt(y ?? 0)}, outside the stock plus ${fmt(context.clearance)} mm clearance`,
          );
        }
      }
      if (!depthHit && z !== null && z < floor - EPS) {
        depthHit = true;
        add('depth', move.line, `Z${fmt(z)} is below the lowest allowed Z${fmt(floor)}`);
      }
    }

    if (move.type === 'rapid') {
      const [fx, fy, fz] = move.from;
      const [tx, ty, tz] = move.to;
      const movesXY = fx !== tx || fy !== ty;
      if (movesXY) {
        if (fz === null || tz === null) {
          add('rapid', move.line, 'Rapid XY move before Z is known');
        } else if (Math.min(fz, tz) < safeLevel - EPS) {
          add(
            'rapid',
            move.line,
            `Rapid XY move at Z${fmt(Math.min(fz, tz))}, below safe Z${fmt(safeLevel)}`,
          );
        }
      } else if (tz !== null && tz < stockTop - EPS) {
        add(
          'rapid',
          move.line,
          `Rapid plunge to Z${fmt(tz)}, into the stock (top Z${fmt(stockTop)})`,
        );
      }
    }

    if (cutting) {
      const feed = move.state.feed;
      if (feed === null) add('feed', move.line, 'Cutting move with no feed rate (F) set');
      else if (feed > context.machine.maxFeed + EPS) {
        const plunging = (move.to[2] ?? 0) < (move.from[2] ?? 0);
        add(
          'feed',
          move.line,
          `${plunging ? 'Plunge' : 'Feed'} F${fmt(feed)} exceeds machine max ${fmt(context.machine.maxFeed)} mm/min`,
        );
      }
      if (move.state.spindle === 'off')
        add('spindle', move.line, 'Cutting move with the spindle off');
      else if (!move.state.rpm)
        add('spindle', move.line, 'Cutting move with spindle speed S0 or unset');
    }
  }

  // --- envelope: overall extent must fit machine travel ---
  (['X', 'Y', 'Z'] as const).forEach((axis, i) => {
    const span = (hi[i] as number) - (lo[i] as number);
    const travel = context.machine.travel[i] as number;
    if (Number.isFinite(span) && span > travel + EPS) {
      add('envelope', 0, `${axis} range ${fmt(span)} mm exceeds machine travel ${fmt(travel)} mm`);
    }
  });

  if (program.finalState.spindle !== 'off') {
    add('spindle', 0, 'Spindle is still on at the end of the program (missing M5)', 'warning');
  }

  return finish();

  function finish(): CheckResult {
    issues.sort((a, b) => a.line - b.line);
    return { ok: !issues.some((i) => i.severity === 'error'), issues, program };
  }
}
