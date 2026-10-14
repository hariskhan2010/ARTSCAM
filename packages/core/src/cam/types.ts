import type { Operation } from '../gcode/checker';
import type { Tool } from '../model/schema';

/**
 * Toolpath moves, between generation and post-processing. Coordinates are
 * work coordinates in mm (stock origin and Z zero already applied), so a
 * post-processor only formats them.
 */

export type Vec3 = readonly [number, number, number];

/**
 * - rapid: G0, only at safe Z or straight up/down above the stock
 * - plunge: G1 at the tool's plunge rate (descending into material)
 * - cut: G1 at the tool's feed rate (including ramps and tab lifts)
 * - dwell: pause in place (`seconds`)
 */
export type CamMove =
  { kind: 'rapid' | 'plunge' | 'cut'; to: Vec3 } | { kind: 'dwell'; seconds: number };

export interface CamProgram {
  name: string;
  operation: Operation;
  tool: Tool;
  moves: CamMove[];
  /** Absolute Z of safe travel height (stock top + machine safe Z). */
  safeZ: number;
  /** Absolute Z of the stock top. */
  topZ: number;
  /** Non-fatal notes, e.g. "vector v3 is open; profiled on the line". */
  warnings: string[];
}
