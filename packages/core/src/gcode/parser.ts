import type { Units } from '../model/schema';
import { toMm } from '../model/units';

/**
 * G-code parser for the GRBL-style subset our posts emit (plan.md T0.5).
 *
 * It reads output *text* and reconstructs what a controller would do, so the
 * safety checker (T0.6) can judge the file independently of the internal
 * model (plan.md §7). Anything it does not understand is reported as an
 * error rather than guessed at.
 *
 * Output is in millimetres and absolute coordinates whatever G20/G91 say.
 * Arcs (G2/G3, XY plane) are expanded into line segments within a chord
 * tolerance. Within one block, words take effect in GRBL order: units,
 * distance mode, feed, spindle speed, spindle on/off, then motion.
 */

/** A coordinate is null until the program has set it (machine position is unknown at start). */
export type Coord = number | null;
export type Point3 = [Coord, Coord, Coord];

export type DistanceMode = 'absolute' | 'incremental';
export type SpindleState = 'off' | 'cw' | 'ccw';
export type MotionType = 'rapid' | 'linear' | 'arc-cw' | 'arc-ccw';

export interface Word {
  letter: string;
  value: number;
}

export interface Block {
  /** 1-based source line number. */
  line: number;
  /** Source text of the line. */
  text: string;
  /** Words after removing comments, line numbers and checksums. */
  words: Word[];
}

export interface ModalState {
  /** Null until G20/G21 appears: the file never declared its units. */
  units: Units | null;
  /** Null until G90/G91 appears. Absolute is assumed for interpretation. */
  distance: DistanceMode | null;
  /** Feed rate in mm/min; null until an F word appears. */
  feed: number | null;
  spindle: SpindleState;
  /** Spindle speed (S word); null until set. */
  rpm: number | null;
  /** Active work coordinate system, e.g. "G54"; null until set. */
  workCoordinates: string | null;
}

export interface ArcInfo {
  center: [number, number];
  radius: number;
  /** Signed sweep in radians: positive = counter-clockwise. */
  sweep: number;
}

export interface Move {
  line: number;
  type: MotionType;
  from: Point3;
  to: Point3;
  /**
   * Polyline from `from` to `to`, excluding `from` and ending exactly at `to`.
   * One point for rapid/linear moves; the expanded arc otherwise.
   */
  points: Point3[];
  /** Modal state in effect for this move. */
  state: Readonly<ModalState>;
  arc?: ArcInfo;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  line: number;
  severity: Severity;
  message: string;
}

export interface GcodeProgram {
  blocks: Block[];
  moves: Move[];
  diagnostics: Diagnostic[];
  /** State after the last line. */
  finalState: ModalState;
  finalPosition: Point3;
}

export interface ParseOptions {
  /** Max distance (mm) between an arc and its chords. Default 0.01. */
  arcTolerance?: number;
}

const DEFAULT_ARC_TOLERANCE = 0.01;
const ALLOWED_LETTERS = new Set(['G', 'M', 'X', 'Y', 'Z', 'I', 'J', 'K', 'R', 'F', 'S', 'T', 'P']);
/** G codes we accept with no effect on geometry (plane XY, cancels, feed/min, dwell). */
const ACCEPTED_NO_EFFECT_G = new Set([17, 40, 49, 80, 94, 4]);
const PROGRAM_M = new Set([0, 1, 2, 30, 6, 7, 8, 9]);
const WORD_RE = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/y;

/** GRBL's arc radius mismatch rule: error when both limits are exceeded. */
const ARC_RADIUS_ABS_TOL = 0.005;
const ARC_RADIUS_REL_TOL = 0.001;

class BlockError extends Error {}

/** Normalises a G/M number so 0, 00 and 0.0 compare equal and 91.1 stays distinct. */
const codeKey = (value: number) => Math.round(value * 10) / 10;

function stripComments(raw: string): string {
  let out = '';
  let depth = 0;
  for (const ch of raw) {
    if (depth === 0 && ch === ';') break;
    if (ch === '(') {
      if (depth > 0) throw new BlockError('Nested comment');
      depth = 1;
    } else if (ch === ')') {
      if (depth === 0) throw new BlockError('Unmatched ")"');
      depth = 0;
    } else if (depth === 0) {
      out += ch;
    }
  }
  if (depth > 0) throw new BlockError('Unclosed comment "("');
  return out;
}

function tokenize(raw: string): Word[] {
  let text = stripComments(raw).trim();
  const star = text.indexOf('*');
  if (star >= 0) text = text.slice(0, star); // checksum
  if (text === '' || text === '%') return [];
  if (text.startsWith('/')) throw new BlockError('Block delete "/" is not supported');

  const words: Word[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i] as string)) {
      i++;
      continue;
    }
    WORD_RE.lastIndex = i;
    const m = WORD_RE.exec(text);
    if (!m) throw new BlockError(`Unexpected text "${text.slice(i)}"`);
    const letter = (m[1] as string).toUpperCase();
    i = WORD_RE.lastIndex;
    if (letter === 'N') continue; // line number
    const value = Number(m[2]);
    if (!Number.isFinite(value)) throw new BlockError(`Number out of range in "${m[0]}"`);
    words.push({ letter, value });
  }
  return words;
}

