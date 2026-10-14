import { stockBounds } from '../gcode/checker';
import type { Project, Toolpath, Vector } from '../model/schema';
import { PathBuilder } from './builder';
import { drillPoints, emitDrill } from './drill';
import { emitPocket, pocketRegion } from './pocket';
import { emitProfile, profileContours } from './profile';
import { toolLabel, toolProblems } from './tools';
import type { CamProgram } from './types';

/**
 * Turns a toolpath's stored parameters into moves (plan.md §5 rule 3:
 * toolpaths are derived data, regenerated whenever inputs change).
 */

/** Max deviation (mm) when flattening curves for toolpaths. */
export const CAM_TOLERANCE = 0.005;

export class ToolpathError extends Error {
  override name = 'ToolpathError';
}

export function generateToolpath(
  project: Project,
  toolpathId: string,
  tolerance = CAM_TOLERANCE,
): CamProgram {
  const tp = project.toolpaths.find((t) => t.id === toolpathId);
  if (!tp) throw new ToolpathError(`Unknown toolpath "${toolpathId}"`);
  return generate(project, tp, tolerance);
}

export function generate(project: Project, tp: Toolpath, tolerance = CAM_TOLERANCE): CamProgram {
  const tool = project.tools.find((t) => t.id === tp.tool);
  if (!tool) throw new ToolpathError(`Toolpath ${tp.id} uses unknown tool "${tp.tool}"`);
  const problems = toolProblems(tool).filter((p) => !p.startsWith('Plunge rate'));
  if (problems.length) throw new ToolpathError(`Tool "${toolLabel(tool)}": ${problems.join('; ')}`);

  const vectors = tp.vectors
    .map((id) => project.vectors.find((v) => v.id === id))
    .filter((v): v is Vector => !!v);
  if (vectors.length === 0) throw new ToolpathError(`Toolpath ${tp.id} has no vectors`);

  const bounds = stockBounds(project.stock);
  const topZ = bounds.max[2];
  const safeZ = topZ + project.machine.safeZ;
  const b = new PathBuilder(safeZ, topZ, [bounds.min[0], bounds.min[1]]);
  const warnings: string[] = [];

  if (tp.params.depth > project.stock.thickness + 1e-9) {
    warnings.push(
      `Depth ${tp.params.depth} mm is deeper than the stock (${project.stock.thickness} mm); the checker will block export`,
    );
  }

  switch (tp.type) {
    case 'profile':
      emitProfile(
        b,
        profileContours(vectors, tool, tp.params, tolerance, warnings),
        tool,
        tp.params,
      );
      break;
    case 'pocket':
      emitPocket(b, pocketRegion(vectors, tolerance, warnings), tool, tp.params, warnings);
      break;
    case 'drill':
      if (tool.type === 'vbit' || tool.type === 'ballnose') {
        warnings.push(
          `Drilling with a ${toolLabel(tool)}: holes will be ${tool.type === 'vbit' ? 'conical' : 'round-bottomed'}`,
        );
      }
      emitDrill(b, drillPoints(vectors), tp.params);
      break;
  }

  const moves = b.end();
  if (!moves.some((m) => m.kind !== 'rapid' && m.kind !== 'dwell'))
    warnings.push('This toolpath cuts nothing');
  return {
    name: tp.name ?? `${tp.type} ${tp.id}`,
    operation: tp.type,
    tool,
    moves,
    safeZ,
    topZ,
    warnings,
  };
}
