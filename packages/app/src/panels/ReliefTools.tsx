import { Brush, Grid3x3, Route, Scissors } from 'lucide-react';
import {
  addExtrude,
  addSpin,
  addTexture,
  addTwoRail,
  clipRelief,
  fadeRelief,
  pickSweepShape,
  scaleReliefInside,
  setReliefForm,
  sweepShape,
  type SweepRole,
} from '../actions';
import type { EditorStore, ReliefForm } from '../editor/store';
import { Btn, Hint, NumberField, Section, Segmented, SelectField, Switch } from './common';

/**
 * Relief panel sections for M6: sweeps (extrude, spin, two-rail), textures,
 * the sculpt brush and edits inside a shape (fade, trim, scale). Their settings live in the relief form so the menus and
 * the canvas use the same values.
 */

function ShapePick(props: { store: EditorStore; role: SweepRole; label: string }) {
  const { store, role } = props;
  const id = sweepShape(store, role);
  const n = id ? store.doc.vectors.findIndex((v) => v.id === id) + 1 : 0;
  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <span className="field-label grow">
        {props.label}: <b data-testid={`sweep-${role}-value`}>{n ? `shape ${n}` : 'none'}</b>
      </span>
      <Btn
        label="Use selection"
        disabled={store.ui.selection.length !== 1}
        onClick={() => pickSweepShape(store, role)}
        testId={`sweep-${role}`}
        title="Use the one selected shape"
      />
    </div>
  );
}

export function SweepSection({ store }: { store: EditorStore }) {
  const f = store.ui.reliefForm;
  const has = (r: SweepRole) => !!sweepShape(store, r);
  return (
    <Section title="Sweeps" icon={Route} collapsible defaultOpen={false}>
      <Hint>
        A cross-section is an open shape drawn at true size: its ends sit on the base, and its
        height is measured from the line between them. Combine uses the setting above.
      </Hint>
      <ShapePick store={store} role="section" label="Cross-section" />
      <ShapePick store={store} role="rail" label="Rail" />
      <ShapePick store={store} role="endSection" label="End section (optional)" />
      <div className="row">
        <Btn
          label="Extrude"
          variant="primary"
          disabled={!has('rail') || !has('section')}
          onClick={() => addExtrude(store)}
          testId="sweep-extrude"
          title="Sweep the cross-section along the rail"
          wide
        />
        <Btn
          label="Spin"
          disabled={!has('section')}
          onClick={() => addSpin(store)}
          testId="sweep-spin"
          title="Turn the cross-section around its left end"
          wide
        />
      </div>
      <ShapePick store={store} role="railB" label="Second rail" />
      <Switch
        label="Scale height with width"
        checked={f.sweepScaleHeight}
        onChange={(sweepScaleHeight) => setReliefForm(store, { sweepScaleHeight })}
      />
      <Btn
        label="Two-rail sweep"
        disabled={!has('rail') || !has('railB') || !has('section')}
        onClick={() => addTwoRail(store)}
        testId="sweep-two-rail"
        title="Stretch the cross-section between the rail and the second rail"
        wide
      />
    </Section>
  );
}

export function TextureSection({ store }: { store: EditorStore }) {
  const f = store.ui.reliefForm;
  const u = store.doc.units;
  const set = (patch: Partial<ReliefForm>) => setReliefForm(store, patch);
  const inside = store.ui.selection.filter((id) =>
    store.doc.vectors.some((v) => v.id === id && v.closed),
  ).length;
  return (
    <Section title="Texture" icon={Grid3x3} collapsible defaultOpen={false}>
      <SelectField<ReliefForm['texture']>
        label="Pattern"
        value={f.texture}
        options={[
          { value: 'lines', label: 'Lines (ridges)' },
          { value: 'dimples', label: 'Dimples (round bumps)' },
          { value: 'hammered', label: 'Hammered' },
          { value: 'weave', label: 'Basket weave' },
        ]}
        onChange={(texture) => set({ texture })}
        testId="texture-pattern"
      />
      <div className="grid2">
        <NumberField
          label="Spacing"
          units={u}
          min={0.1}
          value={f.textureSpacing}
          onCommit={(textureSpacing) => set({ textureSpacing })}
          testId="texture-spacing"
        />
        <NumberField
          label="Height"
          units={u}
          value={f.textureHeight}
          onCommit={(textureHeight) => set({ textureHeight })}
          testId="texture-height"
        />
        <NumberField
          label="Angle"
          suffix="°"
          value={f.textureAngle}
          onCommit={(textureAngle) => set({ textureAngle })}
        />
      </div>
      <Btn
        label={
          inside === 1 ? 'Add texture inside the selected shape' : 'Add texture over the relief'
        }
        variant="primary"
        onClick={() => addTexture(store)}
        testId="texture-add"
        wide
      />
    </Section>
  );
}

