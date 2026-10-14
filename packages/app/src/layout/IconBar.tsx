import type { LucideIcon } from 'lucide-react';
import { COMING_LATER } from './MenuBar';

/** One icon button in a toolbar row, the zoom bar or the left tool strip. */
export interface IconItem {
  icon: LucideIcon;
  title: string;
  onClick?: () => void;
  testId?: string;
  /** Not built yet: shown disabled with the "Coming later" tooltip. */
  later?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  /** Keyboard shortcut letter shown in the corner (tool strip). */
  kbd?: string;
}

export type IconEntry = IconItem | 'sep';

/**
 * Disabled items use aria-disabled rather than `disabled`, so their tooltip
 * still shows on hover (browsers send no mouse events to disabled buttons).
 */
export function IconButton({ item }: { item: IconItem }) {
  const Icon = item.icon;
  const off = item.later || item.disabled;
  const label = item.later ? `${item.title} (${COMING_LATER})` : item.title;
  const text = item.kbd ? `${label}  (${item.kbd})` : label;
  return (
    <button
      type="button"
      className={['icon-btn', item.pressed ? 'active' : '', off ? 'off' : ''].join(' ').trim()}
      aria-label={item.title}
      aria-disabled={off || undefined}
      aria-pressed={item.pressed}
      title={text}
      data-testid={item.testId}
      onClick={() => {
        if (!off) item.onClick?.();
      }}
    >
      <Icon size={17} aria-hidden />
      {item.kbd && <kbd aria-hidden>{item.kbd}</kbd>}
    </button>
  );
}

export function IconBar(props: {
  items: IconEntry[];
  label: string;
  className?: string;
  vertical?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={`iconbar ${props.vertical ? 'vertical' : ''} ${props.className ?? ''}`.trim()}
      role="toolbar"
      aria-label={props.label}
      aria-orientation={props.vertical ? 'vertical' : 'horizontal'}
      data-testid={props.testId}
    >
      {props.items.map((it, i) =>
        it === 'sep' ? (
          <span key={`s${i}`} className="sep" role="separator" />
        ) : (
          <IconButton key={it.testId ?? it.title} item={it} />
        ),
      )}
    </div>
  );
}
