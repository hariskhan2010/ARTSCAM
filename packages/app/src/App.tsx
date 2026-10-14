import { newProject } from '@naqsh/core';
import { Box, Mountain, PenTool } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { loadAutosave, saveAutosave } from './autosave';
import { CamRunner } from './cam/runner';
import { Canvas } from './editor/Canvas';
import { Relief3D } from './editor/Relief3D';
import { useStore, EditorStore } from './editor/store';
import { zoomPercent } from './editor/viewActions';
import { menus, toolbarRow1, toolbarRow2, toolStrip, zoomBar } from './layout/commands';
import { IconBar } from './layout/IconBar';
import { ModelInfo, StatusBar } from './layout/Info';
import { MenuBar } from './layout/MenuBar';
import { ProjectTree } from './layout/ProjectTree';
import { Rulers } from './layout/Rulers';
import { BitmapsPanel } from './panels/BitmapsPanel';
import { CamPanel } from './panels/CamPanel';
import { DesignPanel } from './panels/DesignPanel';
import { ReliefPanel } from './panels/ReliefPanel';

/**
 * Window layout, in the places ex-ArtCAM users expect them (our own icons,
 * colours and wording): menu bar; two toolbar rows; the drawing tool strip
 * on the left; 2D/3D view tabs with a zoom bar, rulers and the canvas in the
 * middle; the Project tree, the picked item's panel and Model Information on
 * the right; and the status bar at the bottom.
 */
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
  const { ui, doc } = store;
  const shownRelief = doc.reliefs.find((r) => r.id === ui.activeRelief) ?? doc.reliefs[0];
  const reliefGrid = shownRelief ? store.relief(shownRelief.id).grid : undefined;

  return (
    <div className="app">
      <MenuBar menus={menus(store, runner)} />
      <IconBar items={toolbarRow1(store)} label="File and vector tools" className="toolbar-row" />
      <IconBar
        items={toolbarRow2(store)}
        label="View, relief and toolpath tools"
        className="toolbar-row"
      />

      <IconBar items={toolStrip(store)} label="Drawing tools" vertical className="toolbox" />

      <main className="stage">
        <div className="stage-bar">
          <div className="view-tabs" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={!ui.show3d}
              className={!ui.show3d ? 'active' : ''}
              onClick={() => store.setUi({ show3d: false })}
              data-testid="view-2d"
            >
              <PenTool size={13} aria-hidden /> 2D View
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ui.show3d}
              className={ui.show3d ? 'active' : ''}
              onClick={() => store.setUi({ show3d: true })}
              data-testid="view-3d"
            >
              <Box size={13} aria-hidden /> 3D View
            </button>
          </div>
          {!ui.show3d && (
            <>
              <IconBar items={zoomBar(store)} label="Zoom" className="zoom-bar" />
              <span className="zoom" data-testid="zoom" title="Zoom (100% fits the material)">
                {zoomPercent(store)}%
              </span>
            </>
          )}
        </div>
        <div className="stage-body">
          <Rulers store={store} />
          <div className="canvas-wrap">
            <Canvas store={store} runner={runner} />
          </div>
          {ui.show3d &&
            (reliefGrid ? (
              <Relief3D grid={reliefGrid} onClose={() => store.setUi({ show3d: false })} />
            ) : (
              <div className="relief-3d empty" data-testid="relief-3d-empty">
                <Mountain size={28} aria-hidden />
                <p>No relief yet. Draw shapes, then use Relief › Shape to relief.</p>
              </div>
            ))}
        </div>
      </main>

      <aside className="sidebar">
        <ProjectTree store={store} />
        <div className="panel-host">
          {ui.sidebarTab === 'design' ? (
            <DesignPanel store={store} />
          ) : ui.sidebarTab === 'bitmaps' ? (
            <BitmapsPanel store={store} />
          ) : ui.sidebarTab === 'relief' ? (
            <ReliefPanel store={store} />
          ) : (
            <CamPanel store={store} runner={runner} />
          )}
        </div>
        <ModelInfo store={store} />
      </aside>

      <StatusBar store={store} />
    </div>
  );
}
