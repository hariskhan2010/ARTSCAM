import { PRECISION, formatFixed, fromMm, toMm, type Units } from '@naqsh/core';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * Shared panel controls. Every field shows its label above the input and its
 * unit inside the input, so a value always reads "Cut depth · 18 mm".
 */

export function NumberField(props: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  /** When given, `value` is mm and is shown/edited in this unit. */
  units?: Units;
  /** Text after the unit, e.g. "/min" for feeds, or a unit of its own ("°", "s", "rpm"). */
  suffix?: string;
  min?: number;
  step?: number;
  decimals?: number;
  testId?: string;
  disabled?: boolean;
  /** Tooltip explaining the value. */
  help?: string;
}) {
  const { units } = props;
  const shown = units ? fromMm(props.value, units) : props.value;
  const decimals = props.decimals ?? (units ? PRECISION[units].display : 3);
  const text = Number.isFinite(shown) ? formatFixed(shown, decimals, true) : '';
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const unitText = `${units ? (units === 'mm' ? 'mm' : 'in') : ''}${props.suffix ?? ''}`;

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
    <label className="field" title={props.help}>
      <span className="field-label">{props.label}</span>
      <span className={props.disabled ? 'input disabled' : 'input'}>
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
        {unitText && <em>{unitText}</em>}
      </span>
    </label>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  testId?: string;
  help?: string;
}) {
  return (
    <label className="field" title={props.help}>
      <span className="field-label">{props.label}</span>
      <span className="input">
        <select
          value={props.value}
          onChange={(e) => props.onChange(e.target.value as T)}
          data-testid={props.testId}
        >
          {props.options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden className="select-chevron" />
      </span>
    </label>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  testId?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <span className="input">
        <input
          defaultValue={props.value}
          key={props.value}
          data-testid={props.testId}
          onBlur={(e) => e.target.value !== props.value && props.onCommit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </span>
    </label>
  );
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string>(props: {
  label?: string;
  value: T;
  options: readonly { value: T; label: string; icon?: LucideIcon; help?: string }[];
  onChange: (value: T) => void;
  testId?: string;
}) {
  return (
    <div className="field">
      {props.label && <span className="field-label">{props.label}</span>}
      <div className="segmented" role="radiogroup" data-testid={props.testId}>
        {props.options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={o.value === props.value}
              className={o.value === props.value ? 'on' : ''}
              title={o.help}
              data-value={o.value}
              onClick={() => props.onChange(o.value)}
            >
              {Icon && <Icon size={14} aria-hidden />}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Switch(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
  help?: string;
}) {
  return (
    <label className="switch" title={props.help}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        data-testid={props.testId}
      />
      <span className="track" aria-hidden />
      <span>{props.label}</span>
    </label>
  );
}

export function Btn(props: {
  icon?: LucideIcon;
  label?: string;
  onClick: () => void;
  variant?: 'primary' | 'danger' | 'ghost' | 'default';
  disabled?: boolean;
  title?: string;
  testId?: string;
  pressed?: boolean;
  wide?: boolean;
}) {
  const Icon = props.icon;
  const cls = [
    'btn',
    props.variant ?? 'default',
    props.label ? '' : 'icon-only',
    props.wide ? 'wide' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title ?? props.label}
      aria-label={props.label ? undefined : props.title}
      aria-pressed={props.pressed}
      data-testid={props.testId}
    >
      {Icon && <Icon size={16} aria-hidden />}
      {props.label && <span>{props.label}</span>}
    </button>
  );
}

/** A panel section; `collapsible` ones remember nothing and start open unless told. */
export function Section(props: {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const Icon = props.icon;
  const head = (
    <>
      {Icon && <Icon size={15} aria-hidden />}
      <h2>{props.title}</h2>
      <span className="grow" />
      {/* Clicking an action must not also open/close a collapsible section. */}
      {props.actions && <span onClick={(e) => e.preventDefault()}>{props.actions}</span>}
    </>
  );
  if (props.collapsible) {
    return (
      <details className="panel" open={props.defaultOpen ?? true}>
        <summary>
          {head}
          <ChevronDown size={15} className="chevron" aria-hidden />
        </summary>
        <div className="panel-body">{props.children}</div>
      </details>
    );
  }
  return (
    <section className="panel">
      <header>{head}</header>
      <div className="panel-body">{props.children}</div>
    </section>
  );
}

export function Hint(props: { children: ReactNode; tone?: 'info' | 'warn' | 'error' | 'ok' }) {
  return <p className={`hint-box ${props.tone ?? 'info'}`}>{props.children}</p>;
}
