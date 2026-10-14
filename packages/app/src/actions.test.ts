import { addVectors, ellipse, rectangle } from '@naqsh/core';
import { describe, expect, it } from 'vitest';
import {
  copySelection,
  createToolpath,
  cutSelection,
  pasteClipboard,
  shapesToRelief,
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
