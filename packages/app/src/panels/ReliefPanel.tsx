import {
  addRelief,
  deleteRelief,
  gridRange,
  removeReliefOp,
  type ReliefOp,
  type Vector,
} from '@naqsh/core';
import {
  Box,
  Download,
  Image as ImageIcon,
  Layers,
  Mountain,
  Plus,
  Rotate3d,
  Trash,
  X,
} from 'lucide-react';
import type { EditorStore, ReliefForm } from '../editor/store';
import {
  activeRelief,
  addImageRelief,
  clipName,
  exportStl,
  invertRelief,
  scaleRelief,
  setReliefForm,
  shapesToRelief,
  smoothRelief,
} from '../actions';
import { Btn, Hint, NumberField, Section, Segmented, SelectField } from './common';
import { SculptSection, SweepSection, TextureSection } from './ReliefTools';

type Profile = Extract<ReliefOp, { op: 'fromVector' }>['profile'];
type Mode = Extract<ReliefOp, { op: 'fromVector' }>['mode'];

const MODES: { value: Mode; label: string }[] = [
  { value: 'add', label: 'Add (raise)' },
  { value: 'subtract', label: 'Subtract (sink)' },
  { value: 'mergeHigh', label: 'Merge high' },
  { value: 'mergeLow', label: 'Merge low' },
  { value: 'zero', label: 'Zero (flatten)' },
];

function describe(op: ReliefOp, vectors: Vector[]): string {
  switch (op.op) {
    case 'fromVector': {
      const n = vectors.findIndex((v) => v.id === op.vector) + 1;
      return `${op.profile.charAt(0).toUpperCase()}${op.profile.slice(1)} ${op.height} mm · shape ${n || '?'} · ${op.mode}`;
    }
    case 'fromImage':
      return `Image ${op.px}×${op.py} px · ${op.height} mm${op.invert ? ' · inverted' : ''} · ${op.mode}`;
    case 'paste':
      return `Clipart ${clipName(op.clip)} · ${op.w.toFixed(1)} × ${op.h.toFixed(1)} mm · ${op.height.toFixed(2)} mm${op.rotation ? ` · turned ${op.rotation}°` : ''} · ${op.mode}`;
    case 'extrude': {
      const n = (id: string) => vectors.findIndex((v) => v.id === id) + 1 || '?';
      return `Extrude along shape ${n(op.rail)} · section ${n(op.section)}${op.endSection ? ` → ${n(op.endSection)}` : ''} · ${op.mode}`;
    }
    case 'spin': {
      const n = vectors.findIndex((v) => v.id === op.section) + 1 || '?';
      return `Spin section ${n} · ${op.mode}`;
    }
    case 'twoRail': {
      const n = (id: string) => vectors.findIndex((v) => v.id === id) + 1 || '?';
      return `Sweep between shapes ${n(op.railA)} and ${n(op.railB)} · section ${n(op.section)} · ${op.mode}`;
    }
    case 'texture': {
      const n = op.within ? vectors.findIndex((v) => v.id === op.within) + 1 || '?' : undefined;
      return `Texture ${op.pattern} ${op.spacing} mm · ${op.height} mm${n ? ` · in shape ${n}` : ''} · ${op.mode}`;
    }
    case 'sculpt':
      return `Sculpt ${op.tool} · ${op.radius} mm brush${op.tool === 'smooth' ? '' : ` · ${op.strength} mm`}`;
    case 'smooth':
      return `Smooth ${op.radius} mm × ${op.passes}`;
    case 'scale':
      return `Scale height × ${op.factor}`;
    case 'offset':
      return `Raise all by ${op.amount} mm`;
    case 'invert':
      return 'Invert (flip high and low)';
  }
}

