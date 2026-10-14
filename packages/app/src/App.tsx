import {
  addVectors,
  exportSvg,
  formatFixed,
  fromMm,
  importDxf,
  importSvg,
  loadProject,
  newProject,
  saveProject,
  PRECISION,
} from '@naqsh/core';
import { useEffect, useMemo, type ReactNode } from 'react';
import { CamRunner } from './cam/runner';
import { Canvas } from './editor/Canvas';
import { useStore, EditorStore, type ToolName } from './editor/store';
import { download, pickFile } from './files';
import { CamPanel } from './panels/CamPanel';
import { DesignPanel } from './panels/DesignPanel';
import { appTitle } from './title';

const TOOLS: { id: ToolName; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select / transform', key: 'V', icon: '↖' },
  { id: 'node', label: 'Edit nodes', key: 'N', icon: '◇' },
  { id: 'pen', label: 'Pen (click = corner, drag = curve, Enter = finish)', key: 'P', icon: '✒' },
  { id: 'rect', label: 'Rectangle (Shift = square)', key: 'R', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse (Shift = circle)', key: 'E', icon: '◯' },
  { id: 'polygon', label: 'Polygon', key: 'G', icon: '⬡' },
  { id: 'star', label: 'Star', key: 'S', icon: '☆' },
  { id: 'line', label: 'Line', key: 'L', icon: '╱' },
  { id: 'pan', label: 'Pan (or Space / middle-drag)', key: 'H', icon: '✋' },
];

async function openProject(store: EditorStore) {
  const file = await pickFile('.zip,.naqsh');
  if (!file) return;
  try {
    const { project, reliefData } = loadProject(new Uint8Array(await file.arrayBuffer()));
    store.load(project, reliefData);
    store.setUi({ message: `Opened ${file.name}` });
  } catch (e) {
    store.setUi({ message: (e as Error).message });
  }
}

function saveProjectFile(store: EditorStore) {
  try {
    const bytes = saveProject({ project: store.doc, reliefData: store.reliefData });
    download('project.naqsh.zip', bytes, 'application/zip');
  } catch (e) {
    store.setUi({ message: (e as Error).message });
  }
}

async function importVectors(store: EditorStore) {
  const file = await pickFile('.svg,.dxf');
  if (!file) return;
  const text = await file.text();
  try {
    const layer = store.ui.activeLayer;
    const isDxf = file.name.toLowerCase().endsWith('.dxf');
    const result = isDxf ? importDxf(text) : importSvg(text);
    const vectors = result.vectors.map((v) => ({ layer, closed: v.closed, segments: v.segments }));
    const before = new Set(store.doc.vectors.map((v) => v.id));
    store.execute(addVectors(vectors, `Import ${file.name}`));
    store.select(store.doc.vectors.filter((v) => !before.has(v.id)).map((v) => v.id));
    const warn = result.warnings.length ? ` — ${result.warnings.join('; ')}` : '';
    store.setUi({ message: `Imported ${vectors.length} vectors from ${file.name}${warn}` });
  } catch (e) {
    store.setUi({ message: `Import failed: ${(e as Error).message}` });
  }
}

function exportSvgFile(store: EditorStore) {
  const { doc } = store;
  const visible = new Set(doc.layers.filter((l) => l.visible).map((l) => l.id));
  const text = exportSvg(
    doc.vectors.filter((v) => visible.has(v.layer)),
    { width: doc.stock.width, height: doc.stock.height },
  );
  download('design.svg', text, 'image/svg+xml');
}

function Button(props: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      disabled={props.disabled}
      data-testid={props.testId}
    >
      {props.children}
    </button>
  );
}

