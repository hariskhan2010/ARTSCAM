import { checkGcode, type CheckResult } from '../gcode/checker';
import type { Project } from '../model/schema';
import { postGrbl } from '../post/grbl';
import { estimateTime, type TimeEstimate } from '../sim/time';
import { generateToolpath } from './generate';
import type { ReliefClips, ReliefImages } from '../relief/relief';
import type { CamProgram } from './types';

/**
 * Export flow (plan.md T2.7): generate → post-process → check the *text* →
 * allow the download only when the checker reports no errors and the
 * toolpath has been simulated (plan.md §7; CLAUDE.md: never bypass).
 */

export interface ExportResult {
  /** True only when the file may be downloaded. */
  ok: boolean;
  gcode: string;
  check: CheckResult;
  program: CamProgram;
  estimate: TimeEstimate;
  /** Suggested file name. */
  fileName: string;
}

export interface ExportOptions {
  /** Has this exact toolpath (current parameters) been simulated? */
  simulated: boolean;
  /** Images used by image reliefs (3D toolpaths). */
  images?: ReliefImages;
  /** Clipart height grids used by pasted clipart (3D toolpaths). */
  clips?: ReliefClips;
}

/** Posts that exist; others are planned for later milestones (plan.md §4). */
export const AVAILABLE_POSTS: readonly Project['machine']['post'][] = [
  'grbl',
  'mach3',
  'linuxcnc',
  'generic',
];

export function exportToolpath(
  project: Project,
  toolpathId: string,
  options: ExportOptions,
): ExportResult {
  const program = generateToolpath(
    project,
    toolpathId,
    undefined,
    options.images ?? {},
    options.clips ?? {},
  );
  if (!AVAILABLE_POSTS.includes(project.machine.post)) {
    throw new Error(`The ${project.machine.post} post-processor is not available yet; choose GRBL`);
  }
  const gcode = postGrbl(program, {
    units: project.units,
    dialect: project.machine.post,
    notes: program.warnings.map((w) => `Note: ${w}`),
  });
  const tool = program.tool;
  const tp = project.toolpaths.find((t) => t.id === toolpathId);
  const allowance = tp && 'allowance' in tp.params ? (tp.params.allowance ?? 0) : 0;
  const check = checkGcode(gcode, {
    machine: project.machine,
    stock: project.stock,
    // The tool centre may sit one radius (plus any allowance) outside a part at the stock edge.
    clearance: tool.diameter / 2 + allowance + 0.01,
    simulated: options.simulated,
    operation: program.operation,
    tool,
  });
  const estimate = estimateTime(check.program, project.machine);
  const safeName = program.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'toolpath';
  return { ok: check.ok, gcode, check, program, estimate, fileName: `${safeName}.nc` };
}

/**
 * Stable key of everything a toolpath's output depends on. The UI records
 * "simulated" against this key, so any edit to the toolpath, its tool, its
 * vectors, the stock or the machine requires a new simulation.
 */
export function toolpathKey(project: Project, toolpathId: string): string {
  const tp = project.toolpaths.find((t) => t.id === toolpathId);
  if (!tp) return '';
  return JSON.stringify({
    tp,
    tool: project.tools.find((t) => t.id === tp.tool),
    vectors: tp.vectors.map((id) => project.vectors.find((v) => v.id === id)),
    relief: 'relief' in tp ? project.reliefs.find((r) => r.id === tp.relief) : undefined,
    reliefVectors:
      'relief' in tp
        ? project.vectors.filter((v) =>
            project.reliefs
              .find((r) => r.id === tp.relief)
              ?.ops.some((o) => o.op === 'fromVector' && o.vector === v.id),
          )
        : undefined,
    stock: project.stock,
    machine: project.machine,
    units: project.units,
  });
}
