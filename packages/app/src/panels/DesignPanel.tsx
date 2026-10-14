import {
  addLayer,
  deleteLayer,
  deleteVectors,
  duplicateVectors,
  moveVectorsToLayer,
  rotation,
  scaling,
  setStock,
  setUnits,
  transformVectors,
  translation,
  updateLayer,
  type BooleanOp,
  type Project,
} from '@naqsh/core';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Box,
  Combine,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Layers,
  Link,
  Lock,
  LockOpen,
  MousePointerClick,
  Plus,
  RotateCcw,
  RotateCw,
  Trash,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { selectionBBox } from '../editor/geometry';
import type { EditorStore } from '../editor/store';
import { Btn, Hint, NumberField, Section, SelectField } from './common';
import { booleanSelection, offsetSelection, selectedVectors } from '../actions';

function SelectionSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const units = doc.units;
  const ids = store.ui.selection;
  const selected = selectedVectors(store);
  const box = selectionBBox(selected);
  const [lockRatio, setLockRatio] = useState(true);

  if (!box) {
    return (
      <Section title="Selection" icon={MousePointerClick}>
        <Hint>
          Nothing selected. Draw a shape with the tools on the left, click a shape to select it, or
          use <b>Import</b> to bring in an SVG or DXF file.
        </Hint>
      </Section>
    );
  }
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const run = (m: Parameters<typeof transformVectors>[1], label: string) =>
    store.execute(transformVectors(ids, m, label));
  /** Resize from the bottom-left corner; with the lock on, both axes scale together. */
  const resize = (sx: number, sy: number) => {
    const s = sx !== 1 ? sx : sy;
    run(
      lockRatio ? scaling(s, s, box.minX, box.minY) : scaling(sx, sy, box.minX, box.minY),
      'Resize',
    );
  };

  return (
    <Section
      title={selected.length === 1 ? 'Selected shape' : `${selected.length} shapes selected`}
      icon={MousePointerClick}
    >
      <div className="grid2">
        <NumberField
          label="Position X"
          units={units}
          value={box.minX}
          onCommit={(x) => run(translation(x - box.minX, 0), 'Move')}
          testId="sel-x"
        />
        <NumberField
          label="Position Y"
          units={units}
          value={box.minY}
          onCommit={(y) => run(translation(0, y - box.minY), 'Move')}
          testId="sel-y"
        />
        <NumberField
          label="Width"
          units={units}
          min={1e-6}
          value={w}
          disabled={w === 0}
          onCommit={(nw) => resize(nw / w, 1)}
          testId="sel-w"
        />
        <NumberField
          label="Height"
          units={units}
          min={1e-6}
          value={h}
          disabled={h === 0}
          onCommit={(nh) => resize(1, nh / h)}
          testId="sel-h"
        />
      </div>
      <Btn
        icon={Link}
        label={lockRatio ? 'Keeping proportions' : 'Free resize'}
        variant="ghost"
        pressed={lockRatio}
        onClick={() => setLockRatio(!lockRatio)}
        title="When on, changing the width also changes the height (and the other way round)"
        testId="lock-ratio"
      />
      <div className="actions">
        <Btn
          icon={ArrowLeftRight}
          label="Mirror"
          onClick={() => run(scaling(-1, 1, cx, cy), 'Mirror')}
          title="Mirror left to right"
        />
        <Btn
          icon={ArrowUpDown}
          label="Flip"
          onClick={() => run(scaling(1, -1, cx, cy), 'Flip')}
          title="Flip top to bottom"
        />
        <Btn
          icon={RotateCcw}
          label="Rotate 90°"
          onClick={() => run(rotation(Math.PI / 2, cx, cy), 'Rotate')}
          title="Rotate 90° anticlockwise"
        />
        <Btn
          icon={RotateCw}
          label="Rotate −90°"
          onClick={() => run(rotation(-Math.PI / 2, cx, cy), 'Rotate')}
          title="Rotate 90° clockwise"
        />
        <Btn
          icon={Crosshair}
          label="Centre"
          onClick={() =>
            run(
              translation(doc.stock.width / 2 - cx, doc.stock.height / 2 - cy),
              'Centre on material',
            )
          }
          title="Move to the centre of the material"
        />
        <Btn
          icon={Copy}
          label="Duplicate"
          onClick={() => {
            const before = new Set(doc.vectors.map((v) => v.id));
            store.execute(duplicateVectors(ids, translation(5, -5)));
            store.select(store.doc.vectors.filter((v) => !before.has(v.id)).map((v) => v.id));
          }}
          title="Copy (Ctrl+D)"
        />
        <Btn
          icon={Trash}
          label="Delete"
          variant="danger"
          onClick={() => store.execute(deleteVectors(ids))}
          title="Delete (Del)"
        />
      </div>
      {doc.layers.length > 1 && (
        <SelectField
          label="Layer"
          value={
            selected.every((v) => v.layer === selected[0]?.layer) ? (selected[0]?.layer ?? '') : ''
          }
          options={[
            { value: '', label: '(mixed)', disabled: true },
            ...doc.layers.map((l) => ({ value: l.id, label: l.name })),
          ]}
          onChange={(layer) => store.execute(moveVectorsToLayer(ids, layer))}
        />
      )}
    </Section>
  );
}