export function App({ initial }: { initial?: EditorStore } = {}) {
  const store = useMemo(() => initial ?? new EditorStore(newProject()), [initial]);
  const runner = useMemo(() => new CamRunner(() => store.touch()), [store]);
  useEffect(() => () => runner.dispose(), [runner]);
  useStore(store);
  const { ui, doc, history } = store;
  const fmt = (mm: number) => formatFixed(fromMm(mm, doc.units), PRECISION[doc.units].display);

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">{appTitle()}</strong>
        <nav>
          <Button onClick={() => confirmNew(store)} title="New project">
            New
          </Button>
          <Button onClick={() => void openProject(store)} title="Open a project .zip">
            Open
          </Button>
          <Button
            onClick={() => saveProjectFile(store)}
            title="Save the project as .zip"
            testId="save"
          >
            Save
          </Button>
          <span className="sep" />
          <Button
            onClick={() => void importVectors(store)}
            title="Import SVG or DXF"
            testId="import"
          >
            Import
          </Button>
          <Button
            onClick={() => exportSvgFile(store)}
            title="Export visible vectors as SVG"
            testId="export-svg"
          >
            Export SVG
          </Button>
          <span className="sep" />
          <Button
            onClick={() => store.undo()}
            disabled={!history.canUndo}
            title={`Undo ${history.undoLabel ?? ''} (Ctrl+Z)`}
            testId="undo"
          >
            Undo
          </Button>
          <Button
            onClick={() => store.redo()}
            disabled={!history.canRedo}
            title={`Redo ${history.redoLabel ?? ''} (Ctrl+Y)`}
            testId="redo"
          >
            Redo
          </Button>
          <span className="sep" />
          <label className="toggle">
            <input
              type="checkbox"
              checked={ui.snapGrid}
              onChange={(e) => store.setUi({ snapGrid: e.target.checked })}
            />{' '}
            Snap grid
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={ui.snapPoints}
              onChange={(e) => store.setUi({ snapPoints: e.target.checked })}
            />{' '}
            Snap nodes
          </label>
          <Button onClick={() => store.setUi({ view: undefined })} title="Fit the stock in view">
            Fit
          </Button>
        </nav>
      </header>

      <aside className="toolbox" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={ui.tool === t.id ? 'tool active' : 'tool'}
            title={`${t.label} (${t.key})`}
            aria-pressed={ui.tool === t.id}
            data-testid={`tool-${t.id}`}
            onClick={() => store.setUi({ tool: t.id })}
          >
            <span aria-hidden>{t.icon}</span>
          </button>
        ))}
        {(ui.tool === 'polygon' || ui.tool === 'star') && (
          <label className="sides" title={ui.tool === 'star' ? 'Points' : 'Sides'}>
            <input
              type="number"
              min={ui.tool === 'star' ? 2 : 3}
              max={64}
              value={ui.sides}
              onChange={(e) =>
                store.setUi({
                  sides: Math.max(2, Math.min(64, Math.round(Number(e.target.value) || 3))),
                })
              }
            />
          </label>
        )}
      </aside>

      <main className="stage">
        <Canvas store={store} runner={runner} />
      </main>

      <aside className="sidebar">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={ui.sidebarTab === 'design'}
            className={ui.sidebarTab === 'design' ? 'active' : ''}
            onClick={() => store.setUi({ sidebarTab: 'design' })}
            data-testid="tab-design"
          >
            Design
          </button>
          <button
            role="tab"
            aria-selected={ui.sidebarTab === 'cam'}
            className={ui.sidebarTab === 'cam' ? 'active' : ''}
            onClick={() => store.setUi({ sidebarTab: 'cam' })}
            data-testid="tab-cam"
          >
            Toolpaths
          </button>
        </div>
        {ui.sidebarTab === 'design' ? (
          <DesignPanel store={store} />
        ) : (
          <CamPanel store={store} runner={runner} />
        )}
      </aside>

      <footer className="status">
        <span data-testid="vector-count">{doc.vectors.length} vectors</span>
        <span>{ui.selection.length} selected</span>
        <span>
          {ui.cursor
            ? `X ${fmt(ui.cursor[0])}  Y ${fmt(ui.cursor[1])} ${doc.units === 'mm' ? 'mm' : 'in'}`
            : ''}
        </span>
        <span className="message" role="status" data-testid="message">
          {ui.message}
        </span>
      </footer>
    </div>
  );
}

function confirmNew(store: EditorStore) {
  if (
    store.doc.vectors.length > 0 &&
    !window.confirm('Start a new project? Unsaved changes are lost.')
  )
    return;
  store.load(newProject());
}
