import { stockBounds } from '../gcode/checker';
import type { Project, Toolpath, Vector } from '../model/schema';
import { PathBuilder } from './builder';
import { drillPoints, emitDrill } from './drill';
import { emitPocket, pocketRegion } from './pocket';
import { emitVcarve } from './vcarve';
import { emitFinish3d, emitRough3d, placeRelief } from './relief3d';
import { evaluateRelief, gridRange, type ReliefImages } from '../relief/relief';
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
  images: ReliefImages = {},
): CamProgram {
  const tp = project.toolpaths.find((t) => t.id === toolpathId);
  if (!tp) throw new ToolpathError(`Unknown toolpath "${toolpathId}"`);
  return generate(project, tp, tolerance, images);
}

export function generate(
  project: Project,
  tp: Toolpath,
  tolerance = CAM_TOLERANCE,
  images: ReliefImages = {},
): CamProgram {
  const tool = project.tools.find((t) => t.id === tp.tool);
  if (!tool) throw new ToolpathError(`Toolpath ${tp.id} uses unknown tool "${tp.tool}"`);
  const problems = toolProblems(tool).filter((p) => !p.startsWith('Plunge rate'));
  if (problems.length) throw new ToolpathError(`Tool "${toolLabel(tool)}": ${problems.join('; ')}`);

  const vectors = tp.vectors
    .map((id) => project.vectors.find((v) => v.id === id))
    .filter((v): v is Vector => !!v);
  const is3d = tp.type === 'rough3d' || tp.type === 'finish3d';
  if (vectors.length === 0 && !is3d) throw new ToolpathError(`Toolpath ${tp.id} has no vectors`);

  const bounds = stockBounds(project.stock);
  const topZ = bounds.max[2];
  const safeZ = topZ + project.machine.safeZ;
  const b = new PathBuilder(safeZ, topZ, [bounds.min[0], bounds.min[1]]);
  const warnings: string[] = [];

  if ('depth' in tp.params && tp.params.depth > project.stock.thickness + 1e-9) {
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
    case 'rough3d':
    case 'finish3d': {
      const relief = project.reliefs.find((r) => r.id === tp.relief);
      if (!relief) throw new ToolpathError(`Toolpath ${tp.id} uses unknown relief "${tp.relief}"`);
      const pr = placeRelief(evaluateRelief(relief, project, images), topZ, bounds.min[2]);
      if (pr.maxH - gridRange(pr.grid.z).min > project.stock.thickness + 1e-9) {
        warnings.push('The relief is deeper than the material; the checker will block export');
      }
      if (tp.type === 'finish3d') {
        emitFinish3d(b, pr, tool, tp.params, project.stock.width, project.stock.height);
      } else {
        const boundary = vectors.length ? pocketRegion(vectors, tolerance, warnings) : undefined;
        emitRough3d(
          b,
          pr,
          tool,
          tp.params,
          project.stock.width,
          project.stock.height,
          boundary,
          warnings,
        );
      }
      break;
    }
    case 'vcarve':
      if (tool.type !== 'vbit') {
        warnings.push(
          `V-carving needs a V-bit; ${toolLabel(tool)} will be rejected by the checker`,
        );
      }
      emitVcarve(b, pocketRegion(vectors, tolerance, warnings), tool, tp.params, warnings);
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
