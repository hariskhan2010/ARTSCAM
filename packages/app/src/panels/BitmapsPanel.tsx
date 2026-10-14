import { Image as ImageIcon, ImagePlus } from 'lucide-react';
import { addImageRelief } from '../actions';
import type { EditorStore } from '../editor/store';
import { Btn, Hint, NumberField, Section } from './common';

/** Pictures used by the relief (Project tree › Bitmaps). */
export function BitmapsPanel({ store }: { store: EditorStore }) {
  const { doc } = store;
  const f = store.ui.reliefForm;
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
    </div>
  );
}
