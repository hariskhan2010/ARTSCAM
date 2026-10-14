import {
  AVAILABLE_POSTS,
  TOOL_PRESETS,
  addTool,
  addToolpath,
  deleteTool,
  deleteToolpath,
  formatDuration,
  formatLength,
  setMachine,
  toolLabel,
  toolProblems,
  updateTool,
  updateToolpath,
  type Project,
  type Tool,
  type Toolpath,
} from '@naqsh/core';
import { useEffect } from 'react';
import type { CamRunner } from '../cam/runner';
import type { EditorStore } from '../editor/store';
import { download } from '../files';
import { NumberField, Section } from './common';

type Units = Project['units'];

function MachineSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const m = doc.machine;
  const set = (patch: Partial<Project['machine']>) => store.execute(setMachine({ ...m, ...patch }));
  return (
    <Section title="Machine">
      <div className="grid2">
        <label className="field">
          <span>Post</span>
          <select
            value={m.post}
            onChange={(e) => set({ post: e.target.value as Project['machine']['post'] })}
          >
            {(['grbl', 'mach3', 'linuxcnc', 'generic'] as const).map((p) => (
              <option key={p} value={p} disabled={!AVAILABLE_POSTS.includes(p)}>
                {p === 'grbl' ? 'GRBL' : `${p} (later)`}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Safe Z"
          units={doc.units}
          min={0}
          value={m.safeZ}
          onCommit={(safeZ) => set({ safeZ })}
        />
        <NumberField
          label="Max F"
          units={doc.units}
          suffix="/min"
          min={1}
          value={m.maxFeed}
          onCommit={(maxFeed) => set({ maxFeed })}
        />
        <NumberField
          label="Travel X"
          units={doc.units}
          min={1}
          value={m.travel[0]}
          onCommit={(x) => set({ travel: [x, m.travel[1], m.travel[2]] })}
        />
        <NumberField
          label="Travel Y"
          units={doc.units}
          min={1}
          value={m.travel[1]}
          onCommit={(y) => set({ travel: [m.travel[0], y, m.travel[2]] })}
        />
        <NumberField
          label="Travel Z"
          units={doc.units}
          min={1}
          value={m.travel[2]}
          onCommit={(z) => set({ travel: [m.travel[0], m.travel[1], z] })}
        />
      </div>
    </Section>
  );
}

function ToolEditor({ store, tool }: { store: EditorStore; tool: Tool }) {
  const u = store.doc.units;
  const { id, ...rest } = tool;
  const set = (patch: Partial<Omit<Tool, 'id'>>) =>
    store.execute(updateTool(id, { ...rest, ...patch }));
  const angled = tool.type === 'vbit' || tool.type === 'taperedball';
  const problems = toolProblems(tool);
  return (
    <div className="editor">
      <label className="field">
        <span>Name</span>
        <input
          defaultValue={tool.name ?? ''}
          key={`${id}-${tool.name}`}
          onBlur={(e) =>
            set({
              name:
                e.target.value || toolLabel({ ...rest, name: undefined } as Omit<Tool, 'id'>, u),
            })
          }
          data-testid="tool-name"
        />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Type</span>
          <select
            value={tool.type}
            onChange={(e) => {
              const type = e.target.value as Tool['type'];
              set({
                type,
                ...(type === 'vbit' || type === 'taperedball'
                  ? { angle: tool.angle ?? (type === 'vbit' ? 90 : 10) }
                  : {}),
                ...(type === 'taperedball' ? { tipDiameter: tool.tipDiameter ?? 1 } : {}),
              });
            }}
          >
            <option value="flat">Flat end mill</option>
            <option value="ballnose">Ball nose</option>
            <option value="vbit">V-bit</option>
            <option value="taperedball">Tapered ball</option>
          </select>
        </label>
        <NumberField
          label="Dia"
          units={u}
          min={0.01}
          value={tool.diameter}
          onCommit={(diameter) => set({ diameter })}
          testId="tool-diameter"
        />
        {angled && (
          <NumberField
            label="Angle"
            suffix="°"
            min={1}
            value={tool.angle ?? 90}
            onCommit={(angle) => set({ angle })}
          />
        )}
        {tool.type === 'taperedball' && (
          <NumberField
            label="Tip"
            units={u}
            min={0.01}
            value={tool.tipDiameter ?? 1}
            onCommit={(tipDiameter) => set({ tipDiameter })}
          />
        )}
        <NumberField
          label="Pass"
          units={u}
          min={0.01}
          value={tool.stepDown}
          onCommit={(stepDown) => set({ stepDown })}
        />
        <NumberField
          label="Step"
          units={u}
          min={0.01}
          value={tool.stepOver}
          onCommit={(stepOver) => set({ stepOver })}
        />
        <NumberField
          label="Feed"
          units={u}
          suffix="/min"
          min={1}
          value={tool.feed}
          onCommit={(feed) => set({ feed })}
        />
        <NumberField
          label="Plunge"
          units={u}
          suffix="/min"
          min={1}
          value={tool.plunge}
          onCommit={(plunge) => set({ plunge })}
        />
        <NumberField
          label="RPM"
          min={1}
          decimals={0}
          value={tool.rpm}
          onCommit={(rpm) => set({ rpm })}
        />
      </div>
      {problems.length > 0 && (
        <ul className="issues">
          {problems.map((p) => (
            <li key={p} className="error">
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolsSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const active = doc.tools.find((t) => t.id === store.ui.activeTool) ?? doc.tools[0];
  const inUse = (id: string) => doc.toolpaths.some((tp) => tp.tool === id);
  return (
    <Section
      title="Tools"
      actions={
        <select
          className="small"
          value=""
          aria-label="Add tool from preset"
          data-testid="add-tool"
          onChange={(e) => {
            const preset = TOOL_PRESETS[Number(e.target.value)];
            if (!preset) return;
            store.execute(addTool(preset));
            store.setUi({ activeTool: store.doc.tools.at(-1)?.id });
          }}
        >
          <option value="">+ Add tool…</option>
          {TOOL_PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      }
    >
      {doc.tools.length === 0 ? (
        <p className="hint">No tools yet. Add one from the presets, then adjust it.</p>
      ) : (
        <ul className="list">
          {doc.tools.map((t) => (
            <li
              key={t.id}
              className={t.id === active?.id ? 'active' : ''}
              onClick={() => store.setUi({ activeTool: t.id })}
            >
              <span className="grow">{toolLabel(t, doc.units)}</span>
              <button
                className="icon"
                title={inUse(t.id) ? 'Used by a toolpath' : 'Delete tool'}
                disabled={inUse(t.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  store.execute(deleteTool(t.id));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {active && <ToolEditor store={store} tool={active} />}
    </Section>
  );
}

function ParamsEditor({ store, tp }: { store: EditorStore; tp: Toolpath }) {
  const u: Units = store.doc.units;
  const save = (next: Toolpath) => store.execute(updateToolpath(next));
  const depth = (
    <NumberField
      label="Depth"
      units={u}
      min={0.001}
      value={tp.params.depth}
      testId="tp-depth"
      onCommit={(d) => save({ ...tp, params: { ...tp.params, depth: d } } as Toolpath)}
    />
  );
  switch (tp.type) {
    case 'profile': {
      const p = tp.params;
      const tabs = p.tabs;
      const set = (patch: Partial<typeof p>) => save({ ...tp, params: { ...p, ...patch } });
      return (
        <div className="grid2">
          <label className="field">
            <span>Side</span>
            <select
              value={p.side}
              onChange={(e) => set({ side: e.target.value as typeof p.side })}
              data-testid="tp-side"
            >
              <option value="outside">Outside</option>
              <option value="inside">Inside</option>
              <option value="on">On line</option>
            </select>
          </label>
          {depth}
          <label className="field">
            <span>Cut</span>
            <select
              value={p.direction ?? 'climb'}
              onChange={(e) => set({ direction: e.target.value as 'climb' | 'conventional' })}
            >
              <option value="climb">Climb</option>
              <option value="conventional">Conventional</option>
            </select>
          </label>
          <NumberField
            label="Leave"
            units={u}
            min={0}
            value={p.allowance ?? 0}
            onCommit={(allowance) => set({ allowance })}
          />
          <label className="field">
            <span>Ramp</span>
            <input
              type="checkbox"
              checked={!!p.ramp}
              onChange={(e) =>
                set(e.target.checked ? { ramp: { length: 20 } } : { ramp: undefined })
              }
            />
          </label>
          {p.ramp && (
            <NumberField
              label="Ramp L"
              units={u}
              min={0.1}
              value={p.ramp.length}
              onCommit={(length) => set({ ramp: { length } })}
            />
          )}
          <label className="field">
            <span>Tabs</span>
            <input
              type="checkbox"
              checked={!!p.tabs}
              data-testid="tp-tabs"
              onChange={(e) =>
                set(
                  e.target.checked
                    ? { tabs: { count: 4, width: 6, height: 3 } }
                    : { tabs: undefined },
                )
              }
            />
          </label>
          {tabs && (
            <>
              <NumberField
                label="Count"
                min={0}
                decimals={0}
                value={tabs.count}
                onCommit={(count) => set({ tabs: { ...tabs, count: Math.round(count) } })}
              />
              <NumberField
                label="Width"
                units={u}
                min={0.1}
                value={tabs.width}
                onCommit={(width) => set({ tabs: { ...tabs, width } })}
              />
              <NumberField
                label="Height"
                units={u}
                min={0.1}
                value={tabs.height}
                onCommit={(height) => set({ tabs: { ...tabs, height } })}
              />
            </>
          )}
        </div>
      );
    }
    case 'pocket': {
      const p = tp.params;
      const set = (patch: Partial<typeof p>) => save({ ...tp, params: { ...p, ...patch } });
      return (
        <div className="grid2">
          <label className="field">
            <span>Style</span>
            <select
              value={p.strategy}
              onChange={(e) => set({ strategy: e.target.value as typeof p.strategy })}
            >
              <option value="offset">Offset</option>
              <option value="raster">Raster</option>
            </select>
          </label>
          {depth}
          {p.strategy === 'raster' && (
            <NumberField
              label="Angle"
              suffix="°"
              value={p.angle ?? 0}
              onCommit={(angle) => set({ angle })}
            />
          )}
          <label className="field">
            <span>Cut</span>
            <select
              value={p.direction ?? 'climb'}
              onChange={(e) => set({ direction: e.target.value as 'climb' | 'conventional' })}
            >
              <option value="climb">Climb</option>
              <option value="conventional">Conventional</option>
            </select>
          </label>
          <NumberField
            label="Leave"
            units={u}
            min={0}
            value={p.allowance ?? 0}
            onCommit={(allowance) => set({ allowance })}
          />
        </div>
      );
    }
    case 'drill': {
      const p = tp.params;
      const set = (patch: Partial<typeof p>) => save({ ...tp, params: { ...p, ...patch } });
      return (
        <div className="grid2">
          {depth}
          <label className="field">
            <span>Peck</span>
            <input
              type="checkbox"
              checked={!!p.peck}
              onChange={(e) => set(e.target.checked ? { peck: 3 } : { peck: undefined })}
            />
          </label>
          {p.peck && (
            <NumberField
              label="Peck"
              units={u}
              min={0.1}
              value={p.peck}
              onCommit={(peck) => set({ peck })}
            />
          )}
          <NumberField
            label="Dwell"
            suffix="s"
            min={0}
            value={p.dwell ?? 0}
            onCommit={(dwell) => set(dwell > 0 ? { dwell } : { dwell: undefined })}
          />
        </div>
      );
    }
  }
}

function ToolpathStatus({
  store,
  runner,
  tp,
}: {
  store: EditorStore;
  runner: CamRunner;
  tp: Toolpath;
}) {
  const doc = store.doc;
  const st = runner.state.get(tp.id);
  const simulated = runner.isSimulated(doc, tp.id);
  const issues = (st?.preview?.issues ?? []).filter((i) => i.rule !== 'preview');
  const errors = issues.filter((i) => i.severity === 'error');

  const doExport = async () => {
    const res = await runner.export(doc, tp.id);
    if (!res) return;
    if (res.ok) {
      download(res.fileName, res.gcode, 'text/plain');
      store.setUi({ message: `Exported ${res.fileName}: G-code checker passed` });
    } else {
      store.setUi({
        message: `Export blocked: ${res.issues.filter((i) => i.severity === 'error').map((i) => i.message)[0] ?? 'checker error'}`,
      });
    }
  };

  return (
    <div className="status-block">
      {st?.error && <p className="error">{st.error}</p>}
      {st?.busy === 'preview' && <p className="hint">Calculating…</p>}
      {st?.preview && (
        <p data-testid="tp-estimate">
          Time ≈ <strong>{formatDuration(st.preview.seconds)}</strong> · cut{' '}
          {formatLength(st.preview.cuttingLength, doc.units)}
        </p>
      )}
      {st?.preview?.warnings.map((w) => (
        <p key={w} className="hint">
          ⚠ {w}
        </p>
      ))}
      {issues.length > 0 && (
        <ul className="issues" data-testid="tp-issues">
          {issues.map((i, k) => (
            <li key={k} className={i.severity}>
              {i.rule}: {i.message}
              {i.line ? ` (line ${i.line})` : ''}
            </li>
          ))}
        </ul>
      )}
      {st?.preview && errors.length === 0 && <p className="ok">✓ G-code checker: no problems</p>}
      <div className="buttons">
        <button
          onClick={() => void runner.simulate(doc, tp.id)}
          disabled={!!st?.busy || !!st?.error}
          data-testid="simulate"
        >
          {st?.busy === 'simulate' ? 'Simulating…' : 'Simulate'}
        </button>
        <button
          className="primary"
          onClick={() => void doExport()}
          disabled={!simulated || errors.length > 0 || !!st?.busy}
          title={
            !simulated
              ? 'Simulate this toolpath first'
              : errors.length
                ? 'Fix the checker errors first'
                : 'Download G-code'
          }
          data-testid="export-nc"
        >
          Export .nc
        </button>
        <span className={simulated ? 'ok' : 'hint'} data-testid="sim-state">
          {simulated ? 'Simulated' : 'Not simulated'}
        </span>
      </div>
    </div>
  );
}

function ToolpathsSection({ store, runner }: { store: EditorStore; runner: CamRunner }) {
  const doc = store.doc;
  const active = doc.toolpaths.find((t) => t.id === store.ui.activeToolpath);

  const create = (type: Toolpath['type']) => {
    const vectors = store.ui.selection.filter((id) => doc.vectors.some((v) => v.id === id));
    if (vectors.length === 0) {
      store.setUi({ message: 'Select the vectors to machine first (Design tab or canvas)' });
      return;
    }
    const tool = doc.tools.find((t) => t.id === store.ui.activeTool) ?? doc.tools[0];
    if (!tool) {
      store.setUi({ message: 'Add a tool first' });
      return;
    }
    const depth = type === 'profile' ? doc.stock.thickness : Math.min(3, doc.stock.thickness);
    const params =
      type === 'profile'
        ? { side: 'outside' as const, depth }
        : type === 'pocket'
          ? { depth, strategy: 'offset' as const }
          : { depth };
    store.execute(
      addToolpath({
        type,
        tool: tool.id,
        vectors,
        name: `${type.charAt(0).toUpperCase()}${type.slice(1)} ${doc.toolpaths.length + 1}`,
        params,
      } as Parameters<typeof addToolpath>[0]),
    );
    store.setUi({ activeToolpath: store.doc.toolpaths.at(-1)?.id });
  };

  // Keep the active toolpath's preview current.
  useEffect(() => {
    if (active) void runner.refresh(doc, active.id);
  });

  return (
    <Section title="Toolpaths">
      <div className="buttons" style={{ marginTop: 0 }}>
        <button
          onClick={() => create('profile')}
          data-testid="new-profile"
          title="Profile the selected vectors"
        >
          + Profile
        </button>
        <button
          onClick={() => create('pocket')}
          data-testid="new-pocket"
          title="Pocket the selected vectors"
        >
          + Pocket
        </button>
        <button
          onClick={() => create('drill')}
          data-testid="new-drill"
          title="Drill at the centre of each selected vector"
        >
          + Drill
        </button>
      </div>
      {doc.toolpaths.length > 0 && (
        <ul className="list" style={{ marginTop: 8 }}>
          {doc.toolpaths.map((t) => (
            <li
              key={t.id}
              className={t.id === active?.id ? 'active' : ''}
              onClick={() => store.setUi({ activeToolpath: t.id })}
            >
              <span className="grow">{t.name ?? t.id}</span>
              <span className="hint">{t.type}</span>
              <button
                className="icon"
                title="Delete toolpath"
                onClick={(e) => {
                  e.stopPropagation();
                  store.execute(deleteToolpath(t.id));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {active && (
        <div className="editor">
          <label className="field">
            <span>Name</span>
            <input
              defaultValue={active.name ?? ''}
              key={`${active.id}-${active.name}`}
              onBlur={(e) =>
                store.execute(updateToolpath({ ...active, name: e.target.value || active.id }))
              }
            />
          </label>
          <label className="field">
            <span>Tool</span>
            <select
              value={active.tool}
              onChange={(e) => store.execute(updateToolpath({ ...active, tool: e.target.value }))}
            >
              {doc.tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {toolLabel(t, doc.units)}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <span className="hint">{active.vectors.length} vector(s)</span>
            <button
              className="small"
              disabled={store.ui.selection.length === 0}
              onClick={() =>
                store.execute(updateToolpath({ ...active, vectors: [...store.ui.selection] }))
              }
            >
              Use selection
            </button>
            <button className="small" onClick={() => store.select(active.vectors)}>
              Select its vectors
            </button>
          </div>
          <ParamsEditor store={store} tp={active} />
          <ToolpathStatus store={store} runner={runner} tp={active} />
        </div>
      )}
    </Section>
  );
}

export function CamPanel({ store, runner }: { store: EditorStore; runner: CamRunner }) {
  return (
    <>
      <ToolpathsSection store={store} runner={runner} />
      <ToolsSection store={store} />
      <MachineSection store={store} />
    </>
  );
}
