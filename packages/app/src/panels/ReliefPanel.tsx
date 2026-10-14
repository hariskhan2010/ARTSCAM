import {
  addRelief,
  deleteRelief,
  gridRange,
  reliefToStl,
  removeReliefOp,
  setReliefOp,
  composite,
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
import { useState } from 'react';
import type { EditorStore } from '../editor/store';
import { download, pickFile } from '../files';
import { Btn, Hint, NumberField, Section, Segmented, SelectField } from './common';

type Profile = Extract<ReliefOp, { op: 'fromVector' }>['profile'];
type Mode = Extract<ReliefOp, { op: 'fromVector' }>['mode'];

const MODES: { value: Mode; label: string }[] = [
  { value: 'add', label: 'Add (raise)' },
  { value: 'subtract', label: 'Subtract (sink)' },
  { value: 'mergeHigh', label: 'Merge high' },
  { value: 'mergeLow', label: 'Merge low' },
  { value: 'zero', label: 'Zero (flatten)' },
];

/** Decodes an image file to grayscale bytes (rows top to bottom), at most `max` px on the long side. */
async function imageToGray(
  file: File,
  max = 1000,
): Promise<{ px: Uint8Array; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) {
    const a = (rgba[i * 4 + 3] as number) / 255;
    // Luminance; transparent pixels count as black (no height).
    px[i] = Math.round(
      a *
        (0.299 * (rgba[i * 4] as number) +
          0.587 * (rgba[i * 4 + 1] as number) +
          0.114 * (rgba[i * 4 + 2] as number)),
    );
  }
  return { px, w, h };
}

function describe(op: ReliefOp, vectors: Vector[]): string {
  switch (op.op) {
    case 'fromVector': {
      const n = vectors.findIndex((v) => v.id === op.vector) + 1;
      return `${op.profile.charAt(0).toUpperCase()}${op.profile.slice(1)} ${op.height} mm · shape ${n || '?'} · ${op.mode}`;
    }
    case 'fromImage':
      return `Image ${op.px}×${op.py} px · ${op.height} mm${op.invert ? ' · inverted' : ''} · ${op.mode}`;
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
  const relief = doc.reliefs.find((r) => r.id === store.ui.activeRelief) ?? doc.reliefs[0];
  const [resolution, setResolution] = useState(0.25);
  const [profile, setProfile] = useState<Profile>('dome');
  const [height, setHeight] = useState(5);
  const [angle, setAngle] = useState(45);
  const [mode, setMode] = useState<Mode>('add');
  const [smoothR, setSmoothR] = useState(1);
  const [factor, setFactor] = useState(0.5);
  const [imgHeight, setImgHeight] = useState(4);

  if (!relief) {
    return (
      <div className="sidebar-scroll">
        <Section title="Relief" icon={Mountain}>
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
            onChange={(v) => setResolution(Number(v))}
          />
          <Btn
            icon={Plus}
            label="Create relief"
            variant="primary"
            testId="relief-create"
            onClick={() => {
              store.execute(addRelief(resolution));
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

  const addShapes = () => {
    if (closed.length === 0) {
      store.setUi({ message: 'Select closed shapes on the canvas first' });
      return;
    }
    store.execute(
      composite(
        'Shapes to relief',
        closed.map((v) =>
          setReliefOp(relief.id, {
            op: 'fromVector',
            vector: v.id,
            profile,
            height,
            ...(profile === 'angle' ? { angle } : {}),
            mode,
          }),
        ),
      ),
    );
  };

  const addImage = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const { px, w, h } = await imageToGray(file);
      const id = store.addImage(px);
      // Fit the image inside the material, keeping its aspect ratio, centred.
      const s = Math.min(doc.stock.width / w, doc.stock.height / h);
      const W = w * s;
      const H = h * s;
      store.execute(
        setReliefOp(relief.id, {
          op: 'fromImage',
          image: id,
          px: w,
          py: h,
          x: (doc.stock.width - W) / 2,
          y: (doc.stock.height - H) / 2,
          w: W,
          h: H,
          height: imgHeight,
          mode,
        }),
      );
    } catch (e) {
      store.setUi({ message: `Could not read the image: ${(e as Error).message}` });
    }
  };

  return (
    <div className="sidebar-scroll">
      <Section
        title="Relief"
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
            onClick={() => grid && download('relief.stl', reliefToStl(grid), 'model/stl')}
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
          onChange={setProfile}
          testId="relief-profile"
        />
        <div className="grid2">
          <NumberField
            label="Height"
            units={u}
            value={height}
            onCommit={setHeight}
            testId="relief-height"
          />
          {profile === 'angle' && (
            <NumberField label="Angle" suffix="°" min={1} value={angle} onCommit={setAngle} />
          )}
          <SelectField label="Combine" value={mode} options={MODES} onChange={setMode} />
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
          <NumberField label="Image height" units={u} value={imgHeight} onCommit={setImgHeight} />
          <Btn
            icon={ImageIcon}
            label="Add image…"
            onClick={() => void addImage()}
            title="Bright parts become high"
          />
        </div>
      </Section>

      <Section title="Whole relief" icon={Box} collapsible defaultOpen={false}>
        <div className="row">
          <NumberField
            label="Smooth radius"
            units={u}
            min={0.01}
            value={smoothR}
            onCommit={setSmoothR}
          />
          <Btn
            label="Smooth"
            onClick={() =>
              store.execute(setReliefOp(relief.id, { op: 'smooth', radius: smoothR, passes: 3 }))
            }
          />
        </div>
        <div className="row">
          <NumberField label="Height factor" value={factor} onCommit={setFactor} />
          <Btn
            label="Scale"
            onClick={() => store.execute(setReliefOp(relief.id, { op: 'scale', factor }))}
          />
        </div>
        <Btn
          label="Invert (flip high and low)"
          onClick={() => store.execute(setReliefOp(relief.id, { op: 'invert' }))}
        />
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