function ShapeOpsSection({ store }: { store: EditorStore }) {
  const units = store.doc.units;
  const closed = selectedVectors(store).filter((v) => v.closed);
  const [offsetBy, setOffsetBy] = useState(2);

  const boolean = (op: BooleanOp, label: string) => booleanSelection(store, op, label);
  const doOffset = (sign: 1 | -1) => offsetSelection(store, sign, offsetBy);

  return (
    <Section title="Shape operations" icon={Combine} collapsible>
      {closed.length === 0 ? (
        <Hint>Select closed shapes to combine them or to draw outlines offset from them.</Hint>
      ) : (
        <>
          <div className="actions">
            <Btn
              label="Weld"
              onClick={() => boolean('union', 'Weld')}
              title="Join all selected shapes into one outline"
              disabled={closed.length < 2}
            />
            <Btn
              label="Trim"
              onClick={() => boolean('difference', 'Trim')}
              title="Cut the other shapes out of the first one you selected"
              disabled={closed.length < 2}
            />
            <Btn
              label="Intersect"
              onClick={() => boolean('intersect', 'Intersect')}
              title="Keep only where the first shape overlaps the others"
              disabled={closed.length < 2}
            />
          </div>
          <div className="row">
            <NumberField
              label="Offset distance"
              units={units}
              min={1e-6}
              value={offsetBy}
              onCommit={setOffsetBy}
            />
            <Btn
              label="Outward"
              onClick={() => doOffset(1)}
              title="Add an outline this far outside each shape"
            />
            <Btn
              label="Inward"
              onClick={() => doOffset(-1)}
              title="Add an outline this far inside each shape"
            />
          </div>
        </>
      )}
    </Section>
  );
}

function LayersSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  return (
    <Section
      title="Layers"
      icon={Layers}
      collapsible
      actions={
        <Btn
          icon={Plus}
          title="Add layer"
          variant="ghost"
          onClick={() => store.execute(addLayer(`Layer ${doc.layers.length + 1}`))}
        />
      }
    >
      <ul className="list">
        {doc.layers.map((l) => (
          <li
            key={l.id}
            className={l.id === store.ui.activeLayer ? 'active' : ''}
            onClick={() => store.setUi({ activeLayer: l.id })}
            title="New shapes go into the highlighted layer"
          >
            <input
              className="layer-name"
              defaultValue={l.name}
              key={l.name}
              onBlur={(e) => store.execute(updateLayer(l.id, { name: e.target.value || l.name }))}
              aria-label="Layer name"
            />
            <span className="chip muted" title="Shapes in this layer">
              {doc.vectors.filter((v) => v.layer === l.id).length}
            </span>
            <Btn
              icon={l.visible ? Eye : EyeOff}
              variant="ghost"
              title={l.visible ? 'Hide layer' : 'Show layer'}
              onClick={() => store.execute(updateLayer(l.id, { visible: !l.visible }))}
            />
            <Btn
              icon={l.locked ? Lock : LockOpen}
              variant="ghost"
              title={l.locked ? 'Unlock layer' : 'Lock layer (its shapes cannot be selected)'}
              onClick={() => store.execute(updateLayer(l.id, { locked: !l.locked }))}
            />
            <Btn
              icon={X}
              variant="ghost"
              title="Delete layer and its shapes"
              disabled={doc.layers.length <= 1}
              onClick={() => store.execute(deleteLayer(l.id))}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function MaterialSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const s = doc.stock;
  const set = (patch: Partial<Project['stock']>) => store.execute(setStock({ ...s, ...patch }));
  return (
    <Section title="Material" icon={Box} collapsible>
      <div className="grid3">
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
          label="Thickness"
          units={doc.units}
          min={1e-3}
          value={s.thickness}
          onCommit={(thickness) => set({ thickness })}
        />
      </div>
      <div className="grid2">
        <SelectField
          label="Units"
          value={doc.units}
          options={[
            { value: 'mm', label: 'Millimetres' },
            { value: 'inch', label: 'Inches' },
          ]}
          onChange={(u) => store.execute(setUnits(u))}
        />
        <SelectField
          label="Z zero"
          value={s.zZero}
          help="Where Z = 0 is when you zero the tool on the machine"
          options={[
            { value: 'top', label: 'Top of material' },
            { value: 'bed', label: 'Machine bed' },
          ]}
          onChange={(zZero) => set({ zZero })}
        />
      </div>
      <SelectField
        label="XY origin"
        value={s.origin}
        help="The point of the material that X0 Y0 means on the machine"
        options={[
          { value: 'bottom-left', label: 'Bottom left corner' },
          { value: 'top-left', label: 'Top left corner' },
          { value: 'bottom-right', label: 'Bottom right corner' },
          { value: 'top-right', label: 'Top right corner' },
          { value: 'center', label: 'Centre' },
        ]}
        onChange={(origin) => set({ origin })}
      />
    </Section>
  );
}

export function DesignPanel({ store }: { store: EditorStore }) {
  return (
    <div className="sidebar-scroll">
      <SelectionSection store={store} />
      <ShapeOpsSection store={store} />
      <LayersSection store={store} />
      <MaterialSection store={store} />
    </div>
  );
}
