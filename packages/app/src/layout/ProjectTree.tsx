import { addLayer } from '@naqsh/core';
import {
  Folder,
  Image as ImageIcon,
  Layers,
  Mountain,
  Plus,
  Route,
  Shapes,
  Sheet,
  SquareStack,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { addImageRelief, ensureRelief, openReliefSide } from '../actions';
import { shownRelief, type EditorStore, type SidebarTab } from '../editor/store';
import { COMING_LATER } from './MenuBar';
import { TOOL_ICON } from './commands';

/**
 * The Project tree (top right): every part of the model, in ArtCAM's order.
 * Picking a branch shows its panel below the tree; + buttons create things.
 */

function Node(props: {
  icon: LucideIcon;
  label: string;
  depth?: number;
  selected?: boolean;
  later?: boolean;
  count?: number | undefined;
  testId?: string;
  onClick?: () => void;
  add?: { title: string; onClick: () => void; testId: string } | undefined;
  children?: ReactNode;
}) {
  const Icon = props.icon;
  const depth = props.depth ?? 0;
  return (
    <li role="none">
      <div
        role="treeitem"
        tabIndex={props.later ? -1 : 0}
        aria-selected={props.selected ?? false}
        aria-disabled={props.later || undefined}
        aria-expanded={props.children ? true : undefined}
        aria-level={depth + 1}
        className={[
          'tree-row',
          props.selected ? 'selected' : '',
          props.later ? 'off' : '',
          depth ? 'child' : '',
        ].join(' ')}
        style={{ paddingLeft: 6 + depth * 16 }}
        title={props.later ? COMING_LATER : undefined}
        data-testid={props.testId}
        onClick={() => !props.later && props.onClick?.()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !props.later) {
            e.preventDefault();
            props.onClick?.();
          }
        }}
      >
        <Icon size={14} aria-hidden />
        <span className="tree-label">{props.label}</span>
        {props.count !== undefined && <span className="chip muted">{props.count}</span>}
        {props.add && (
          <button
            type="button"
            className="tree-add"
            title={props.add.title}
            aria-label={props.add.title}
            data-testid={props.add.testId}
            onClick={(e) => {
              e.stopPropagation();
              props.add?.onClick();
            }}
          >
            <Plus size={13} aria-hidden />
          </button>
        )}
      </div>
      {props.children && <ul role="group">{props.children}</ul>}
    </li>
  );
}

export function ProjectTree({ store }: { store: EditorStore }) {
  const { doc, ui } = store;
  const tab = ui.sidebarTab;
  const open = (sidebarTab: SidebarTab, patch: Parameters<EditorStore['setUi']>[0] = {}) =>
    store.setUi({ sidebarTab, ...patch });
  const images = doc.reliefs.flatMap((r) => r.ops.filter((o) => o.op === 'fromImage'));
  const clips = doc.reliefs.flatMap((r) => r.ops.filter((o) => o.op === 'paste'));
  const front = shownRelief(doc, { ...ui, reliefSide: 'front' });
  const back = shownRelief(doc, { ...ui, reliefSide: 'back' });
  const reliefNode = (side: 'front' | 'back') => {
    const relief = side === 'front' ? front : back;
    const label = side === 'front' ? 'Front Relief' : 'Back Relief';
    return (
      <Node
        icon={Mountain}
        label={label}
        count={relief ? relief.ops.length : undefined}
        selected={tab === 'relief' && ui.reliefSide === side}
        testId={side === 'front' ? 'tab-relief' : 'tree-back-relief'}
        onClick={() => openReliefSide(store, side)}
        add={
          relief
            ? undefined
            : {
                title: side === 'front' ? 'Create the relief' : 'Create the back relief',
                testId: side === 'front' ? 'tree-add-relief' : 'tree-add-back-relief',
                onClick: () => {
                  openReliefSide(store, side);
                  ensureRelief(store);
                },
              }
        }
      />
    );
  };

  return (
    <nav className="project-tree" aria-label="Project">
      <div className="tree-head">
        <Folder size={14} aria-hidden /> Project
      </div>
      <ul role="tree" aria-label="Project">
        <Node
          icon={Shapes}
          label="Vectors"
          count={doc.vectors.length}
          selected={tab === 'design'}
          testId="tab-design"
          onClick={() => open('design')}
          add={{
            title: 'New vector layer',
            testId: 'tree-add-layer',
            onClick: () => {
              store.execute(addLayer(`Layer ${doc.layers.length + 1}`));
              open('design');
            },
          }}
        >
          {doc.layers.map((l) => (
            <Node
              key={l.id}
              icon={Layers}
              label={l.name}
              depth={1}
              count={doc.vectors.filter((v) => v.layer === l.id).length}
              selected={tab === 'design' && ui.activeLayer === l.id}
              testId={`tree-layer-${l.id}`}
              onClick={() => open('design', { activeLayer: l.id })}
            />
          ))}
        </Node>
        <Node
          icon={ImageIcon}
          label="Bitmaps"
          count={images.length}
          selected={tab === 'bitmaps'}
          testId="tree-bitmaps"
          onClick={() => open('bitmaps')}
          add={{
            title: 'Image to relief…',
            testId: 'tree-add-bitmap',
            onClick: () => {
              open('bitmaps');
              void addImageRelief(store);
            },
          }}
        />
        {reliefNode('front')}
        {reliefNode('back')}
        <Node
          icon={SquareStack}
          label="Clipart"
          count={clips.length}
          selected={tab === 'clipart'}
          testId="tree-clipart"
          onClick={() => open('clipart')}
        />
        <Node icon={Sheet} label="Sheets" later testId="tree-sheets" />
        <Node
          icon={Route}
          label="Toolpaths"
          count={doc.toolpaths.length}
          selected={tab === 'cam'}
          testId="tab-cam"
          onClick={() => open('cam')}
          add={{
            title: 'New toolpath',
            testId: 'tree-add-toolpath',
            onClick: () => open('cam'),
          }}
        >
          {doc.toolpaths.map((t) => (
            <Node
              key={t.id}
              icon={TOOL_ICON[t.type]}
              label={t.name ?? t.id}
              depth={1}
              selected={tab === 'cam' && ui.activeToolpath === t.id}
              testId={`tree-tp-${t.id}`}
              onClick={() => open('cam', { activeToolpath: t.id })}
            />
          ))}
        </Node>
      </ul>
    </nav>
  );
}
