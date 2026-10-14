import { Route } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * The window's menu bar (File, Edit, View, …). Click a title to open its
 * menu; while one is open, hovering another title switches to it, like a
 * desktop menu bar. Items for features that do not exist yet are shown
 * disabled with the tooltip "Coming later".
 */

export const COMING_LATER = 'Coming later';

export type MenuEntry =
  | {
      label: string;
      onClick?: () => void;
      /** Not built yet: shown disabled with the "Coming later" tooltip. */
      later?: boolean;
      disabled?: boolean;
      /** Shown on the right, e.g. "Ctrl+Z". */
      shortcut?: string;
      checked?: boolean;
      title?: string;
    }
  | 'separator';

export interface MenuDef {
  title: string;
  items: MenuEntry[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && bar.current?.contains(e.target as Node)) return;
      setOpen(undefined);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="menubar" ref={bar} role="menubar" aria-label="Main menu">
      <span className="brand" aria-label="Naqsh">
        <span className="brand-mark" aria-hidden>
          <Route size={13} />
        </span>
        Naqsh
      </span>
      {menus.map((m) => {
        const id = slug(m.title);
        const isOpen = open === m.title;
        return (
          <div key={m.title} className="menu">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className={isOpen ? 'menu-title open' : 'menu-title'}
              data-testid={`menu-${id}`}
              onClick={() => setOpen(isOpen ? undefined : m.title)}
              onPointerEnter={() => open && setOpen(m.title)}
            >
              {m.title}
            </button>
            {isOpen && (
              <div className="menu-pop" role="menu" aria-label={m.title}>
                {m.items.map((it, i) => {
                  if (it === 'separator') return <hr key={`s${i}`} />;
                  const off = it.later || it.disabled;
                  return (
                    <button
                      key={it.label}
                      type="button"
                      role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                      aria-checked={it.checked}
                      aria-disabled={off || undefined}
                      className={off ? 'menu-item off' : 'menu-item'}
                      title={it.later ? COMING_LATER : it.title}
                      data-testid={`mi-${id}-${slug(it.label)}`}
                      onClick={() => {
                        if (off) return;
                        setOpen(undefined);
                        it.onClick?.();
                      }}
                    >
                      <span className="check" aria-hidden>
                        {it.checked ? '✓' : ''}
                      </span>
                      <span className="text">{it.label}</span>
                      <span className="shortcut">{it.later ? 'later' : (it.shortcut ?? '')}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
