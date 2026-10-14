import { formatFixed, fromMm, gridRange, PRECISION, type Project } from '@naqsh/core';
import { Info } from 'lucide-react';
import { activeRelief, selectedVectors } from '../actions';
import { gridStep, selectionBBox } from '../editor/geometry';
import type { EditorStore } from '../editor/store';
import { currentView } from '../editor/viewActions';

/** Model Information box (bottom right) and the status bar (window bottom). */

function formatter(units: Project['units']) {
  const unit = units === 'mm' ? 'mm' : 'in';
  const num = (mm: number) => formatFixed(fromMm(mm, units), PRECISION[units].display);
  return { unit, num };
}

/** Height of the active relief under world point (x, y), if inside it. */
export function reliefZAt(store: EditorStore, x: number, y: number): number | undefined {
  const r = activeRelief(store);
  const g = r ? store.relief(r.id).grid : undefined;
  if (!g) return undefined;
  const c = Math.floor(x / g.resolution);
  const row = Math.floor(y / g.resolution);
  if (c < 0 || row < 0 || c >= g.cols || row >= g.rows) return undefined;
  return g.z[row * g.cols + c];
}

export function ModelInfo({ store }: { store: EditorStore }) {
  const { doc } = store;
  const { unit, num } = formatter(doc.units);
  const r = activeRelief(store);
  const grid = r ? store.relief(r.id).grid : undefined;
  const range = grid ? gridRange(grid.z) : undefined;
  const gridMm = gridStep(currentView(store).scale);
  const s = doc.stock;
  return (
    <section className="model-info" aria-label="Model information" data-testid="model-info">
      <div className="mi-head">
        <Info size={13} aria-hidden /> Model Information
      </div>
      <dl>
        <dt>Material</dt>
        <dd data-testid="mi-size">
          {num(s.width)} × {num(s.height)} × {num(s.thickness)} {unit}
        </dd>
        <dt>Relief Z</dt>
        <dd data-testid="mi-relief">
          {range ? `max ${num(range.max)} · min ${num(range.min)} ${unit}` : 'no relief'}
        </dd>
        <dt>Grid</dt>
        <dd data-testid="mi-grid">
          {num(gridMm)} {unit}
        </dd>
      </dl>
    </section>
  );
}

export function StatusBar({ store }: { store: EditorStore }) {
  const { ui, doc } = store;
  const { unit, num } = formatter(doc.units);
  const z = ui.cursor ? reliefZAt(store, ui.cursor[0], ui.cursor[1]) : undefined;
  const box = selectionBBox(selectedVectors(store));
  return (
    <footer className="status">
      <span className="coords" data-testid="status-xyz">
        {ui.cursor
          ? `X ${num(ui.cursor[0])}  Y ${num(ui.cursor[1])}  Z ${z === undefined ? '–' : num(z)} ${unit}`
          : 'Move over the canvas'}
      </span>
      <span className="coords" data-testid="status-wh">
        {box ? `W ${num(box.maxX - box.minX)}  H ${num(box.maxY - box.minY)} ${unit}` : 'W –  H –'}
      </span>
      <span data-testid="vector-count">{doc.vectors.length} vectors</span>
      <span>{ui.selection.length} selected</span>
      <span className="message" role="status" data-testid="message">
        {ui.message}
      </span>
    </footer>
  );
}
