import {
  addRelief,
  addTool,
  addToolpath,
  addVectors,
  ellipse,
  exportToolpath,
  layoutText,
  loadFont,
  newProject,
  projectSchema,
  rectangle,
  regionToSegments,
  setReliefOp,
  TOOL_PRESETS,
  transformSegments,
  translation,
  type Project,
  type Segment,
} from '@naqsh/core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAMPLES } from './index';

/**
 * Sample projects (plan.md T7.2). They are built here from code, stored as
 * project JSON next to this file, and bundled into the app (so they work
 * offline). Rebuild after an intended change with UPDATE_SAMPLES=1 and review
 * the diff; otherwise this test only checks the stored files.
 */

const require = createRequire(import.meta.url);
const preset = (name: string) => {
  const t = TOOL_PRESETS.find((p) => p.name === name);
  if (!t) throw new Error(`No preset ${name}`);
  return t;
};
const line = (pts: [number, number][]): Segment[] => [
  { type: 'move', p: pts[0] as [number, number] },
  ...pts.slice(1).map((p): Segment => ({ type: 'line', p })),
];

/** House sign: cut-out with tabs, a recessed panel, four mounting holes. */
function sign(): Project {
  let p = newProject({
    stock: { width: 300, height: 150, thickness: 18, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([
    { id: 'outline', layer: 'L1', closed: true, segments: rectangle(10, 10, 280, 130, 12) },
    { id: 'panel', layer: 'L1', closed: true, segments: rectangle(40, 35, 220, 80, 8) },
    ...[
      [25, 25],
      [275, 25],
      [25, 125],
      [275, 125],
    ].map(([x, y], i) => ({
      id: `hole${i + 1}`,
      layer: 'L1',
      closed: true,
      segments: ellipse(x as number, y as number, 2.5),
    })),
  ]).apply(p);
  p = addTool({ id: 'flat6', ...preset('6 mm flat end mill') }).apply(p);
  p = addTool({ id: 'flat3', ...preset('3 mm flat end mill') }).apply(p);
  p = addToolpath({
    id: 'panel',
    name: 'Recessed panel',
    type: 'pocket',
    tool: 'flat6',
    vectors: ['panel'],
    params: { depth: 3, strategy: 'offset' },
  }).apply(p);
  p = addToolpath({
    id: 'holes',
    name: 'Mounting holes',
    type: 'drill',
    tool: 'flat3',
    vectors: ['hole1', 'hole2', 'hole3', 'hole4'],
    params: { depth: 18, peck: 3 },
  }).apply(p);
  p = addToolpath({
    id: 'cutout',
    name: 'Cut out',
    type: 'profile',
    tool: 'flat6',
    vectors: ['outline'],
    params: { side: 'outside', depth: 18, tabs: { count: 4, width: 8, height: 3 } },
  }).apply(p);
  return p;
}

/** Calligraphy: Nastaliq text V-carved inside an oval, cut out. */
async function calligraphy(): Promise<Project> {
  const file =
    require.resolve('@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff');
  const font = await loadFont(new Uint8Array(readFileSync(file)), 'Nastaliq');
  const size = 60;
  const { region } = layoutText('خوش آمدید', { size, fonts: [font], align: 'center' });
  const matrix = translation(150, 85);
  let p = newProject({
    stock: { width: 300, height: 180, thickness: 18, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([
    {
      id: 'text',
      layer: 'L1',
      closed: true,
      segments: transformSegments(regionToSegments(region), matrix),
      text: {
        content: 'خوش آمدید',
        fontId: 'nastaliq',
        size,
        align: 'center',
        matrix: [...matrix],
      },
    },
    { id: 'oval', layer: 'L1', closed: true, segments: ellipse(150, 90, 140, 80) },
  ]).apply(p);
  p = addTool({ id: 'v60', ...preset('60° V-bit, 1/2"') }).apply(p);
  p = addTool({ id: 'flat6', ...preset('6 mm flat end mill') }).apply(p);
  p = addToolpath({
    id: 'carve',
    name: 'V-carve text',
    type: 'vcarve',
    tool: 'v60',
    vectors: ['text'],
    params: { depth: 6 },
  }).apply(p);
  p = addToolpath({
    id: 'cutout',
    name: 'Cut out',
    type: 'profile',
    tool: 'flat6',
    vectors: ['oval'],
    params: { side: 'outside', depth: 18, tabs: { count: 4, width: 8, height: 3 } },
  }).apply(p);
  return p;
}

/** Relief panel: framed border (extrude), rosette (spin), domes, texture; rough + finish. */
function reliefPanel(): Project {
  let p = newProject({
    stock: { width: 200, height: 150, thickness: 20, origin: 'bottom-left', zZero: 'top' },
  });
  p = addVectors([
    { id: 'frame', layer: 'L1', closed: true, segments: rectangle(15, 15, 170, 120, 10) },
    {
      id: 'border',
      layer: 'L1',
      closed: false,
      // Cove-and-bead cross-section, 14 mm wide, drawn anywhere (only its shape counts).
      segments: line([
        [0, 0],
        [3, 4],
        [6, 5],
        [9, 3],
        [11, 5],
        [14, 0],
      ]),
    },
    {
      id: 'petal',
      layer: 'L1',
      closed: false,
      // Rosette section: from the centre outward, 28 mm.
      segments: line([
        [0, 0],
        [0.5, 6],
        [6, 7],
        [12, 4],
        [18, 5],
        [24, 3],
        [28, 0],
      ]),
    },
    { id: 'inner', layer: 'L1', closed: true, segments: rectangle(32, 32, 136, 86, 6) },
    { id: 'leafL', layer: 'L1', closed: true, segments: ellipse(55, 75, 12, 22) },
    { id: 'leafR', layer: 'L1', closed: true, segments: ellipse(145, 75, 12, 22) },
  ]).apply(p);
  p = addRelief(0.5, 'r1').apply(p);
  const ops = [
    { op: 'texture', pattern: 'hammered', spacing: 6, height: 0.6, within: 'inner', mode: 'add' },
    { op: 'extrude', rail: 'frame', section: 'border', mode: 'mergeHigh' },
    { op: 'spin', section: 'petal', centre: [100, 75], mode: 'mergeHigh' },
    { op: 'fromVector', vector: 'leafL', profile: 'dome', height: 5, mode: 'mergeHigh' },
    { op: 'fromVector', vector: 'leafR', profile: 'dome', height: 5, mode: 'mergeHigh' },
  ] as const;
  for (const op of ops) p = setReliefOp('r1', structuredClone(op) as never).apply(p);
  p = addTool({ id: 'flat6', ...preset('6 mm flat end mill') }).apply(p);
  p = addTool({ id: 'ball3', ...preset('1/8" ball nose') }).apply(p);
  p = addToolpath({
    id: 'rough',
    name: 'Rough',
    type: 'rough3d',
    tool: 'flat6',
    relief: 'r1',
    vectors: [],
    params: { allowance: 0.5 },
  }).apply(p);
  p = addToolpath({
    id: 'finish',
    name: 'Finish',
    type: 'finish3d',
    tool: 'ball3',
    relief: 'r1',
    vectors: [],
    params: { pattern: 'x', stepOver: 0.4 },
  }).apply(p);
  return p;
}

const dir = fileURLToPath(new URL('./', import.meta.url));
const builders: Record<string, () => Project | Promise<Project>> = {
  sign,
  calligraphy,
  'relief-panel': reliefPanel,
};

describe('sample projects (T7.2)', { timeout: 300_000 }, () => {
  if (process.env.UPDATE_SAMPLES) {
    it('rebuilds the sample files', async () => {
      for (const [id, build] of Object.entries(builders)) {
        const project = projectSchema.parse(await build());
        writeFileSync(`${dir}${id}.json`, JSON.stringify(project) + '\n');
      }
    });
    return;
  }

  it('every listed sample has a file, and every file is listed', () => {
    expect(SAMPLES.map((s) => s.id).sort()).toEqual(Object.keys(builders).sort());
    for (const s of SAMPLES) expect(existsSync(`${dir}${s.id}.json`), s.id).toBe(true);
  });

  it.each(Object.keys(builders))('%s loads, validates, and every toolpath exports safely', (id) => {
    const sample = SAMPLES.find((s) => s.id === id);
    const project = projectSchema.parse(sample?.project);
    expect(project.toolpaths.length).toBeGreaterThan(0);
    for (const tp of project.toolpaths) {
      const ex = exportToolpath(project, tp.id, { simulated: true });
      expect(
        ex.check.issues.filter((i) => i.severity === 'error'),
        `${id} / ${tp.id}`,
      ).toEqual([]);
      expect(ex.ok, `${id} / ${tp.id}`).toBe(true);
    }
  });
});
