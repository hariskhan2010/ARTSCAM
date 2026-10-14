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
import {
  FileDown,
  FilePlus,
  FileUp,
  FolderOpen,
  Redo2,
  Save,
  Shapes,
  Route,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { CamRunner } from './cam/runner';
import { Canvas } from './editor/Canvas';
import { TOOL_INFO } from './editor/CanvasOverlay';
import { useStore, EditorStore, type ToolName } from './editor/store';
import { download, pickFile } from './files';
import { CamPanel } from './panels/CamPanel';
import { Btn } from './panels/common';
import { DesignPanel } from './panels/DesignPanel';

/** Tool palette, grouped: selecting, freehand, shapes, view. */
const TOOL_GROUPS: ToolName[][] = [
  ['select', 'node'],
  ['pen', 'line', 'text'],
  ['rect', 'ellipse', 'polygon', 'star'],
  ['pan'],
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

export function App({ initial }: { initial?: EditorStore } = {}) {
  const store = useMemo(() => initial ?? new EditorStore(newProject()), [initial]);
  const runner = useMemo(() => new CamRunner(() => store.touch()), [store]);
  useEffect(() => () => runner.dispose(), [runner]);
  useStore(store);
  const { ui, doc, history } = store;
  const fmt = (mm: number) => formatFixed(fromMm(mm, doc.units), PRECISION[doc.units].display);
  const unit = doc.units === 'mm' ? 'mm' : 'in';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Route size={16} />
          </span>
          Naqsh <small>beta</small>
        </div>
        <Btn
          icon={FilePlus}
          label="New"
          variant="ghost"
          onClick={() => confirmNew(store)}
          title="Start a new project"
        />
        <Btn
          icon={FolderOpen}
          label="Open"
          variant="ghost"
          onClick={() => void openProject(store)}
          title="Open a project file (.zip)"
        />
        <Btn
          icon={Save}
          label="Save"
          variant="ghost"
          onClick={() => saveProjectFile(store)}
          title="Save the project as a .zip file"
          testId="save"
        />
        <span className="divider" />
        <Btn
          icon={FileUp}
          label="Import"
          variant="ghost"
          onClick={() => void importVectors(store)}
          title="Import shapes from an SVG or DXF file"
          testId="import"
        />
        <Btn
          icon={FileDown}
          label="Export SVG"
          variant="ghost"
          onClick={() => exportSvgFile(store)}
          title="Export the visible shapes as SVG"
          testId="export-svg"
        />
        <span className="divider" />
        <Btn
          icon={Undo2}
          variant="ghost"
          onClick={() => store.undo()}
          disabled={!history.canUndo}
          title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
          testId="undo"
        />
        <Btn
          icon={Redo2}
          variant="ghost"
          onClick={() => store.redo()}
          disabled={!history.canRedo}
          title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Y)` : 'Nothing to redo'}
          testId="redo"
        />
      </header>

      <nav className="toolbox" aria-label="Drawing tools">
        {TOOL_GROUPS.map((group, gi) => (
          <div key={gi} style={{ display: 'contents' }}>
            {gi > 0 && <hr />}
            {group.map((id) => {
              const t = TOOL_INFO[id];
              const Icon = t.icon;
              return (
                <button
                  key={id}
                  className={ui.tool === id ? 'tool active' : 'tool'}
                  data-tip={`${t.name}  (${t.key})`}
                  aria-label={t.name}
                  aria-pressed={ui.tool === id}
                  data-testid={`tool-${id}`}
                  onClick={() => store.setUi({ tool: id })}
                >
                  <Icon size={18} aria-hidden />
                  <kbd aria-hidden>{t.key}</kbd>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <main className="stage">
        <Canvas store={store} runner={runner} />
      </main>

      <aside className="sidebar">
        <div className="steps" role="tablist" aria-label="Workflow">
          <button
            role="tab"
            aria-selected={ui.sidebarTab === 'design'}
            className={ui.sidebarTab === 'design' ? 'active' : ''}
            onClick={() => store.setUi({ sidebarTab: 'design' })}
            data-testid="tab-design"
          >
            <span className="num">1</span>
            <Shapes size={15} aria-hidden /> Design
          </button>
          <button
            role="tab"
            aria-selected={ui.sidebarTab === 'cam'}
            className={ui.sidebarTab === 'cam' ? 'active' : ''}
            onClick={() => store.setUi({ sidebarTab: 'cam' })}
            data-testid="tab-cam"
          >
            <span className="num">2</span>
            <Route size={15} aria-hidden /> Toolpaths
          </button>
        </div>
        {ui.sidebarTab === 'design' ? (
          <DesignPanel store={store} />
        ) : (
          <CamPanel store={store} runner={runner} />
        )}
      </aside>

      <footer className="status">
        <span className="coords">
          {ui.cursor
            ? `X ${fmt(ui.cursor[0])}   Y ${fmt(ui.cursor[1])} ${unit}`
            : 'Move over the canvas'}
        </span>
        <span data-testid="vector-count">{doc.vectors.length} vectors</span>
        <span>{ui.selection.length} selected</span>
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
