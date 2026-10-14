import { createHeightmap, exportToolpath, simulate, stockBounds } from '@naqsh/core';
import type { CamRequest, CamResponse } from './protocol';

/**
 * The CAM jobs themselves, free of worker plumbing so they can be unit tested
 * in Node. The worker (cam.worker.ts) just forwards messages here.
 */

const KIND = { rapid: 0, plunge: 1, cut: 2 } as const;

/** Simulation grid budget: plenty for a preview, fast enough to stay interactive. */
const SIM_CELLS = 600_000;

export function handle(req: CamRequest): { response: CamResponse; transfer: Transferable[] } {
  try {
    switch (req.kind) {
      case 'preview': {
        const ex = exportToolpath(req.project, req.toolpathId, {
          simulated: true,
          images: req.images,
        });
        const b = stockBounds(req.project.stock);
        const pts = ex.program.moves.flatMap((m) =>
          m.kind === 'dwell' ? [] : [m.to[0] - b.min[0], m.to[1] - b.min[1], m.to[2], KIND[m.kind]],
        );
        const path = Float64Array.from(pts);
        return {
          response: {
            id: req.id,
            ok: true,
            kind: 'preview',
            result: {
              path,
              seconds: ex.estimate.seconds,
              cuttingLength: ex.estimate.cuttingLength,
              warnings: ex.program.warnings,
              issues: ex.check.issues,
            },
          },
          transfer: [path.buffer],
        };
      }
      case 'simulate': {
        const ex = exportToolpath(req.project, req.toolpathId, {
          simulated: true,
          images: req.images,
        });
        const hm = simulate(
          createHeightmap(req.project.stock, { maxCells: SIM_CELLS }),
          ex.check.program,
          ex.program.tool,
        );
        return {
          response: {
            id: req.id,
            ok: true,
            kind: 'simulate',
            result: { z: hm.z, cols: hm.cols, rows: hm.rows, top: hm.top, bottom: hm.bottom },
          },
          transfer: [hm.z.buffer],
        };
      }
      case 'export': {
        const ex = exportToolpath(req.project, req.toolpathId, {
          simulated: req.simulated,
          images: req.images,
        });
        return {
          response: {
            id: req.id,
            ok: true,
            kind: 'export',
            result: { ok: ex.ok, gcode: ex.gcode, fileName: ex.fileName, issues: ex.check.issues },
          },
          transfer: [],
        };
      }
    }
  } catch (e) {
    return { response: { id: req.id, ok: false, error: (e as Error).message }, transfer: [] };
  }
}
