import { Image as ImageIcon, ImagePlus, ScanLine } from 'lucide-react';
import { addImageRelief, traceImage } from '../actions';
import type { EditorStore, TraceForm } from '../editor/store';
import { Btn, Hint, NumberField, Section, Switch } from './common';

/** Pictures used by the relief (Project tree › Bitmaps). */
export function BitmapsPanel({ store }: { store: EditorStore }) {
  const { doc } = store;
  const f = store.ui.reliefForm;
  const t = store.ui.traceForm;
  const setTrace = (patch: Partial<TraceForm>) => store.setUi({ traceForm: { ...t, ...patch } });
  const images = doc.reliefs.flatMap((r) =>
    r.ops.flatMap((o) => (o.op === 'fromImage' ? [{ relief: r.id, op: o }] : [])),
  );
  return (
    <div className="sidebar-scroll">
      <Section title="Bitmaps" icon={ImageIcon}>
        <Hint>
          A picture becomes part of the relief: bright parts high, dark parts low. Photos work best
          with a plain background.
        </Hint>
        <div className="row">
          <NumberField
            label="Image height"
            units={doc.units}
            value={f.imageHeight}
            onCommit={(imageHeight) => store.setUi({ reliefForm: { ...f, imageHeight } })}
          />
          <Btn
            icon={ImagePlus}
            label="Image to relief…"
            onClick={() => void addImageRelief(store)}
            testId="bitmap-add"
          />
        </div>
        {images.length === 0 ? (
          <Hint>No pictures yet.</Hint>
        ) : (
          <ul className="list" data-testid="bitmap-list">
            {images.map(({ op }, i) => (
              <li key={i} onClick={() => store.setUi({ sidebarTab: 'relief' })}>
                <ImageIcon size={14} aria-hidden />
                <span className="name">
                  {op.px}×{op.py} px · {op.height} mm{op.invert ? ' · inverted' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Trace image to vectors" icon={ScanLine}>
        <Hint>
          Outlines the dark parts of a picture as one vector (holes included). Logos and line art on
          a plain background trace best.
        </Hint>
        <div className="row">
          <NumberField
            label="Threshold"
            value={t.threshold}
            min={0}
            step={1}
            decimals={0}
            testId="trace-threshold"
            help="Gray level 0–255: pixels darker than this are traced"
            onCommit={(threshold) => setTrace({ threshold: Math.min(255, Math.round(threshold)) })}
          />
          <NumberField
            label="Smoothness"
            value={t.smooth}
            min={0}
            step={0.1}
            decimals={2}
            testId="trace-smooth"
            help="0 = straight lines between points, 1 = smooth curves"
            onCommit={(smooth) => setTrace({ smooth: Math.min(1, smooth) })}
          />
        </div>
        <div className="row">
          <NumberField
            label="Ignore specks under"
            suffix="px"
            value={t.specks}
            min={0}
            step={1}
            decimals={0}
            testId="trace-specks"
            help="Outlines enclosing fewer pixels than this are left out"
            onCommit={(specks) => setTrace({ specks })}
          />
          <NumberField
            label="Width"
            units={doc.units}
            value={t.width}
            min={0.001}
            disabled={t.fit}
            testId="trace-width"
            help="Width of the traced picture on the material"
            onCommit={(width) => setTrace({ width })}
          />
        </div>
        <Switch
          label="Trace light parts instead (invert)"
          checked={t.invert}
          testId="trace-invert"
          onChange={(invert) => setTrace({ invert })}
        />
        <Switch
          label="Fit to the material"
          checked={t.fit}
          testId="trace-fit"
          onChange={(fit) => setTrace({ fit })}
        />
        <Btn
          icon={ScanLine}
          label="Trace image to vectors…"
          onClick={() => void traceImage(store)}
          testId="bitmap-trace"
        />
      </Section>
    </div>
  );
}
