import { describe, expect, it } from 'vitest';
import { rectangle } from '../vector/shapes';
import { bbox, rotation, translation } from '../vector/path';
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
  setVectorText,
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

describe('editable text', () => {
  const text = { content: 'Naqsh', fontId: 'naskh', size: 20, align: 'left' as const };

  it('a text vector keeps its source; moving it updates the placement', () => {
    let p = addVectors([
      {
        layer: 'L1',
        closed: true,
        segments: rectangle(0, 0, 1, 1),
        text: { ...text, matrix: [1, 0, 0, 1, 5, 5] },
      },
    ]).apply(newProject());
    valid(p);
    p = transformVectors(['v1'], translation(10, 0)).apply(p);
    expect(p.vectors[0]!.text!.matrix).toEqual([1, 0, 0, 1, 15, 5]);
    p = transformVectors(['v1'], rotation(Math.PI / 2)).apply(p);
    const m = p.vectors[0]!.text!.matrix;
    expect(m[4]).toBeCloseTo(-5, 9);
    expect(m[5]).toBeCloseTo(15, 9);
    valid(p);
  });

  it('node edits turn text into a plain shape; duplicates stay editable', () => {
    let p = addVectors([
      {
        layer: 'L1',
        closed: true,
        segments: rectangle(0, 0, 1, 1),
        text: { ...text, matrix: [1, 0, 0, 1, 0, 0] },
      },
    ]).apply(newProject());
    p = duplicateVectors(['v1'], translation(3, 0)).apply(p);
    expect(p.vectors[1]!.text!.matrix).toEqual([1, 0, 0, 1, 3, 0]);
    p = setVectorSegments('v1', rectangle(0, 0, 2, 2)).apply(p);
    expect(p.vectors[0]!.text).toBeUndefined();
    valid(p);
  });

  it('setVectorText replaces the outline and the source in one undoable step', () => {
    const h = new History(
      addVectors([
        {
          layer: 'L1',
          closed: true,
          segments: rectangle(0, 0, 1, 1),
          text: { ...text, matrix: [1, 0, 0, 1, 0, 0] },
        },
      ]).apply(newProject()),
    );
    h.execute(
      setVectorText(
        'v1',
        { ...text, content: 'Edited', matrix: [1, 0, 0, 1, 0, 0] },
        rectangle(0, 0, 4, 1),
      ),
    );
    expect(h.doc.vectors[0]!.text!.content).toBe('Edited');
    expect(bbox(h.doc.vectors[0]!.segments)!.maxX).toBe(4);
    h.undo();
    expect(h.doc.vectors[0]!.text!.content).toBe('Naqsh');
    expect(bbox(h.doc.vectors[0]!.segments)!.maxX).toBe(1);
  });
});
