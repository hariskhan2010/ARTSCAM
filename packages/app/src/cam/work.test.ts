import {
  TOOL_PRESETS,
  addTool,
  addToolpath,
  addVectors,
  checkGcode,
  newProject,
  rectangle,
  type Project,
} from '@naqsh/core';
import { describe, expect, it } from 'vitest';
import { handle } from './work';

function project(depth = 6): Project {
  let p = newProject();
  p = addVectors([
    { id: 'r', layer: 'L1', closed: true, segments: rectangle(50, 50, 80, 40) },
  ]).apply(p);
  p = addTool({ id: 't', ...TOOL_PRESETS[3]! }).apply(p);
  return addToolpath({
    id: 'tp',
    type: 'profile',
    tool: 't',
    vectors: ['r'],
    params: { side: 'outside', depth },
  }).apply(p);
}

describe('CAM worker jobs', () => {
  it('preview returns world-coordinate moves and a time estimate', () => {
    const { response } = handle({
      id: 1,
      kind: 'preview',
      project: project(),
      toolpathId: 'tp',
      images: {},
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.kind !== 'preview') return;
    const { path, seconds, issues } = response.result;
    expect(path.length % 4).toBe(0);
    const xs = path.filter((_, i) => i % 4 === 0);
    expect(Math.min(...xs)).toBeCloseTo(47, 6);
    expect(seconds).toBeGreaterThan(0);
    expect(issues).toEqual([]);
  });

  it('simulate lowers the stock along the cut', () => {
    const { response } = handle({
      id: 2,
      kind: 'simulate',
      project: project(),
      toolpathId: 'tp',
      images: {},
    });
    if (!response.ok || response.kind !== 'simulate') throw new Error('simulate failed');
    expect(response.result.z.reduce((m, z) => Math.min(m, z), Infinity)).toBeCloseTo(-6, 5);
  });

  it('export is blocked until simulated, then passes the checker', () => {
    const blocked = handle({
      id: 3,
      kind: 'export',
      project: project(),
      toolpathId: 'tp',
      simulated: false,
      images: {},
    });
    if (!blocked.response.ok || blocked.response.kind !== 'export')
      throw new Error('export failed');
    expect(blocked.response.result.ok).toBe(false);

    const p = project();
    const done = handle({
      id: 4,
      kind: 'export',
      project: p,
      toolpathId: 'tp',
      simulated: true,
      images: {},
    });
    if (!done.response.ok || done.response.kind !== 'export') throw new Error('export failed');
    expect(done.response.result.ok).toBe(true);
    const check = checkGcode(done.response.result.gcode, {
      machine: p.machine,
      stock: p.stock,
      clearance: 3.01,
      simulated: true,
    });
    expect(check.ok).toBe(true);
  });

  it('reports errors instead of throwing', () => {
    const { response } = handle({
      id: 5,
      kind: 'preview',
      project: project(),
      toolpathId: 'nope',
      images: {},
    });
    expect(response).toMatchObject({ id: 5, ok: false });
  });
});
