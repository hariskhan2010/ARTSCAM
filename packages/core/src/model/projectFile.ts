import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { projectSchema, type Project } from './schema';

/**
 * Project file = .zip with `project.json` + one little-endian Float32 grid per
 * relief at `reliefs/<id>.f32` (plan.md §6). Other entries (e.g. thumbnails)
 * are ignored on load.
 */

export const PROJECT_JSON_PATH = 'project.json';

/** Earliest DOS timestamp; local time, so a constant per machine. */
const ZIP_MTIME = new Date(1980, 0, 1);

/** A project document plus the binary height grids it refers to, keyed by relief id. */
export interface ProjectBundle {
  project: Project;
  reliefData: Record<string, Float32Array>;
  /** Grayscale images (one byte per pixel, rows top to bottom) used by image reliefs, by id. */
  images?: Record<string, Uint8Array>;
}

/** Location of a relief image in the project zip. */
export function imagePath(id: string): string {
  return `images/${id}.gray`;
}

function checkImages(project: Project, images: Record<string, Uint8Array>): void {
  for (const relief of project.reliefs) {
    for (const op of relief.ops) {
      if (op.op !== 'fromImage') continue;
      const img = images[op.image];
      if (!img)
        throw new ProjectFileError(`Missing image "${op.image}" used by relief "${relief.id}"`);
      if (img.length !== op.px * op.py) {
        throw new ProjectFileError(
          `Image "${op.image}" has ${img.length} pixels, expected ${op.px * op.py}`,
        );
      }
    }
  }
}

export class ProjectFileError extends Error {
  override name = 'ProjectFileError';
}

function validate(value: unknown, when: 'load' | 'save'): Project {
  const result = projectSchema.safeParse(value);
  if (!result.success) {
    throw new ProjectFileError(`Invalid project on ${when}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function checkReliefData(project: Project, reliefData: Record<string, Float32Array>): void {
  for (const relief of project.reliefs) {
    const grid = reliefData[relief.id];
    if (!grid) throw new ProjectFileError(`Missing height data for relief "${relief.id}"`);
    const expected = relief.cols * relief.rows;
    if (grid.length !== expected) {
      throw new ProjectFileError(
        `Relief "${relief.id}" has ${grid.length} values, expected ${expected} (${relief.cols}×${relief.rows})`,
      );
    }
    for (let i = 0; i < grid.length; i++) {
      if (!Number.isFinite(grid[i])) {
        throw new ProjectFileError(`Relief "${relief.id}" has a non-finite height at index ${i}`);
      }
    }
  }
  for (const key of Object.keys(reliefData)) {
    if (!project.reliefs.some((r) => r.id === key)) {
      throw new ProjectFileError(`Height data given for unknown relief "${key}"`);
    }
  }
}

function float32ToLE(grid: Float32Array): Uint8Array {
  const bytes = new Uint8Array(grid.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < grid.length; i++) view.setFloat32(i * 4, grid[i] as number, true);
  return bytes;
}

function float32FromLE(bytes: Uint8Array): Float32Array {
  const grid = new Float32Array(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < grid.length; i++) grid[i] = view.getFloat32(i * 4, true);
  return grid;
}

/** Validates the bundle and encodes it as project .zip bytes. */
export function saveProject(bundle: ProjectBundle): Uint8Array {
  const project = validate(bundle.project, 'save');
  checkReliefData(project, bundle.reliefData);
  const images = bundle.images ?? {};
  checkImages(project, images);

  const files: Zippable = {
    [PROJECT_JSON_PATH]: strToU8(JSON.stringify(project, null, 2)),
  };
  for (const relief of project.reliefs) {
    // Checked above: every relief has data. Grids are stored uncompressed:
    // deflate takes 1–3 s on a 1500×1000 grid for at most a 2× size saving.
    files[relief.data] = [float32ToLE(bundle.reliefData[relief.id] as Float32Array), { level: 0 }];
  }
  // Fixed entry timestamps make saves byte-for-byte deterministic (the file
  // system already records when the project was saved).
  for (const [id, bytes] of Object.entries(images)) files[imagePath(id)] = bytes;
  return zipSync(files, { mtime: ZIP_MTIME });
}

/** Decodes project .zip bytes and validates the result. */
export function loadProject(bytes: Uint8Array): ProjectBundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (err) {
    throw new ProjectFileError(`Not a valid project zip: ${(err as Error).message}`);
  }

  const jsonBytes = files[PROJECT_JSON_PATH];
  if (!jsonBytes) throw new ProjectFileError(`Missing ${PROJECT_JSON_PATH}`);

  let json: unknown;
  try {
    json = JSON.parse(strFromU8(jsonBytes));
  } catch (err) {
    throw new ProjectFileError(`${PROJECT_JSON_PATH} is not valid JSON: ${(err as Error).message}`);
  }
  const project = validate(json, 'load');

  const reliefData: Record<string, Float32Array> = {};
  for (const relief of project.reliefs) {
    const data = files[relief.data];
    if (!data) throw new ProjectFileError(`Missing ${relief.data}`);
    if (data.length % 4 !== 0) {
      throw new ProjectFileError(`${relief.data} length ${data.length} is not a multiple of 4`);
    }
    reliefData[relief.id] = float32FromLE(data);
  }
  checkReliefData(project, reliefData);

  const images: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    const m = /^images\/(.+)\.gray$/.exec(path);
    if (m) images[m[1] as string] = bytes;
  }
  checkImages(project, images);

  return { project, reliefData, images };
}
