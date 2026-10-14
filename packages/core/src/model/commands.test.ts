import { describe, expect, it } from 'vitest';
import { rectangle } from '../vector/shapes';
import { bbox, translation } from '../vector/path';
import {
  addLayer,
  addTool,
  addToolpath,
  addVectors,
  deleteLayer,
  deleteTool,
  deleteVectors,
  duplicateVectors,
  newProject,
  nextId,
  setVectorSegments,
  transformVectors,
  updateLayer,
} from './commands';
import { History } from './history';
import { projectSchema } from './schema';

const valid = (p: unknown) => expect(projectSchema.safeParse(p).success).toBe(true);

describe('document commands', () => {
  it('newProject is a valid project', () => {
    valid(newProject());
  });

  it('nextId fills the first gap', () => {
    expect(nextId('v', [{ id: 'v1' }, { id: 'v3' }])).toBe('v2');
    expect(nextId('v', [])).toBe('v1');
  });

  it('adds, transforms, duplicates and deletes vectors through history', () => {
    const h = new History(newProject());
    h.execute(addVectors([{ layer: 'L1', closed: true, segments: rectangle(0, 0, 10, 10) }]));
    expect(h.doc.vectors.map((v) => v.id)).toEqual(['v1']);
    h.execute(transformVectors(['v1'], translation(5, 5)));
    expect(bbox(h.doc.vectors[0]!.segments)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
    h.execute(duplicateVectors(['v1'], translation(20, 0)));
    expect(h.doc.vectors.map((v) => v.id)).toEqual(['v1', 'v2']);
    valid(h.doc);
    h.execute(deleteVectors(['v1']));
    expect(h.doc.vectors.map((v) => v.id)).toEqual(['v2']);
    h.undo();
    h.undo();
    h.undo();
    expect(bbox(h.doc.vectors[0]!.segments)!.minX).toBe(0);
  });

  it('no-op commands record nothing', () => {
    const h = new History(newProject());
    expect(h.execute(deleteVectors(['nope']))).toBe(false);
    expect(h.execute(transformVectors(['nope'], translation(1, 0)))).toBe(false);
    expect(h.execute(updateLayer('L1', { name: 'Design' }))).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('deleting vectors drops toolpaths that only used them', () => {
    let p = newProject();
    p = addVectors([{ layer: 'L1', closed: true, segments: rectangle(0, 0, 10, 10) }]).apply(p);
    p = addTool({
      type: 'flat',
      diameter: 6,
      stepDown: 2,
      stepOver: 2.4,
      feed: 1000,
      plunge: 300,
      rpm: 18000,
    }).apply(p);
    p = addToolpath({
      type: 'profile',
      tool: 't1',
      vectors: ['v1'],
      params: { side: 'outside', depth: 3 },
    }).apply(p);
    valid(p);
    expect(deleteTool('t1').apply(p)).toBe(p); // in use
    p = deleteVectors(['v1']).apply(p);
    expect(p.toolpaths).toEqual([]);
    valid(p);
  });

  it('layers: add, rename, delete with their vectors; never the last one', () => {
    let p = addLayer('Cut').apply(newProject());
    p = addVectors([{ layer: 'L2', closed: false, segments: rectangle(0, 0, 1, 1) }]).apply(p);
    p = updateLayer('L2', { visible: false }).apply(p);
    expect(p.layers[1]).toMatchObject({ id: 'L2', name: 'Cut', visible: false });
    p = deleteLayer('L2').apply(p);
    expect(p.layers.map((l) => l.id)).toEqual(['L1']);
    expect(p.vectors).toEqual([]);
    expect(deleteLayer('L1').apply(p)).toBe(p);
  });

  it('setVectorSegments replaces one vector', () => {
    let p = addVectors([{ layer: 'L1', closed: true, segments: rectangle(0, 0, 1, 1) }]).apply(
      newProject(),
    );
    p = setVectorSegments('v1', rectangle(0, 0, 2, 2)).apply(p);
    expect(bbox(p.vectors[0]!.segments)!.maxX).toBe(2);
  });
});
