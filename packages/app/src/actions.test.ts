import { addVectors, ellipse, gridRange, loadProject, rectangle, saveProject } from '@naqsh/core';
import { describe, expect, it } from 'vitest';
import {
  copySelection,
  createToolpath,
  cutSelection,
  pasteClipboard,
  pasteStarterClip,
  shapesToRelief,
  updatePaste,
  transformSelection,
} from './actions';
import { selectionBBox, worldToScreen } from './editor/geometry';
import { EditorStore } from './editor/store';
import { currentView, zoomBy, zoomFit, zoomPrevious, zoomSelection } from './editor/viewActions';
import { reliefZAt } from './layout/Info';

function storeWithShapes() {
  const store = new EditorStore();
  store.execute(
    addVectors([
      { layer: 'L1', closed: true, segments: rectangle(10, 10, 40, 20) },
      { layer: 'L1', closed: true, segments: ellipse(100, 100, 20) },
    ]),
  );
  return store;
}

describe('clipboard', () => {
  it('copy + paste adds offset copies and selects them; paste again steps further', () => {
    const store = storeWithShapes();
    store.select(['v1']);
    expect(copySelection(store)).toBe(true);
    pasteClipboard(store);
    expect(store.doc.vectors).toHaveLength(3);
    const first = selectionBBox(store.doc.vectors.filter((v) => store.ui.selection.includes(v.id)));
    expect(first?.minX).toBeCloseTo(15, 9);
    expect(first?.minY).toBeCloseTo(5, 9);
    pasteClipboard(store);
    const second = selectionBBox(
      store.doc.vectors.filter((v) => store.ui.selection.includes(v.id)),
    );
    expect(second?.minX).toBeCloseTo(20, 9);
    store.undo();
    store.undo();
    expect(store.doc.vectors).toHaveLength(2);
  });

  it('cut removes the shapes (undoable); nothing selected → a message, no change', () => {
    const store = storeWithShapes();
    store.select(['v2']);
    cutSelection(store);
    expect(store.doc.vectors.map((v) => v.id)).toEqual(['v1']);
    store.select([]);
    expect(copySelection(store)).toBe(false);
    expect(store.ui.message).toMatch(/Select shapes/);
  });
});

describe('view commands', () => {
  it('zoom in, previous view and fit', () => {
    const store = storeWithShapes();
    store.canvasSize = [800, 600];
    const fit = currentView(store);
    zoomBy(store, 2);
    expect(currentView(store).scale).toBeCloseTo(fit.scale * 2, 9);
    zoomPrevious(store);
    expect(currentView(store).scale).toBeCloseTo(fit.scale, 9);
    zoomBy(store, 2);
    zoomFit(store);
    expect(store.ui.view).toBeUndefined();
  });

  it('zoom to selection puts the shape in the middle of the canvas', () => {
    const store = storeWithShapes();
    store.canvasSize = [800, 600];
    store.select(['v2']);
    zoomSelection(store);
    const v = currentView(store);
    const [x] = worldToScreen(v, [100, 100]);
    expect(x).toBeCloseTo(400, 6);
    expect(v.scale).toBeGreaterThan(5);
  });
});

describe('toolbar actions', () => {
  it('shape to relief creates the relief when there is none; Z under the cursor reads it', () => {
    const store = storeWithShapes();
    store.select(['v2']);
    shapesToRelief(store);
    expect(store.doc.reliefs).toHaveLength(1);
    expect(store.doc.reliefs[0]?.ops[0]).toMatchObject({ op: 'fromVector', profile: 'dome' });
    expect(reliefZAt(store, 100, 100)).toBeCloseTo(5, 1);
    expect(reliefZAt(store, 5, 5)).toBe(0);
    expect(reliefZAt(store, -5, 5)).toBeUndefined();
  });

  it('a toolpath needs a tool first', () => {
    const store = storeWithShapes();
    store.select(['v1']);
    createToolpath(store, 'profile');
    expect(store.doc.toolpaths).toHaveLength(0);
    expect(store.ui.message).toMatch(/Add a tool first/);
  });

  it('mirror keeps the selection in place', () => {
    const store = storeWithShapes();
    store.select(['v1']);
    transformSelection(store, 'mirror');
    const b = selectionBBox(store.doc.vectors.filter((v) => v.id === 'v1'));
    expect(b?.minX).toBeCloseTo(10, 9);
    expect(b?.maxX).toBeCloseTo(50, 9);
  });
});

describe('clipart (T6.10)', () => {
  it('pasting into a project with no relief is one undoable step', () => {
    const store = new EditorStore();
    pasteStarterClip(store, 'rosette');
    const r = store.doc.reliefs[0]!;
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0]!;
    if (op.op !== 'paste') throw new Error('expected a paste');
    // Centred, a third of the material (the default 300 × 200 material).
    expect(op.x + op.w / 2).toBeCloseTo(store.doc.stock.width / 2);
    expect(op.h).toBeCloseTo(Math.min(store.doc.stock.width, store.doc.stock.height) / 3);
    expect(gridRange(store.relief(r.id).grid!.z).max).toBeCloseTo(3, 4);
    store.undo();
    expect(store.doc.reliefs).toHaveLength(0);
  });

  it('pasted clips are saved with the project, and placement edits are steps', () => {
    const store = new EditorStore();
    pasteStarterClip(store, 'leaf');
    pasteStarterClip(store, 'leaf');
    // The same starter clip is stored once.
    expect(Object.keys(store.clips)).toEqual(['starter-leaf']);
    const r = store.doc.reliefs[0]!;
    updatePaste(store, r.id, 1, { rotation: 90, height: 5 });
    expect(store.doc.reliefs[0]!.ops[1]).toMatchObject({ rotation: 90, height: 5 });
    const loaded = loadProject(saveProject(store.bundle()));
    expect(Object.keys(loaded.clips ?? {})).toEqual(['starter-leaf']);
    const back = new EditorStore();
    back.load(loaded.project, loaded.images, loaded.clips);
    const a = back.relief(r.id).grid!.z;
    const b = store.relief(r.id).grid!.z;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    store.undo();
    expect(store.doc.reliefs[0]!.ops[1]).not.toHaveProperty('rotation');
  });
});
