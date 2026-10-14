import {
  addVectors,
  exportDxf,
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
  Mountain,
  Shapes,
  Route,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { loadAutosave, saveAutosave } from './autosave';
import { CamRunner } from './cam/runner';
import { Canvas } from './editor/Canvas';
import { TOOL_INFO } from './editor/CanvasOverlay';
import { useStore, EditorStore, type ToolName } from './editor/store';
import { download, pickFile } from './files';
import { CamPanel } from './panels/CamPanel';
import { Btn } from './panels/common';
import { DesignPanel } from './panels/DesignPanel';
import { ReliefPanel } from './panels/ReliefPanel';
import { Relief3D } from './editor/Relief3D';

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
    const { project, images } = loadProject(new Uint8Array(await file.arrayBuffer()));
    store.load(project, images);
    store.setUi({ message: `Opened ${file.name}` });
  } catch (e) {
    store.setUi({ message: (e as Error).message });
  }
}

function saveProjectFile(store: EditorStore) {
  try {
    const bytes = saveProject(store.bundle());
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

function exportDxfFile(store: EditorStore) {
  const { doc } = store;
  const layers = new Map(doc.layers.filter((l) => l.visible).map((l) => [l.id, l.name]));
  const text = exportDxf(
    doc.vectors
      .filter((v) => layers.has(v.layer))
      .map((v) => ({ segments: v.segments, closed: v.closed, layer: layers.get(v.layer) ?? '0' })),
  );
  download('design.dxf', text, 'application/dxf');
}

export function App({ initial }: { initial?: EditorStore } = {}) {
  const store = useMemo(() => initial ?? new EditorStore(newProject()), [initial]);
  const runner = useMemo(
    () =>
      new CamRunner(
        () => store.touch(),
        () => store.images,
      ),
    [store],
  );
  useEffect(() => () => runner.dispose(), [runner]);

  // Restore the last session once, then autosave a second after each change.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    void loadAutosave().then((saved) => {
      if (!active || !saved || store.history.canUndo || store.doc.vectors.length) return;
      if (saved.project.vectors.length === 0 && saved.project.toolpaths.length === 0) return;
      store.load(saved.project, saved.images);
      store.setUi({ message: 'Restored your last session (autosaved in this browser)' });
    });
    const unsubscribe = store.history.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void saveAutosave(store.bundle()), 1000);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [store]);
  useStore(store);
  const { ui, doc, history } = store;
  const fmt = (mm: number) => formatFixed(fromMm(mm, doc.units), PRECISION[doc.units].display);
  const unit = doc.units === 'mm' ? 'mm' : 'in';
  const shownRelief = doc.reliefs.find((r) => r.id === ui.activeRelief) ?? doc.reliefs[0];
  const reliefGrid = shownRelief ? store.relief(shownRelief.id).grid : undefined;

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
        <Btn
          icon={FileDown}
          label="Export DXF"
          variant="ghost"
          onClick={() => exportDxfFile(store)}
          title="Export the visible shapes as DXF (mm)"
          testId="export-dxf"
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
        {ui.show3d && reliefGrid && (
          <Relief3D grid={reliefGrid} onClose={() => store.setUi({ show3d: false })} />
        )}
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
            aria-selected={ui.sidebarTab === 'relief'}
            className={ui.sidebarTab === 'relief' ? 'active' : ''}
            onClick={() => store.setUi({ sidebarTab: 'relief' })}
            data-testid="tab-relief"
          >
            <span className="num">2</span>
            <Mountain size={15} aria-hidden /> Relief
          </button>
          <button
            role="tab"
            aria-selected={ui.sidebarTab === 'cam'}
            className={ui.sidebarTab === 'cam' ? 'active' : ''}
            onClick={() => store.setUi({ sidebarTab: 'cam' })}
            data-testid="tab-cam"
          >
            <span className="num">3</span>
            <Route size={15} aria-hidden /> Toolpaths
          </button>
        </div>
        {ui.sidebarTab === 'design' ? (
          <DesignPanel store={store} />
        ) : ui.sidebarTab === 'relief' ? (
          <ReliefPanel store={store} />
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
