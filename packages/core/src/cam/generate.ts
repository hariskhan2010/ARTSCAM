import { stockBounds } from '../gcode/checker';
import type { Project, Toolpath, Vector } from '../model/schema';
import { PathBuilder } from './builder';
import { chamferContours, chamferDepth, emitChamfer } from './chamfer';
import { drillPoints, emitDrill } from './drill';
import { emitFluting, flutePaths } from './fluting';
import { emitPocket, pocketRegion } from './pocket';
import { emitVcarve } from './vcarve';
import { emitInlay, emitPrism } from './prism';
import { emitFinish3d, emitRough3d, placeRelief } from './relief3d';
import { evaluateRelief, gridRange, type Grid, type ReliefImages } from '../relief/relief';
import { normalize } from '../vector/clip';
import type { Vec2 } from '../vector/path';
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

/** The grid seen after turning the material over about x = width / 2. */
export function mirrorGridX(grid: Grid, width: number): Grid {
  const { cols, rows, resolution: res } = grid;
  const z = new Float32Array(grid.z.length);
  for (let c = 0; c < cols; c++) {
    // Cell whose centre lands on this cell's centre after mirroring (nearest).
    const src = Math.min(cols - 1, Math.max(0, Math.round((width - (c + 0.5) * res) / res - 0.5)));
    for (let r = 0; r < rows; r++) z[r * cols + c] = grid.z[r * cols + src] as number;
  }
  return { ...grid, z };
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

  const depth =
    tp.type === 'chamfer'
      ? chamferDepth(tool, tp.params.width)
      : 'depth' in tp.params
        ? tp.params.depth
        : undefined;
  if (depth !== undefined && depth > project.stock.thickness + 1e-9) {
    warnings.push(
      `Depth ${Math.round(depth * 1000) / 1000} mm is deeper than the stock (${project.stock.thickness} mm); the checker will block export`,
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
    case 'pocket': {
      const restId = tp.params.restFrom;
      const restTool =
        restId === undefined ? undefined : project.tools.find((t) => t.id === restId);
      if (restId !== undefined && !restTool) {
        throw new ToolpathError(`Toolpath ${tp.id} cleans up after unknown tool "${restId}"`);
      }
      emitPocket(
        b,
        pocketRegion(vectors, tolerance, warnings),
        tool,
        tp.params,
        warnings,
        restTool,
      );
      break;
    }
    case 'fluting':
      if (tool.type === 'flat') {
        warnings.push(
          `Fluting needs a ball nose or V-bit; ${toolLabel(tool)} will be rejected by the checker`,
        );
      }
      emitFluting(b, flutePaths(vectors, tolerance), tool, tp.params, warnings);
      break;
    case 'chamfer':
      if (tool.type !== 'vbit') {
        warnings.push(
          `A chamfer needs a V-bit; ${toolLabel(tool)} will be rejected by the checker`,
        );
      }
      emitChamfer(
        b,
        chamferContours(vectors, tp.params, tolerance, warnings),
        tool,
        tp.params,
        warnings,
      );
      break;
    case 'rough3d':
    case 'finish3d': {
      const relief = project.reliefs.find((r) => r.id === tp.relief);
      if (!relief) throw new ToolpathError(`Toolpath ${tp.id} uses unknown relief "${tp.relief}"`);
      // A back relief is cut after turning the material over left to right:
      // mirror the relief and its boundary about the material's centre line.
      const back = relief.side === 'back';
      const W = project.stock.width;
      let grid = evaluateRelief(relief, project, images);
      if (back) {
        grid = mirrorGridX(grid, W);
        warnings.push(
          'Back relief: turn the material over left to right (about its vertical centre line), keep the same X0 Y0 corner, then run this file',
        );
      }
      const pr = placeRelief(grid, topZ, bounds.min[2]);
      const depthOf = (g: Grid) => {
        const r = gridRange(g.z);
        return r.max - r.min;
      };
      const depth = pr.maxH - gridRange(pr.grid.z).min;
      if (depth > project.stock.thickness + 1e-9) {
        warnings.push('The relief is deeper than the material; the checker will block export');
      } else {
        // The other face's relief eats into the same material from below.
        const side = relief.side ?? 'front';
        const other = project.reliefs.filter((r) => (r.side ?? 'front') !== side);
        const otherDepth = Math.max(
          0,
          ...other.map((r) => depthOf(evaluateRelief(r, project, images))),
        );
        if (depth + otherDepth > project.stock.thickness + 1e-9) {
          warnings.push(
            `The front and back reliefs together are ${(depth + otherDepth).toFixed(1)} mm deep in ${project.stock.thickness} mm material: they will cut through where they overlap`,
          );
        }
      }
      let boundary = vectors.length ? pocketRegion(vectors, tolerance, warnings) : undefined;
      if (boundary && back) {
        boundary = normalize(
          boundary.map((ring) => ring.map(([x, y]): Vec2 => [W - x, y])),
          'nonZero',
        );
      }
      if (tp.type === 'finish3d') {
        emitFinish3d(b, pr, tool, tp.params, project.stock.width, project.stock.height, boundary);
      } else {
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
    case 'prism':
    case 'inlay': {
      if (tool.type !== 'vbit') {
        warnings.push(
          `${tp.type === 'prism' ? 'Prism carving' : 'V inlays'} need a V-bit; ${toolLabel(tool)} will be rejected by the checker`,
        );
      }
      const region = pocketRegion(vectors, tolerance, warnings);
      if (tp.type === 'prism') emitPrism(b, region, tool, tp.params, warnings);
      else emitInlay(b, region, tool, tp.params, warnings);
      break;
    }
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