export function ReliefPanel({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const u = doc.units;
  const relief = activeRelief(store);
  const back = store.ui.reliefSide === 'back';
  const title = back ? 'Back relief' : 'Front relief';
  const backHint = (
    <Hint>
      Designed as seen from the front, so it lines up with the front relief. Its toolpaths are
      mirrored: turn the material over left to right before running them.
    </Hint>
  );
  const f = store.ui.reliefForm;
  const set = (patch: Partial<ReliefForm>) => setReliefForm(store, patch);
  const { resolution, profile, height, angle, mode, factor } = f;

  if (!relief) {
    return (
      <div className="sidebar-scroll">
        <Section title={title} icon={Mountain}>
          {back && backHint}
          <Hint>
            A relief is a carved 3D surface over the material. Create one, then build it from shapes
            (domes, slopes, rounded edges) and pictures.
          </Hint>
          <SelectField
            label="Detail (grid spacing)"
            value={String(resolution)}
            options={[
              { value: '0.5', label: '0.5 mm: fast' },
              { value: '0.25', label: '0.25 mm: balanced' },
              { value: '0.15', label: '0.15 mm: fine (slower)' },
            ]}
            onChange={(v) => set({ resolution: Number(v) })}
          />
          <Btn
            icon={Plus}
            label={back ? 'Create back relief' : 'Create relief'}
            variant="primary"
            testId="relief-create"
            onClick={() => {
              store.execute(addRelief(resolution, undefined, store.ui.reliefSide));
              store.setUi({ activeRelief: store.doc.reliefs.at(-1)?.id });
            }}
          />
        </Section>
      </div>
    );
  }

  const { grid, error } = store.relief(relief.id);
  const range = grid ? gridRange(grid.z) : { min: 0, max: 0 };
  const closed = store.ui.selection
    .map((id) => doc.vectors.find((v) => v.id === id))
    .filter((v): v is Vector => !!v && v.closed);

  const addShapes = () => shapesToRelief(store);

  return (
    <div className="sidebar-scroll">
      <Section
        title={title}
        icon={Mountain}
        actions={
          <Btn
            icon={Trash}
            variant="ghost"
            title="Delete this relief"
            onClick={() => store.execute(deleteRelief(relief.id))}
          />
        }
      >
        <div className="stat" data-testid="relief-stats">
          <span className="muted">Height</span>
          <b>
            {range.min.toFixed(2)} – {range.max.toFixed(2)} mm
          </b>
          <span className="muted">
            · {relief.cols}×{relief.rows} cells at {relief.resolution} mm
          </span>
        </div>
        {back && backHint}
        {error && <Hint tone="error">{error}</Hint>}
        <div className="row">
          <Btn
            icon={Rotate3d}
            label={store.ui.show3d ? 'Hide 3D view' : 'Show 3D view'}
            pressed={store.ui.show3d}
            onClick={() => store.setUi({ show3d: !store.ui.show3d })}
            testId="relief-3d"
            wide
          />
          <Btn
            icon={Download}
            label="Export STL"
            disabled={!grid}
            onClick={() => exportStl(store)}
            testId="relief-stl"
            wide
          />
        </div>
      </Section>

      <Section title="Add shapes" icon={Layers}>
        <Segmented<Profile>
          label="Profile"
          value={profile}
          options={[
            { value: 'flat', label: 'Flat', help: 'A raised plateau' },
            { value: 'dome', label: 'Dome', help: 'A smooth pillow over the whole shape' },
            {
              value: 'angle',
              label: 'Angle',
              help: 'Slopes up from the edge, flat once at the height',
            },
            { value: 'round', label: 'Round', help: 'Rounded edge, flat on top' },
          ]}
          onChange={(profile) => set({ profile })}
          testId="relief-profile"
        />
        <div className="grid2">
          <NumberField
            label="Height"
            units={u}
            value={height}
            onCommit={(height) => set({ height })}
            testId="relief-height"
          />
          {profile === 'angle' && (
            <NumberField
              label="Angle"
              suffix="°"
              min={1}
              value={angle}
              onCommit={(angle) => set({ angle })}
            />
          )}
          <SelectField
            label="Combine"
            value={mode}
            options={MODES}
            onChange={(mode) => set({ mode })}
          />
        </div>
        <Btn
          icon={Plus}
          label={
            closed.length
              ? `Add ${closed.length} selected shape${closed.length === 1 ? '' : 's'}`
              : 'Select closed shapes first'
          }
          variant="primary"
          disabled={closed.length === 0}
          onClick={addShapes}
          testId="relief-add-shapes"
        />
        <div className="row">
          <NumberField
            label="Image height"
            units={u}
            value={f.imageHeight}
            onCommit={(imageHeight) => set({ imageHeight })}
          />
          <Btn
            icon={ImageIcon}
            label="Add image…"
            onClick={() => void addImageRelief(store)}
            title="Bright parts become high"
          />
        </div>
      </Section>

      <SweepSection store={store} />
      <TextureSection store={store} />
      <SculptSection store={store} />

      <Section title="Whole relief" icon={Box} collapsible defaultOpen={false}>
        <div className="row">
          <NumberField
            label="Smooth radius"
            units={u}
            min={0.01}
            value={f.smoothRadius}
            onCommit={(smoothRadius) => set({ smoothRadius })}
          />
          <Btn label="Smooth" onClick={() => smoothRelief(store)} />
        </div>
        <div className="row">
          <NumberField
            label="Height factor"
            value={factor}
            onCommit={(factor) => set({ factor })}
          />
          <Btn label="Scale" onClick={() => scaleRelief(store)} />
        </div>
        <Btn label="Invert (flip high and low)" onClick={() => invertRelief(store)} />
      </Section>

      <Section title={`Steps (${relief.ops.length})`} icon={Layers}>
        {relief.ops.length === 0 ? (
          <Hint>No steps yet. Add shapes or an image above.</Hint>
        ) : (
          <ul className="list" data-testid="relief-steps">
            {relief.ops.map((op, i) => (
              <li key={i}>
                <span className="name" title={describe(op, doc.vectors)}>
                  {i + 1}. {describe(op, doc.vectors)}
                </span>
                <Btn
                  icon={X}
                  variant="ghost"
                  title="Remove this step"
                  onClick={() => store.execute(removeReliefOp(relief.id, i))}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
