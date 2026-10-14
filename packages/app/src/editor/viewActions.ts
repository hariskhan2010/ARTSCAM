import { fitView, selectionBBox, zoomAt, type View } from './geometry';
import type { EditorStore } from './store';

/**
 * View commands shared by the canvas, the zoom toolbar, the main toolbar and
 * the View menu. The stored view is `undefined` while it fits the material.
 */

/** Fit-view margins (px); the top one leaves room for the tool hint card. */
export const FIT_MARGIN = 40;
export const FIT_TOP = 120;

/** The view that shows the whole material. */
export function fitMaterial(store: EditorStore): View {
  const [w, h] = store.canvasSize;
  const { width, height } = store.doc.stock;
  return fitView({ minX: 0, minY: 0, maxX: width, maxY: height }, w, h, FIT_MARGIN, FIT_TOP);
}

export function currentView(store: EditorStore): View {
  return store.ui.view ?? fitMaterial(store);
}

/** Changes the view and remembers the old one for Zoom previous. */
function setView(store: EditorStore, view: View | undefined): void {
  store.setUi({ view, prevView: currentView(store) });
}

export function zoomBy(store: EditorStore, factor: number): void {
  const [w, h] = store.canvasSize;
  setView(store, zoomAt(currentView(store), [w / 2, h / 2], factor));
}

export function zoomFit(store: EditorStore): void {
  setView(store, undefined);
}

/** Fits the selected shapes, or says why it can't. */
export function zoomSelection(store: EditorStore): void {
  const sel = new Set(store.ui.selection);
  const box = selectionBBox(store.doc.vectors.filter((v) => sel.has(v.id)));
  if (!box) {
    store.setUi({ message: 'Select shapes to zoom to' });
    return;
  }
  const [w, h] = store.canvasSize;
  // A small margin around the shapes; a single point still gets a sensible zoom.
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) * 0.05;
  setView(
    store,
    fitView(
      { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad },
      w,
      h,
      FIT_MARGIN,
      FIT_TOP,
    ),
  );
}

export function zoomPrevious(store: EditorStore): void {
  const prev = store.ui.prevView;
  if (!prev) return;
  store.setUi({ view: prev, prevView: currentView(store) });
}

/** Zoom level relative to fitting the material, in percent. */
export function zoomPercent(store: EditorStore): number {
  return Math.round((currentView(store).scale / fitMaterial(store).scale) * 100);
}
