import {
  addLayer,
  addVectors,
  booleanOp,
  deleteLayer,
  deleteVectors,
  duplicateVectors,
  flatten,
  moveVectorsToLayer,
  offset,
  rotation,
  scaling,
  setStock,
  setUnits,
  translation,
  transformVectors,
  updateLayer,
  composite,
  type BooleanOp,
  type Project,
  type Segment,
  type Vec2,
  type Vector,
} from '@naqsh/core';
import { useState } from 'react';
import { selectionBBox } from '../editor/geometry';
import type { EditorStore } from '../editor/store';
import { NumberField, Section } from './common';

/** Flattening tolerance for booleans/offsets (mm). */
const GEOM_TOL = 0.01;

/** Closed rings of the given vectors (open vectors are ignored). */
function ringsOf(vectors: readonly Vector[]): Vec2[][] {
  return vectors
    .filter((v) => v.closed)
    .flatMap((v) => flatten(v.segments, GEOM_TOL, true).map((p) => p.points));
}

/** One vector holding all rings of a region (outer + holes stay together). */
function regionVector(rings: Vec2[][], layer: string): Omit<Vector, 'id'> | undefined {
  const segments: Segment[] = [];
  for (const ring of rings) {
    ring.forEach((p, i) => segments.push({ type: i === 0 ? 'move' : 'line', p: [p[0], p[1]] }));
    segments.push({ type: 'close' });
  }
  return segments.length ? { layer, closed: true, segments } : undefined;
}

function SelectionSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const units = doc.units;
  const ids = store.ui.selection;
  // Selection order matters for Trim/Intersect: the first-picked vector is the subject.
  const selected = ids
    .map((id) => doc.vectors.find((v) => v.id === id))
    .filter((v): v is Vector => !!v);
  const box = selectionBBox(selected);
  const [offsetBy, setOffsetBy] = useState(2);

  if (!box) {
    return (
      <Section title="Selection">
        <p className="hint">Nothing selected. Click a vector, drag a box, or Ctrl+A.</p>
      </Section>
    );
  }
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const run = (m: Parameters<typeof transformVectors>[1], label: string) =>
    store.execute(transformVectors(ids, m, label));

  const boolean = (op: BooleanOp, label: string) => {
    const [first, ...rest] = selected.filter((v) => v.closed);
    if (!first || rest.length === 0) {
      store.setUi({ message: `${label} needs two or more closed vectors selected` });
      return;
    }
    // Weld unions everything; trim/intersect apply the rest to the first-picked vector.
    const result =
      op === 'union'
        ? booleanOp('union', ringsOf(selected), [], 'nonZero')
        : booleanOp(op, ringsOf([first]), ringsOf(rest));
    const vec = regionVector(result, first.layer);
    store.execute(
      composite(label, [
        deleteVectors(selected.map((v) => v.id)),
        ...(vec ? [addVectors([vec], label)] : []),
      ]),
    );
    const last = store.doc.vectors.at(-1);
    store.select(vec && last ? [last.id] : []);
  };

  const doOffset = (sign: 1 | -1) => {
    const closed = selected.filter((v) => v.closed);
    if (closed.length === 0) {
      store.setUi({ message: 'Offset needs closed vectors' });
      return;
    }
    const vecs = closed
      .map((v) => regionVector(offset(ringsOf([v]), sign * offsetBy), v.layer))
      .filter((v): v is Omit<Vector, 'id'> => !!v);
    if (vecs.length === 0) {
      store.setUi({ message: 'Inset is larger than the shape; nothing left' });
      return;
    }
    store.execute(addVectors(vecs, sign > 0 ? 'Offset out' : 'Offset in'));
  };

  return (
    <Section title={`Selection (${selected.length})`}>
      <div className="grid2">
        <NumberField
          label="X"
          units={units}
          value={box.minX}
          onCommit={(x) => run(translation(x - box.minX, 0), 'Move')}
          testId="sel-x"
        />
        <NumberField
          label="Y"
          units={units}
          value={box.minY}
          onCommit={(y) => run(translation(0, y - box.minY), 'Move')}
          testId="sel-y"
        />
        <NumberField
          label="W"
          units={units}
          min={1e-6}
          value={w}
          disabled={w === 0}
          onCommit={(nw) => run(scaling(nw / w, 1, box.minX, box.minY), 'Scale')}
          testId="sel-w"
        />
        <NumberField
          label="H"
          units={units}
          min={1e-6}
          value={h}
          disabled={h === 0}
          onCommit={(nh) => run(scaling(1, nh / h, box.minX, box.minY), 'Scale')}
          testId="sel-h"
        />
      </div>
      <div className="buttons">
        <button onClick={() => run(scaling(-1, 1, cx, cy), 'Mirror')} title="Mirror left–right">
          Mirror ↔
        </button>
        <button onClick={() => run(scaling(1, -1, cx, cy), 'Mirror')} title="Mirror top–bottom">
          Mirror ↕
        </button>
        <button
          onClick={() => run(rotation(Math.PI / 2, cx, cy), 'Rotate')}
          title="Rotate 90° counter-clockwise"
        >
          ⟲ 90°
        </button>
        <button
          onClick={() => run(rotation(-Math.PI / 2, cx, cy), 'Rotate')}
          title="Rotate 90° clockwise"
        >
          ⟳ 90°
        </button>
        <button
          onClick={() => {
            const s = doc.stock;
            run(translation(s.width / 2 - cx, s.height / 2 - cy), 'Centre on stock');
          }}
        >
          Centre
        </button>
        <button
          onClick={() => {
            const before = new Set(doc.vectors.map((v) => v.id));
            store.execute(duplicateVectors(ids, translation(5, -5)));
            store.select(store.doc.vectors.filter((v) => !before.has(v.id)).map((v) => v.id));
          }}
        >
          Duplicate
        </button>
        <button className="danger" onClick={() => store.execute(deleteVectors(ids))}>
          Delete
        </button>
      </div>
      <h3>Combine</h3>
      <div className="buttons">
        <button
          onClick={() => boolean('union', 'Weld')}
          title="Union of all selected closed vectors"
        >
          Weld
        </button>
        <button
          onClick={() => boolean('difference', 'Trim')}
          title="First selected minus the others"
        >
          Trim
        </button>
        <button
          onClick={() => boolean('intersect', 'Intersect')}
          title="Overlap of first selected with the others"
        >
          Intersect
        </button>
      </div>
      <h3>Offset</h3>
      <div className="row">
        <NumberField label="By" units={units} min={1e-6} value={offsetBy} onCommit={setOffsetBy} />
        <button onClick={() => doOffset(1)}>Outward</button>
        <button onClick={() => doOffset(-1)}>Inward</button>
      </div>
      {doc.layers.length > 1 && (
        <label className="field">
          <span>Layer</span>
          <select
            value={selected.every((v) => v.layer === selected[0]?.layer) ? selected[0]?.layer : ''}
            onChange={(e) => store.execute(moveVectorsToLayer(ids, e.target.value))}
          >
            <option value="" disabled>
              (mixed)
            </option>
            {doc.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </Section>
  );
}

function LayersSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  return (
    <Section
      title="Layers"
      actions={
        <button
          className="small"
          onClick={() => store.execute(addLayer(`Layer ${doc.layers.length + 1}`))}
        >
          + Add
        </button>
      }
    >
      <ul className="layers">
        {doc.layers.map((l) => (
          <li key={l.id} className={l.id === store.ui.activeLayer ? 'active' : ''}>
            <input
              type="radio"
              name="active-layer"
              checked={l.id === store.ui.activeLayer}
              onChange={() => store.setUi({ activeLayer: l.id })}
              title="Draw into this layer"
            />
            <input
              className="layer-name"
              defaultValue={l.name}
              key={l.name}
              onBlur={(e) => store.execute(updateLayer(l.id, { name: e.target.value || l.name }))}
              aria-label="Layer name"
            />
            <button
              className="icon"
              title={l.visible ? 'Hide' : 'Show'}
              aria-pressed={l.visible}
              onClick={() => store.execute(updateLayer(l.id, { visible: !l.visible }))}
            >
              {l.visible ? '👁' : '—'}
            </button>
            <button
              className="icon"
              title={l.locked ? 'Unlock' : 'Lock'}
              aria-pressed={l.locked}
              onClick={() => store.execute(updateLayer(l.id, { locked: !l.locked }))}
            >
              {l.locked ? '🔒' : '🔓'}
            </button>
            <button
              className="icon"
              title="Delete layer and its vectors"
              disabled={doc.layers.length <= 1}
              onClick={() => store.execute(deleteLayer(l.id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function StockSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const s = doc.stock;
  const set = (patch: Partial<Project['stock']>) => store.execute(setStock({ ...s, ...patch }));
  return (
    <Section title="Stock">
      <div className="grid2">
        <NumberField
          label="Width"
          units={doc.units}
          min={1e-3}
          value={s.width}
          onCommit={(width) => set({ width })}
        />
        <NumberField
          label="Height"
          units={doc.units}
          min={1e-3}
          value={s.height}
          onCommit={(height) => set({ height })}
        />
        <NumberField
          label="Thick"
          units={doc.units}
          min={1e-3}
          value={s.thickness}
          onCommit={(thickness) => set({ thickness })}
        />
        <label className="field">
          <span>Units</span>
          <select
            value={doc.units}
            onChange={(e) => store.execute(setUnits(e.target.value as Project['units']))}
          >
            <option value="mm">mm</option>
            <option value="inch">inch</option>
          </select>
        </label>
      </div>
    </Section>
  );
}

export function DesignPanel({ store }: { store: EditorStore }) {
  return (
    <>
      <SelectionSection store={store} />
      <LayersSection store={store} />
      <StockSection store={store} />
    </>
  );
}
