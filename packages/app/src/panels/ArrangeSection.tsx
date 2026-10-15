import { LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import {
  alignSelection,
  circularArraySelection,
  cornerSelection,
  distributeSelection,
  gridArraySelection,
  joinSelection,
  repairSelection,
  selectedVectors,
} from '../actions';
import type { EditorStore } from '../editor/store';
import { Btn, Hint, NumberField, Section } from './common';

/**
 * Vector tools for the selection (plan.md T6.7): corners (fillet, chamfer),
 * join and repair, align and distribute, grid and circular arrays.
 */
export function ArrangeSection({ store }: { store: EditorStore }) {
  const units = store.doc.units;
  const n = selectedVectors(store).length;
  const [corner, setCorner] = useState(3);
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(1);
  const [dx, setDx] = useState(20);
  const [dy, setDy] = useState(20);
  const [count, setCount] = useState(6);
  const [angle, setAngle] = useState(360);
  const [cx, setCx] = useState<number | undefined>(undefined);
  const [cy, setCy] = useState<number | undefined>(undefined);
  // Circular arrays turn around the material's centre unless a centre is typed in.
  const centreX = cx ?? store.doc.stock.width / 2;
  const centreY = cy ?? store.doc.stock.height / 2;

  if (n === 0) {
    return (
      <Section title="Arrange and edit" icon={LayoutGrid} collapsible defaultOpen={false}>
        <Hint>
          Select shapes to round their corners, join or repair them, line them up, or copy them in a
          grid or around a centre.
        </Hint>
      </Section>
    );
  }
  return (
    <Section title="Arrange and edit" icon={LayoutGrid} collapsible defaultOpen={false}>
      <div className="row">
        <NumberField
          label="Corner size"
          units={units}
          min={1e-6}
          value={corner}
          onCommit={setCorner}
          testId="corner-size"
          help="Fillet radius, or how far a chamfer cuts back along each line"
        />
        <Btn
          label="Fillet"
          onClick={() => cornerSelection(store, 'fillet', corner)}
          testId="corner-fillet"
          title="Round every corner between two straight lines"
        />
        <Btn
          label="Chamfer"
          onClick={() => cornerSelection(store, 'chamfer', corner)}
          testId="corner-chamfer"
          title="Cut every corner between two straight lines"
        />
      </div>
      <div className="actions">
        <Btn
          label="Join"
          onClick={() => joinSelection(store)}
          disabled={n < 2}
          testId="vec-join"
          title="Join open shapes whose ends meet into one (closing it if it loops)"
        />
        <Btn
          label="Repair"
          onClick={() => repairSelection(store)}
          testId="vec-repair"
          title="Remove zero-length pieces and duplicates, close shapes whose ends nearly meet"
        />
      </div>

      <span className="field-label">Align</span>
      <div className="actions">
        <Btn
          label="Left"
          onClick={() => alignSelection(store, 'left')}
          disabled={n < 2}
          testId="align-left"
        />
        <Btn
          label="Centre"
          onClick={() => alignSelection(store, 'centerX')}
          disabled={n < 2}
          testId="align-centerX"
        />
        <Btn
          label="Right"
          onClick={() => alignSelection(store, 'right')}
          disabled={n < 2}
          testId="align-right"
        />
        <Btn
          label="Top"
          onClick={() => alignSelection(store, 'top')}
          disabled={n < 2}
          testId="align-top"
        />
        <Btn
          label="Middle"
          onClick={() => alignSelection(store, 'middle')}
          disabled={n < 2}
          testId="align-middle"
        />
        <Btn
          label="Bottom"
          onClick={() => alignSelection(store, 'bottom')}
          disabled={n < 2}
          testId="align-bottom"
        />
        <Btn
          label="Space across"
          onClick={() => distributeSelection(store, 'x')}
          disabled={n < 3}
          testId="distribute-x"
          title="Equal gaps from left to right"
        />
        <Btn
          label="Space up"
          onClick={() => distributeSelection(store, 'y')}
          disabled={n < 3}
          testId="distribute-y"
          title="Equal gaps from bottom to top"
        />
      </div>

      <span className="field-label">Grid array</span>
      <div className="grid2">
        <NumberField
          label="Columns"
          min={1}
          decimals={0}
          value={cols}
          onCommit={(v) => setCols(Math.max(1, Math.round(v)))}
          testId="array-cols"
        />
        <NumberField
          label="Rows"
          min={1}
          decimals={0}
          value={rows}
          onCommit={(v) => setRows(Math.max(1, Math.round(v)))}
          testId="array-rows"
        />
        <NumberField
          label="Spacing X"
          units={units}
          value={dx}
          onCommit={setDx}
          testId="array-dx"
        />
        <NumberField
          label="Spacing Y"
          units={units}
          value={dy}
          onCommit={setDy}
          testId="array-dy"
        />
      </div>
      <Btn
        label={`Copy into ${cols} × ${rows}`}
        onClick={() => gridArraySelection(store, cols, rows, dx, dy)}
        disabled={cols * rows < 2}
        testId="array-grid"
        wide
      />

      <span className="field-label">Circular array</span>
      <div className="grid2">
        <NumberField
          label="Copies (in all)"
          min={2}
          decimals={0}
          value={count}
          onCommit={(v) => setCount(Math.max(2, Math.round(v)))}
          testId="array-count"
        />
        <NumberField
          label="Angle"
          suffix="°"
          value={angle}
          onCommit={setAngle}
          testId="array-angle"
        />
        <NumberField
          label="Centre X"
          units={units}
          value={centreX}
          onCommit={setCx}
          testId="array-cx"
        />
        <NumberField
          label="Centre Y"
          units={units}
          value={centreY}
          onCommit={setCy}
          testId="array-cy"
        />
      </div>
      <Btn
        label={`Copy ${count} around the centre`}
        onClick={() => circularArraySelection(store, count, [centreX, centreY], angle)}
        testId="array-circular"
        wide
      />
    </Section>
  );
}
