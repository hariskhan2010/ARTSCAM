import { PRECISION, formatFixed, fromMm, toMm, type Units } from '@naqsh/core';
import { useState, type ReactNode } from 'react';

/** A number input that commits on Enter or blur, showing mm values in the display unit. */
export function NumberField(props: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  /** When given, `value` is mm and is shown/edited in this unit. */
  units?: Units;
  min?: number;
  step?: number;
  decimals?: number;
  testId?: string;
  disabled?: boolean;
}) {
  const { units } = props;
  const shown = units ? fromMm(props.value, units) : props.value;
  const decimals = props.decimals ?? (units ? PRECISION[units].display : 3);
  const text = Number.isFinite(shown) ? formatFixed(shown, decimals, true) : '';
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const commit = () => {
    if (draft === undefined) return;
    const n = Number(draft);
    setDraft(undefined);
    if (!Number.isFinite(n) || draft.trim() === '') return;
    if (props.min !== undefined && n < props.min) return;
    const mm = units ? toMm(n, units) : n;
    if (mm !== props.value) props.onCommit(mm);
  };

  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={props.step ?? 'any'}
        value={draft ?? text}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(undefined);
        }}
      />
      {units && <em>{units === 'mm' ? 'mm' : 'in'}</em>}
    </label>
  );
}

export function Section(props: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h2>{props.title}</h2>
        {props.actions}
      </header>
      {props.children}
    </section>
  );
}
