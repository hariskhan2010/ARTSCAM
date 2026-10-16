import { STARTER_CLIPS, makeStarterClip, removeReliefOp, type ReliefOp } from '@naqsh/core';
import { FileUp, SquareStack, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  activeRelief,
  clipName,
  importMeshClip,
  pasteStarterClip,
  setReliefForm,
  updatePaste,
} from '../actions';
import type { EditorStore, ReliefForm } from '../editor/store';
import { Btn, Hint, NumberField, Section, SelectField } from './common';

/**
 * Relief clipart (Project tree › Clipart): ready-made relief pieces and 3D
 * models (STL/OBJ seen from above) pasted into the shown relief, then placed
 * with numbers. Each paste or change is one undoable step.
 */

type Paste = Extract<ReliefOp, { op: 'paste' }>;

const MODES: { value: ReliefForm['mode']; label: string }[] = [
  { value: 'add', label: 'Add (raise)' },
  { value: 'subtract', label: 'Subtract (sink)' },
  { value: 'mergeHigh', label: 'Merge high' },
  { value: 'mergeLow', label: 'Merge low' },
];

/** A small grayscale picture of a starter clip (high = light). */
function ClipThumb({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const clip = makeStarterClip(id);
    const ctx = canvas?.getContext('2d');
    if (!canvas || !clip || !ctx) return;
    canvas.width = clip.cols;
    canvas.height = clip.rows;
    const img = ctx.createImageData(clip.cols, clip.rows);
    for (let r = 0; r < clip.rows; r++)
      for (let c = 0; c < clip.cols; c++) {
        // Row 0 of the clip is at the bottom; images are drawn top down.
        const v = Math.round(40 + 215 * (clip.z[(clip.rows - 1 - r) * clip.cols + c] as number));
        const o = (r * clip.cols + c) * 4;
        img.data[o] = v;
        img.data[o + 1] = v;
        img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }, [id]);
  return <canvas ref={ref} className="clip-thumb" aria-hidden />;
}

function PlacedClip(props: { store: EditorStore; relief: string; index: number; op: Paste }) {
  const { store, relief, index, op } = props;
  const u = store.doc.units;
  const set = (patch: Parameters<typeof updatePaste>[3]) =>
    updatePaste(store, relief, index, patch);
  return (
    <li className="clip-placed" data-testid={`clip-placed-${index}`}>
      <div className="row" style={{ alignItems: 'center' }}>
        <b className="grow">{clipName(op.clip)}</b>
        <Btn
          icon={X}
          variant="ghost"
          title="Remove this clipart"
          onClick={() => store.execute(removeReliefOp(relief, index))}
        />
      </div>
      <div className="grid2">
        <NumberField label="X" units={u} value={op.x} onCommit={(x) => set({ x })} />
        <NumberField label="Y" units={u} value={op.y} onCommit={(y) => set({ y })} />
        <NumberField
          label="Width"
          units={u}
          min={0.01}
          value={op.w}
          onCommit={(w) => set({ w })}
          testId={`clip-w-${index}`}
        />
        <NumberField
          label="Length"
          units={u}
          min={0.01}
          value={op.h}
          onCommit={(h) => set({ h })}
        />
        <NumberField
          label="Turn"
          suffix="°"
          value={op.rotation ?? 0}
          onCommit={(rotation) => set({ rotation })}
          testId={`clip-rotation-${index}`}
        />
        <NumberField
          label="Height"
          units={u}
          value={op.height}
          onCommit={(height) => set({ height })}
          testId={`clip-height-${index}`}
        />
      </div>
    </li>
  );
}

export function ClipartPanel({ store }: { store: EditorStore }) {
  const f = store.ui.reliefForm;
  const u = store.doc.units;
  const relief = activeRelief(store);
  const placed = relief
    ? relief.ops.flatMap((op, index) => (op.op === 'paste' ? [{ op, index }] : []))
    : [];
  const side = store.ui.reliefSide === 'back' ? 'back relief' : 'relief';
  return (
    <div className="sidebar-scroll">
      <Section title="Clipart" icon={SquareStack}>
        <Hint>
          Ready-made relief pieces. A click pastes one in the middle of the material, a third of its
          size, into the {side}; place it exactly below.
        </Hint>
        <div className="grid2">
          <NumberField
            label="Height"
            units={u}
            value={f.clipHeight}
            onCommit={(clipHeight) => setReliefForm(store, { clipHeight })}
            testId="clip-height"
          />
          <SelectField
            label="Combine"
            value={f.mode === 'zero' ? 'add' : f.mode}
            options={MODES}
            onChange={(mode) => setReliefForm(store, { mode })}
          />
        </div>
        <div className="clip-grid" data-testid="clip-library">
          {STARTER_CLIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="clip-tile"
              title={`Paste ${c.name.toLowerCase()}`}
              data-testid={`clip-starter-${c.id}`}
              onClick={() => pasteStarterClip(store, c.id)}
            >
              <ClipThumb id={c.id} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
        <Btn
          icon={FileUp}
          label="Import 3D model (STL/OBJ)…"
          onClick={() => void importMeshClip(store)}
          title="The model seen from above (Z up) becomes a relief piece"
          testId="clip-import"
          wide
        />
      </Section>

      <Section title={`Placed (${placed.length})`} icon={SquareStack}>
        {placed.length === 0 ? (
          <Hint>No clipart in this relief yet.</Hint>
        ) : (
          <ul className="list clip-list" data-testid="clip-placed">
            {placed.map(({ op, index }) => (
              <PlacedClip
                key={index}
                store={store}
                relief={relief?.id ?? ''}
                index={index}
                op={op}
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