export function SculptSection({ store }: { store: EditorStore }) {
  const f = store.ui.reliefForm;
  const u = store.doc.units;
  const set = (patch: Partial<ReliefForm>) => setReliefForm(store, patch);
  const active = store.ui.tool === 'sculpt';
  return (
    <Section title="Sculpt" icon={Brush} collapsible defaultOpen={active}>
      <Segmented<ReliefForm['brush']>
        label="Brush"
        value={f.brush}
        options={[
          { value: 'raise', label: 'Raise' },
          { value: 'lower', label: 'Lower' },
          { value: 'smooth', label: 'Smooth' },
        ]}
        onChange={(brush) => set({ brush })}
        testId="sculpt-brush"
      />
      <div className="grid2">
        <NumberField
          label="Size (radius)"
          units={u}
          min={0.1}
          value={f.brushRadius}
          onCommit={(brushRadius) => set({ brushRadius })}
          testId="sculpt-radius"
        />
        {f.brush === 'smooth' ? (
          <NumberField
            label="Strength (0–1)"
            min={0}
            value={Math.min(1, f.brushStrength)}
            onCommit={(brushStrength) => set({ brushStrength: Math.min(1, brushStrength) })}
          />
        ) : (
          <NumberField
            label="Strength"
            units={u}
            min={0}
            value={f.brushStrength}
            onCommit={(brushStrength) => set({ brushStrength })}
            testId="sculpt-strength"
          />
        )}
      </div>
      <Btn
        icon={Brush}
        label={active ? 'Sculpting: drag on the canvas' : 'Start sculpting'}
        pressed={active}
        onClick={() => store.setUi({ tool: active ? 'select' : 'sculpt', show3d: false })}
        testId="sculpt-start"
        wide
      />
    </Section>
  );
}

export function EditReliefSection({ store }: { store: EditorStore }) {
  const f = store.ui.reliefForm;
  const one =
    store.ui.selection.length === 1 &&
    store.doc.vectors.some((v) => v.id === store.ui.selection[0] && v.closed);
  const hasRelief = store.doc.reliefs.length > 0;
  const off = !one || !hasRelief;
  const why = hasRelief ? 'Select one closed shape first' : 'Make a relief first';
  return (
    <Section title="Edit relief" icon={Scissors} collapsible defaultOpen={false}>
      <Hint>
        These work inside the one selected closed shape. A linear fade runs from its left edge (full
        height) to its right edge (flat); a radial fade from its centre out to its side.
      </Hint>
      <div className="row">
        <Btn
          label="Fade linear"
          disabled={off}
          onClick={() => fadeRelief(store, 'line')}
          testId="edit-fade-line"
          title={off ? why : 'Fade the relief from left to right inside the shape'}
          wide
        />
        <Btn
          label="Fade radial"
          disabled={off}
          onClick={() => fadeRelief(store, 'radial')}
          testId="edit-fade-radial"
          title={off ? why : 'Fade the relief from the centre outward inside the shape'}
          wide
        />
      </div>
      <div className="row">
        <Btn
          label="Keep inside"
          disabled={off}
          onClick={() => clipRelief(store, 'inside')}
          testId="edit-keep-inside"
          title={off ? why : 'Trim the relief to the shape: flatten everything outside it'}
          wide
        />
        <Btn
          label="Keep outside"
          disabled={off}
          onClick={() => clipRelief(store, 'outside')}
          testId="edit-keep-outside"
          title={off ? why : 'Flatten the relief inside the shape'}
          wide
        />
      </div>
      <Btn
        label={`Scale height × ${f.factor} inside the shape`}
        disabled={off}
        onClick={() => scaleReliefInside(store)}
        testId="edit-scale-inside"
        title={off ? why : 'Uses the height factor under Whole relief'}
        wide
      />
    </Section>
  );
}
