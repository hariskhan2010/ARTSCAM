import {
  addVectors,
  layoutText,
  regionToSegments,
  setVectorText,
  transformSegments,
  translation,
  type Matrix,
  type TextAlign,
  type TextSource,
} from '@naqsh/core';
import { Check, TextAlignCenter, TextAlignEnd, TextAlignStart, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Btn, Hint, NumberField, Segmented, SelectField } from '../panels/common';
import { addUserFont, allFonts } from '../text/fonts';
import { pickFile } from '../files';
import type { EditorStore, TextDraft } from './store';

/** Where the laid-out text goes: its saved placement, or a move to the click point. */
function placement(draft: TextDraft): Matrix {
  return draft.matrix ?? translation(draft.at[0], draft.at[1]);
}

/**
 * Card for typing text with the Text tool. The text is shaped (HarfBuzz) as
 * you type and previewed on the canvas; "Add text" turns the outline into a
 * closed vector ready for V-carving.
 */
export function TextEditor({ store }: { store: EditorStore }) {
  const draft = store.ui.textDraft;
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [, setFontsVersion] = useState(0);

  // Lay out the draft whenever it changes; fonts load on first use.
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    const family = allFonts().find((f) => f.id === draft.fontId) ?? allFonts()[0];
    if (!family) return;
    family
      .load()
      .then((fonts) => {
        if (cancelled) return;
        if (!draft.text.trim()) {
          store.setUi({ textPreview: undefined });
          setMissing([]);
          return;
        }
        const { region, missing: miss } = layoutText(draft.text, {
          size: draft.size,
          fonts,
          align: draft.align,
        });
        store.setUi({
          textPreview: transformSegments(regionToSegments(region), placement(draft)),
        });
        setMissing(miss);
        setError(undefined);
      })
      .catch((e: unknown) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
    // store is stable; only the draft's content matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) return null;
  const set = (patch: Partial<typeof draft>) => store.setUi({ textDraft: { ...draft, ...patch } });
  const cancel = () => store.setUi({ textDraft: undefined, textPreview: undefined });
  const add = () => {
    const segments = store.ui.textPreview;
    if (!segments?.length) return;
    const text: TextSource = {
      content: draft.text,
      fontId: draft.fontId,
      size: draft.size,
      align: draft.align,
      matrix: [...placement(draft)],
    };
    if (draft.editing) {
      store.execute(setVectorText(draft.editing, text, segments));
    } else {
      store.execute(
        addVectors([{ layer: store.ui.activeLayer, closed: true, segments, text }], 'Add text'),
      );
    }
    const id = draft.editing ?? store.doc.vectors.at(-1)?.id;
    store.setUi({ textDraft: undefined, textPreview: undefined, tool: 'select' });
    if (id) store.select([id]);
  };

  const loadFontFile = async () => {
    const file = await pickFile('.ttf,.otf,.woff');
    if (!file) return;
    try {
      const family = await addUserFont(file);
      setFontsVersion((v) => v + 1);
      set({ fontId: family.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="text-editor">
      <textarea
        dir="auto"
        rows={2}
        autoFocus
        placeholder="Type here… / یہاں لکھیں"
        value={draft.text}
        data-testid="text-input"
        onChange={(e) => set({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
        }}
      />
      <SelectField
        label="Font"
        value={draft.fontId}
        testId="text-font"
        options={[
          ...allFonts().map((f) => ({ value: f.id, label: f.name })),
          { value: '__load', label: 'Load a font file…' },
        ]}
        onChange={(id) => (id === '__load' ? void loadFontFile() : set({ fontId: id }))}
      />
      <div className="grid2">
        <NumberField
          label="Size"
          units={store.doc.units}
          min={0.5}
          value={draft.size}
          testId="text-size"
          help="Font size (em height). Capital and tall letters are roughly 70–75 % of this."
          onCommit={(size) => set({ size })}
        />
      </div>
      <Segmented<TextAlign>
        label="Align to the click point"
        value={draft.align}
        options={[
          { value: 'left', label: 'Left', icon: TextAlignStart },
          { value: 'center', label: 'Centre', icon: TextAlignCenter },
          { value: 'right', label: 'Right', icon: TextAlignEnd },
        ]}
        onChange={(align) => set({ align })}
      />
      {missing.length > 0 && (
        <Hint tone="warn">This font has no glyph for: {missing.join(' ')}</Hint>
      )}
      {error && <Hint tone="error">{error}</Hint>}
      <div className="row">
        <Btn
          icon={Check}
          label={draft.editing ? 'Update text' : 'Add text'}
          variant="primary"
          disabled={!store.ui.textPreview?.length}
          onClick={add}
          testId="text-add"
          title={
            draft.editing
              ? 'Replace the shape with the edited text (Ctrl+Enter)'
              : 'Add the text as a shape (Ctrl+Enter)'
          }
        />
        <Btn icon={X} label="Cancel" variant="ghost" onClick={cancel} testId="text-cancel" />
      </div>
    </div>
  );
}
