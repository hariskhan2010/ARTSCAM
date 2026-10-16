import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_JSON_PATH,
  ProjectFileError,
  loadProject,
  saveProject,
  type ProjectBundle,
} from './projectFile';
import { projectSchema, type Project } from './schema';

const fixtureUrl = new URL('../../../../fixtures/projects/sample-project.json', import.meta.url);

function sampleProject(): Project {
  return projectSchema.parse(JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8')));
}

/** Deterministic grid with awkward values: negatives, tiny, large, non-round floats. */
function sampleGrid(n: number): Float32Array {
  const grid = new Float32Array(n);
  for (let i = 0; i < n; i++) grid[i] = Math.sin(i * 0.37) * 6.123456 + (i % 7 === 0 ? -1e-7 : 0);
  grid[0] = 0;
  grid[1] = -18;
  grid[2] = 3.4e38;
  return grid;
}

/** Bit-exact grid comparison (stricter than toEqual, and fast on 1.5M values). */
function expectSameGrid(actual: Float32Array | undefined, expected: Float32Array): void {
  expect(actual).toBeInstanceOf(Float32Array);
  const a = Buffer.from(actual!.buffer, actual!.byteOffset, actual!.byteLength);
  const b = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
  expect(a.equals(b)).toBe(true);
}

function sampleBundle(): ProjectBundle {
  const project = sampleProject();
  const relief = project.reliefs[0]!;
  return { project, reliefData: { [relief.id]: sampleGrid(relief.cols * relief.rows) } };
}

describe('project file round-trip', () => {
  it('save → load is deep-equal (plan.md §6 sample, 1500×1000 relief)', () => {
    const bundle = sampleBundle();
    const loaded = loadProject(saveProject(bundle));
    expect(loaded.project).toEqual(bundle.project);
    expect(Object.keys(loaded.reliefData)).toEqual(['r1']);
    expectSameGrid(loaded.reliefData.r1, bundle.reliefData.r1!);
  });

  it('round-trips float64 coordinates exactly', () => {
    const bundle = sampleBundle();
    const seg = bundle.project.vectors[0]!.segments[1]!;
    if (seg.type !== 'line') throw new Error('fixture changed');
    seg.p = [0.1 + 0.2, 1 / 3];
    const loaded = loadProject(saveProject(bundle));
    expect(loaded.project.vectors[0]!.segments[1]).toEqual({ type: 'line', p: [0.1 + 0.2, 1 / 3] });
  });

  it('round-trips a project with no reliefs and empty collections', () => {
    const project: Project = { ...sampleProject(), vectors: [], reliefs: [], toolpaths: [] };
    expect(loadProject(saveProject({ project, reliefData: {} }))).toEqual({
      project,
      reliefData: {},
      images: {},
      clips: {},
    });
  });

  it('save → load → save produces identical bytes', () => {
    const first = saveProject(sampleBundle());
    const second = saveProject(loadProject(first));
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  it('stores relief grids as little-endian float32 at reliefs/<id>.f32', () => {
    const files = unzipSync(saveProject(sampleBundle()));
    const data = files['reliefs/r1.f32']!;
    expect(data.length).toBe(1500 * 1000 * 4);
    expect(new DataView(data.buffer, data.byteOffset).getFloat32(4, true)).toBe(-18);
  });
});

describe('validation on save', () => {
  it('rejects non-finite heights', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const bundle = sampleBundle();
      bundle.reliefData.r1![12345] = bad;
      expect(() => saveProject(bundle)).toThrow(/non-finite height at index 12345/);
    }
  });

  it('rejects a schema-invalid project', () => {
    const bundle = sampleBundle();
    (bundle.project.stock as { width: number }).width = -5;
    expect(() => saveProject(bundle)).toThrow(ProjectFileError);
  });

  it('rejects missing relief data', () => {
    const bundle = sampleBundle();
    expect(() => saveProject({ ...bundle, reliefData: {} })).toThrow(/Missing height data/);
  });

  it('rejects relief data of the wrong size', () => {
    const bundle = sampleBundle();
    expect(() => saveProject({ ...bundle, reliefData: { r1: new Float32Array(10) } })).toThrow(
      /expected 1500000/,
    );
  });

  it('rejects height data for an unknown relief', () => {
    const bundle = sampleBundle();
    bundle.reliefData.ghost = new Float32Array(1);
    expect(() => saveProject(bundle)).toThrow(/unknown relief "ghost"/);
  });
});

describe('validation on load', () => {
  const zipWith = (json: unknown, extra: Record<string, Uint8Array> = {}) =>
    zipSync({ [PROJECT_JSON_PATH]: strToU8(JSON.stringify(json)), ...extra });
  const noRelief = () => ({ ...sampleProject(), reliefs: [] });

  it('rejects bytes that are not a zip', () => {
    expect(() => loadProject(strToU8('hello'))).toThrow(/Not a valid project zip/);
  });

  it('rejects a zip without project.json', () => {
    expect(() => loadProject(zipSync({ 'other.txt': strToU8('x') }))).toThrow(
      /Missing project.json/,
    );
  });

  it('rejects malformed JSON', () => {
    expect(() => loadProject(zipSync({ [PROJECT_JSON_PATH]: strToU8('{oops') }))).toThrow(
      /not valid JSON/,
    );
  });

  it('rejects a wrong format or version', () => {
    expect(() => loadProject(zipWith({ ...noRelief(), format: 'other' }))).toThrow(
      ProjectFileError,
    );
    expect(() => loadProject(zipWith({ ...noRelief(), version: '9.9' }))).toThrow(ProjectFileError);
  });

  it('rejects unknown keys (typos are not silently dropped)', () => {
    expect(() => loadProject(zipWith({ ...noRelief(), stok: {} }))).toThrow(ProjectFileError);
  });

  it('rejects a missing relief binary', () => {
    expect(() => loadProject(zipWith(sampleProject()))).toThrow(/Missing reliefs\/r1.f32/);
  });

  it('rejects a relief binary of the wrong size', () => {
    const json = sampleProject();
    expect(() => loadProject(zipWith(json, { 'reliefs/r1.f32': new Uint8Array(8) }))).toThrow(
      /expected 1500000/,
    );
    expect(() => loadProject(zipWith(json, { 'reliefs/r1.f32': new Uint8Array(7) }))).toThrow(
      /not a multiple of 4/,
    );
  });

  it('rejects non-finite heights in the relief binary', () => {
    const json = sampleProject();
    json.reliefs[0]!.cols = 2;
    json.reliefs[0]!.rows = 1;
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat32(4, NaN, true);
    expect(() => loadProject(zipWith(json, { 'reliefs/r1.f32': bytes }))).toThrow(
      /non-finite height at index 1/,
    );
  });

  it('ignores extra entries such as thumbnails', () => {
    const bytes = zipWith(noRelief(), { 'thumbnails/preview.png': new Uint8Array([1, 2, 3]) });
    expect(loadProject(bytes).project).toEqual(noRelief());
  });
});

describe('project schema cross-references', () => {
  const issues = (p: unknown) =>
    projectSchema.safeParse(p).error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? [];

  it('accepts the plan.md §6 sample', () => {
    expect(issues(sampleProject())).toEqual([]);
  });

  it('flags duplicate ids', () => {
    const p = sampleProject();
    p.layers.push({ ...p.layers[0]! });
    expect(issues(p)).toContain('layers.1.id: Duplicate id "L1"');
  });

  it('flags dangling references', () => {
    const p = sampleProject();
    p.vectors[0]!.layer = 'nope';
    const op0 = p.reliefs[0]!.ops[0]!;
    if (op0.op === 'fromVector') op0.vector = 'v9';
    p.toolpaths[0]!.tool = 't9';
    p.toolpaths[0]!.vectors = ['v1', 'v8'];
    expect(issues(p)).toEqual([
      'vectors.0.layer: Unknown layer "nope"',
      'reliefs.0.ops.0.vector: Unknown vector "v9"',
      'toolpaths.0.tool: Unknown tool "t9"',
      'toolpaths.0.vectors.1: Unknown vector "v8"',
    ]);
  });

  it('flags a relief data path that does not match its id', () => {
    const p = sampleProject();
    p.reliefs[0]!.data = '../../evil.f32';
    expect(issues(p)).toContain('reliefs.0.data: Relief data must be "reliefs/r1.f32"');
  });

  it('rejects non-finite numbers and non-integer grid sizes', () => {
    const p = sampleProject();
    expect(issues({ ...p, stock: { ...p.stock, width: Infinity } }).length).toBeGreaterThan(0);
    expect(issues({ ...p, reliefs: [{ ...p.reliefs[0]!, cols: 10.5 }] }).length).toBeGreaterThan(0);
  });
});