const dist2 = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export function parseGcode(text: string, options: ParseOptions = {}): GcodeProgram {
  const arcTolerance = options.arcTolerance ?? DEFAULT_ARC_TOLERANCE;
  if (!(arcTolerance > 0)) throw new RangeError('arcTolerance must be > 0');

  const blocks: Block[] = [];
  const moves: Move[] = [];
  const diagnostics: Diagnostic[] = [];
  const state: ModalState = {
    units: null,
    distance: null,
    feed: null,
    spindle: 'off',
    rpm: null,
    workCoordinates: null,
  };
  let motion: MotionType | null = null;
  let pos: Point3 = [null, null, null];

  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    try {
      const words = tokenize(raw);
      if (words.length === 0) return;
      blocks.push({ line, text: raw, words });
      // A block either applies completely or not at all (GRBL rejects bad blocks whole).
      const result = executeBlock(line, words);
      Object.assign(state, result.state);
      motion = result.motion;
      if (result.move) {
        moves.push(result.move);
        pos = result.move.to;
      }
    } catch (err) {
      if (!(err instanceof BlockError)) throw err;
      diagnostics.push({ line, severity: 'error', message: err.message });
    }
  });

  return { blocks, moves, diagnostics, finalState: { ...state }, finalPosition: pos };

  function executeBlock(
    line: number,
    words: Word[],
  ): { state: ModalState; motion: MotionType | null; move: Move | null } {
    const g: number[] = [];
    const m: number[] = [];
    const params = new Map<string, number>();
    for (const w of words) {
      if (!ALLOWED_LETTERS.has(w.letter)) throw new BlockError(`Unsupported word "${w.letter}"`);
      if (w.letter === 'G') g.push(codeKey(w.value));
      else if (w.letter === 'M') m.push(codeKey(w.value));
      else {
        if (params.has(w.letter)) throw new BlockError(`Repeated "${w.letter}" word`);
        params.set(w.letter, w.value);
      }
    }

    // Classify G codes; collect at most one per modal group.
    let units: Units | undefined;
    let distance: DistanceMode | undefined;
    let newMotion: MotionType | undefined;
    let wcs: string | undefined;
    const once = <T>(current: T | undefined, next: T, group: string): T => {
      if (current !== undefined) throw new BlockError(`Two ${group} codes in one block`);
      return next;
    };
    for (const code of g) {
      if (code === 20 || code === 21) units = once(units, code === 20 ? 'inch' : 'mm', 'units');
      else if (code === 90 || code === 91)
        distance = once(distance, code === 90 ? 'absolute' : 'incremental', 'distance');
      else if (code >= 0 && code <= 3 && Number.isInteger(code))
        newMotion = once(
          newMotion,
          (['rapid', 'linear', 'arc-cw', 'arc-ccw'] as const)[code],
          'motion',
        );
      else if (code >= 54 && code <= 59 && Number.isInteger(code))
        wcs = once(wcs, `G${code}`, 'WCS');
      else if (!ACCEPTED_NO_EFFECT_G.has(code)) throw new BlockError(`Unsupported G${code}`);
    }
    if (g.includes(4) && !params.has('P')) throw new BlockError('G4 dwell needs a P word');

    let spindle: SpindleState | undefined;
    for (const code of m) {
      if (code === 3 || code === 4 || code === 5) {
        spindle = once(spindle, code === 3 ? 'cw' : code === 4 ? 'ccw' : 'off', 'spindle');
      } else if (!PROGRAM_M.has(code)) {
        throw new BlockError(`Unsupported M${code}`);
      }
    }

    // GRBL order: units, distance, WCS, feed, speed, spindle, motion.
    const next: ModalState = { ...state };
    if (units) next.units = units;
    if (distance) next.distance = distance;
    if (wcs) next.workCoordinates = wcs;
    const blockUnits: Units = next.units ?? 'mm';
    const len = (v: number) => toMm(v, blockUnits);

    const f = params.get('F');
    if (f !== undefined) {
      if (!(f > 0)) throw new BlockError(`Feed rate must be > 0, got F${f}`);
      next.feed = len(f);
    }
    const s = params.get('S');
    if (s !== undefined) {
      if (s < 0) throw new BlockError(`Spindle speed must be ≥ 0, got S${s}`);
      next.rpm = s;
    }
    if (spindle) next.spindle = spindle;

    const nextMotion = newMotion ?? motion;
    const done = (move: Move | null) => ({ state: next, motion: nextMotion, move });
    const hasAxis = params.has('X') || params.has('Y') || params.has('Z');
    const hasArcWord = params.has('I') || params.has('J') || params.has('K') || params.has('R');
    if (!hasAxis) {
      if (hasArcWord) throw new BlockError('I/J/K/R given without an axis word');
      return done(null); // e.g. "G21 G90" or a bare "G0" that only sets the mode
    }
    if (g.includes(4)) throw new BlockError('Axis words in a G4 dwell block');
    if (!nextMotion) throw new BlockError('Axis words with no motion mode (G0/G1/G2/G3) active');
    if (params.has('K')) throw new BlockError('K offsets need G18/G19, which are not supported');

    const incremental = next.distance === 'incremental';
    const axis = (letter: 'X' | 'Y' | 'Z', i: 0 | 1 | 2): Coord => {
      const v = params.get(letter);
      if (v === undefined) return pos[i];
      if (!incremental) return len(v);
      const base = pos[i];
      if (base === null) {
        throw new BlockError(`Incremental ${letter} move from an unknown ${letter} position`);
      }
      return base + len(v);
    };
    const to: Point3 = [axis('X', 0), axis('Y', 1), axis('Z', 2)];
    const snapshot = { ...next };

    if (nextMotion === 'rapid' || nextMotion === 'linear') {
      if (hasArcWord) {
        throw new BlockError(`I/J/K/R not allowed with ${nextMotion === 'rapid' ? 'G0' : 'G1'}`);
      }
      return done({ line, type: nextMotion, from: pos, to, points: [to], state: snapshot });
    }
    return done(arcMove(line, nextMotion, params, to, snapshot, len));
  }

  function arcMove(
    line: number,
    type: 'arc-cw' | 'arc-ccw',
    params: Map<string, number>,
    to: Point3,
    snapshot: ModalState,
    len: (v: number) => number,
  ): Move {
    const [sx, sy, sz] = pos;
    const [ex, ey, ez] = to;
    if (sx === null || sy === null || ex === null || ey === null) {
      throw new BlockError('Arc from an unknown X/Y position');
    }
    const cw = type === 'arc-cw';
    let cx: number;
    let cy: number;

    const r = params.get('R');
    if (r !== undefined) {
      if (params.has('I') || params.has('J')) throw new BlockError('Arc has both R and I/J');
      // GRBL's R-format centre: positive R = arc ≤ 180°, negative R = arc > 180°.
      const radius = len(r);
      const x = ex - sx;
      const y = ey - sy;
      const chord = Math.hypot(x, y);
      if (chord === 0) throw new BlockError('R-format arc with identical start and end');
      let disc = 4 * radius * radius - x * x - y * y;
      if (disc < 0) {
        if (Math.abs(radius) - chord / 2 < -ARC_RADIUS_ABS_TOL) {
          throw new BlockError(`Arc radius R${r} is smaller than half the chord`);
        }
        disc = 0;
      }
      let h = -Math.sqrt(disc) / chord;
      if (!cw) h = -h;
      if (radius < 0) h = -h;
      cx = sx + 0.5 * (x - y * h);
      cy = sy + 0.5 * (y + x * h);
    } else {
      if (!params.has('I') && !params.has('J')) throw new BlockError('Arc needs I/J or R');
      cx = sx + len(params.get('I') ?? 0);
      cy = sy + len(params.get('J') ?? 0);
    }

    const radius = dist2(sx, sy, cx, cy);
    const endRadius = dist2(ex, ey, cx, cy);
    const delta = Math.abs(radius - endRadius);
    if (delta > ARC_RADIUS_ABS_TOL && delta > ARC_RADIUS_REL_TOL * radius) {
      throw new BlockError(
        `Arc end is not on the circle (start radius ${radius.toFixed(4)}, end radius ${endRadius.toFixed(4)})`,
      );
    }
    if (radius === 0) throw new BlockError('Arc with zero radius');

    const a0 = Math.atan2(sy - cy, sx - cx);
    const a1 = Math.atan2(ey - cy, ex - cx);
    const fullCircle = dist2(sx, sy, ex, ey) < 1e-9;
    let sweep: number;
    if (fullCircle) {
      sweep = 2 * Math.PI;
    } else {
      sweep = a1 - a0;
      while (sweep <= 0) sweep += 2 * Math.PI;
      while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
    }
    if (cw) sweep = sweep - 2 * Math.PI; // same end angle, clockwise
    if (cw && fullCircle) sweep = -2 * Math.PI;

    // Chord sagitta r(1 - cos(θ/2)) ≤ tolerance.
    const maxStep = radius > arcTolerance ? 2 * Math.acos(1 - arcTolerance / radius) : Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));
    const points: Point3[] = [];
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const a = a0 + sweep * t;
      const z = sz === null || ez === null ? ez : sz + (ez - sz) * t;
      points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a), z]);
    }
    points.push(to);

    return {
      line,
      type,
      from: pos,
      to,
      points,
      state: snapshot,
      arc: { center: [cx, cy], radius, sweep },
    };
  }
}
