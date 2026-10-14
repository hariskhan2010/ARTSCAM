import {
  AVAILABLE_POSTS,
  TOOL_PRESETS,
  addTool,
  addToolpath,
  deleteTool,
  deleteToolpath,
  formatDuration,
  setMachine,
  toolLabel,
  toolProblems,
  updateTool,
  updateToolpath,
  type Project,
  type Tool,
  type Toolpath,
} from '@naqsh/core';
import {
  CircleDot,
  Cpu,
  Download,
  Drill,
  Play,
  Route,
  ScanLine,
  SquareDashed,
  Triangle,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import type { CamRunner } from '../cam/runner';
import type { EditorStore } from '../editor/store';
import { download } from '../files';
import {
  Btn,
  Hint,
  NumberField,
  Section,
  Segmented,
  SelectField,
  Switch,
  TextField,
} from './common';

type Units = Project['units'];

const TYPE_INFO: Record<Toolpath['type'], { label: string; icon: typeof Route; text: string }> = {
  profile: { label: 'Profile', icon: Route, text: 'Cut along or around shapes' },
  pocket: { label: 'Pocket', icon: SquareDashed, text: 'Clear the area inside shapes' },
  vcarve: { label: 'V-carve', icon: Triangle, text: 'Carve lettering and art with a V-bit' },
  drill: { label: 'Drill', icon: Drill, text: 'Drill a hole at each shape’s centre' },
};

// --- Tools -------------------------------------------------------------------

function ToolEditor({ store, tool }: { store: EditorStore; tool: Tool }) {
  const u = store.doc.units;
  const { id, ...rest } = tool;
  const set = (patch: Partial<Omit<Tool, 'id'>>) =>
    store.execute(updateTool(id, { ...rest, ...patch }));
  const angled = tool.type === 'vbit' || tool.type === 'taperedball';
  const problems = toolProblems(tool);
  return (
    <>
      <TextField
        label="Name"
        value={tool.name ?? toolLabel(tool, u)}
        onCommit={(name) => set({ name })}
        testId="tool-name"
      />
      <div className="grid2">
        <SelectField
          label="Type"
          value={tool.type}
          options={[
            { value: 'flat', label: 'Flat end mill' },
            { value: 'ballnose', label: 'Ball nose' },
            { value: 'vbit', label: 'V-bit' },
            { value: 'taperedball', label: 'Tapered ball' },
          ]}
          onChange={(type) =>
            set({
              type,
              ...(type === 'vbit' || type === 'taperedball'
                ? { angle: tool.angle ?? (type === 'vbit' ? 90 : 10) }
                : {}),
              ...(type === 'taperedball' ? { tipDiameter: tool.tipDiameter ?? 1 } : {}),
            })
          }
        />
        <NumberField
          label="Diameter"
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
            help="Included angle of the cutting tip"
          />
        )}
        {tool.type === 'taperedball' && (
          <NumberField
            label="Tip diameter"
            units={u}
            min={0.01}
            value={tool.tipDiameter ?? 1}
            onCommit={(tipDiameter) => set({ tipDiameter })}
          />
        )}
        <NumberField
          label="Depth per pass"
          units={u}
          min={0.01}
          value={tool.stepDown}
          onCommit={(stepDown) => set({ stepDown })}
          help="How deep the tool cuts on each pass"
        />
        <NumberField
          label="Stepover"
          units={u}
          min={0.01}
          value={tool.stepOver}
          onCommit={(stepOver) => set({ stepOver })}
          help="Distance between neighbouring passes when clearing an area"
        />
        <NumberField
          label="Feed rate"
          units={u}
          suffix="/min"
          min={1}
          value={tool.feed}
          onCommit={(feed) => set({ feed })}
          help="Cutting speed sideways"
        />
        <NumberField
          label="Plunge rate"
          units={u}
          suffix="/min"
          min={1}
          value={tool.plunge}
          onCommit={(plunge) => set({ plunge })}
          help="Speed when moving down into the material"
        />
        <NumberField
          label="Spindle speed"
          suffix="rpm"
          min={1}
          decimals={0}
          value={tool.rpm}
          onCommit={(rpm) => set({ rpm })}
        />
      </div>
      {problems.map((p) => (
        <Hint key={p} tone="error">
          {p}
        </Hint>
      ))}
    </>
  );
}

function PresetPicker({ store }: { store: EditorStore }) {
  return (
    <SelectField
      label="Add a tool"
      value=""
      testId="add-tool"
      options={[
        { value: '', label: 'Choose a bit…', disabled: true },
        ...TOOL_PRESETS.map((p, i) => ({ value: String(i), label: p.name ?? `Tool ${i + 1}` })),
      ]}
      onChange={(v) => {
        const preset = TOOL_PRESETS[Number(v)];
        if (!preset) return;
        store.execute(addTool(preset));
        store.setUi({ activeTool: store.doc.tools.at(-1)?.id });
      }}
    />
  );
}

function ToolsSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const active = doc.tools.find((t) => t.id === store.ui.activeTool) ?? doc.tools[0];
  const inUse = (id: string) => doc.toolpaths.some((tp) => tp.tool === id);
  return (
    <Section title="Tools" icon={Wrench} collapsible defaultOpen={doc.tools.length === 0}>
      {doc.tools.length === 0 && (
        <Hint>
          Start by adding the bit you will cut with. You can change its settings afterwards.
        </Hint>
      )}
      {doc.tools.length > 0 && (
        <ul className="list">
          {doc.tools.map((t) => (
            <li
              key={t.id}
              className={t.id === active?.id ? 'active' : ''}
              onClick={() => store.setUi({ activeTool: t.id })}
            >
              <span className="name">{toolLabel(t, doc.units)}</span>
              <Btn
                icon={X}
                variant="ghost"
                title={inUse(t.id) ? 'In use by a toolpath' : 'Delete tool'}
                disabled={inUse(t.id)}
                onClick={() => store.execute(deleteTool(t.id))}
              />
            </li>
          ))}
        </ul>
      )}
      <PresetPicker store={store} />
      {active && <ToolEditor store={store} tool={active} />}
    </Section>
  );
}

// --- Toolpath settings ---------------------------------------------------------

function ParamsEditor({ store, tp }: { store: EditorStore; tp: Toolpath }) {
  const u: Units = store.doc.units;
  const save = (next: Toolpath) => store.execute(updateToolpath(next));
  const depth = (
    <NumberField
      label="Cut depth"
      units={u}
      min={0.001}
      value={tp.params.depth}
      testId="tp-depth"
      help="How deep the finished cut goes, measured from the top of the material"
      onCommit={(d) => save({ ...tp, params: { ...tp.params, depth: d } } as Toolpath)}
    />
  );
  const direction = (
    value: 'climb' | 'conventional' | undefined,
    set: (d: 'climb' | 'conventional') => void,
  ) => (
    <Segmented
      label="Cutting direction"
      value={value ?? 'climb'}
      options={[
        { value: 'climb', label: 'Climb', help: 'Smoother finish on most routers' },
        {
          value: 'conventional',
          label: 'Conventional',
          help: 'Gentler on loose or flexible machines',
        },
      ]}
      onChange={set}
    />
  );

  switch (tp.type) {
    case 'profile': {
      const p = tp.params;
      const tabs = p.tabs;
      const set = (patch: Partial<typeof p>) => save({ ...tp, params: { ...p, ...patch } });
      return (
        <>
          <Segmented
            label="Cut"
            testId="tp-side"
            value={p.side}
            options={[
              {
                value: 'outside',
                label: 'Outside',
                help: 'Cut out the shape (the tool runs outside the line)',
              },
              {
                value: 'inside',
                label: 'Inside',
                help: 'Cut out a hole (the tool runs inside the line)',
              },
              { value: 'on', label: 'On the line', help: 'The tool centre follows the line' },
            ]}
            onChange={(side) => set({ side })}
          />
          <div className="grid2">
            {depth}
            <NumberField
              label="Leave on wall"
              units={u}
              min={0}
              value={p.allowance ?? 0}
              onCommit={(allowance) => set({ allowance })}
              help="Material left for a later finishing pass"
            />
          </div>
          {direction(p.direction, (d) => set({ direction: d }))}
          <Switch
            label="Ramp in"
            checked={!!p.ramp}
            onChange={(on) => set(on ? { ramp: { length: 20 } } : { ramp: undefined })}
            help="Slope into the cut instead of plunging straight down"
          />
          {p.ramp && (
            <div className="indent">
              <NumberField
                label="Ramp length"
                units={u}
                min={0.1}
                value={p.ramp.length}
                onCommit={(length) => set({ ramp: { length } })}
              />
            </div>
          )}
          <Switch
            label="Holding tabs"
            checked={!!tabs}
            testId="tp-tabs"
            onChange={(on) =>
              set(on ? { tabs: { count: 4, width: 6, height: 3 } } : { tabs: undefined })
            }
            help="Small bridges that stop the part breaking loose on the last pass"
          />
          {tabs && (
            <div className="indent grid3">
              <NumberField
                label="How many"
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
            </div>
          )}
        </>
      );
    }
    case 'pocket': {
      const p = tp.params;
      const set = (patch: Partial<typeof p>) => save({ ...tp, params: { ...p, ...patch } });
      return (
        <>
          <Segmented
            label="Pattern"
            value={p.strategy}
            options={[
              {
                value: 'offset',
                label: 'Offset',
                icon: CircleDot,
                help: 'Rings from the middle outwards',
              },
              {
                value: 'raster',
                label: 'Raster',
                icon: ScanLine,
                help: 'Back-and-forth lines, then a pass round the walls',
              },
            ]}
            onChange={(strategy) => set({ strategy })}
          />
          <div className="grid2">
            {depth}
            <NumberField
              label="Leave on wall"
              units={u}
              min={0}
              value={p.allowance ?? 0}
              onCommit={(allowance) => set({ allowance })}
            />
            {p.strategy === 'raster' && (
              <NumberField
                label="Line angle"
                suffix="°"
                value={p.angle ?? 0}
                onCommit={(angle) => set({ angle })}
              />
            )}
          </div>
          {direction(p.direction, (d) => set({ direction: d }))}
        </>
      );
    }
    case 'vcarve': {
      const p = tp.params;
      const set = (patch: Partial<typeof p>) => save({ ...tp, params: { ...p, ...patch } });
      return (
        <>
          <div className="grid2">
            <NumberField
              label="Max depth"
              units={u}
              min={0.01}
              value={p.depth}
              testId="tp-depth"
              help="Wide areas are cut flat at this depth; narrow strokes are as deep as their width needs"
              onCommit={(depth) => set({ depth })}
            />
            <NumberField
              label="Detail"
              units={u}
              min={0.01}
              value={p.step ?? 0.1}
              help="Spacing between carving passes. Smaller is sharper but slower."
              onCommit={(step) => set({ step })}
            />
          </div>
          {direction(p.direction, (d) => set({ direction: d }))}
        </>
      );
    }
    case 'drill': {
      const p = tp.params;
      const set = (patch: Partial<typeof p>) => save({ ...tp, params: { ...p, ...patch } });
      return (
        <>
          <div className="grid2">
            {depth}
            <NumberField
              label="Pause at bottom"
              suffix="s"
              min={0}
              value={p.dwell ?? 0}
              onCommit={(dwell) => set(dwell > 0 ? { dwell } : { dwell: undefined })}
            />
          </div>
          <Switch
            label="Peck drilling"
            checked={!!p.peck}
            onChange={(on) => set(on ? { peck: 3 } : { peck: undefined })}
            help="Pull out between steps to clear chips"
          />
          {p.peck && (
            <div className="indent">
              <NumberField
                label="Peck depth"
                units={u}
                min={0.1}
                value={p.peck}
                onCommit={(peck) => set({ peck })}
              />
            </div>
          )}
        </>
      );
    }
  }
}

// --- Toolpaths list + footer ---------------------------------------------------

function statusOf(
  runner: CamRunner,
  doc: Project,
  tp: Toolpath,
): { tone: 'ok' | 'error' | 'muted'; text: string } {
  const st = runner.state.get(tp.id);
  if (st?.error) return { tone: 'error', text: 'Error' };
  if (st?.preview?.issues.some((i) => i.severity === 'error' && i.rule !== 'preview'))
    return { tone: 'error', text: 'Problem' };
  if (runner.isSimulated(doc, tp.id)) return { tone: 'ok', text: 'Simulated' };
  return { tone: 'muted', text: 'Not simulated' };
}

function ToolpathsSection({ store, runner }: { store: EditorStore; runner: CamRunner }) {
  const doc = store.doc;
  const active = doc.toolpaths.find((t) => t.id === store.ui.activeToolpath);
  const selectedCount = store.ui.selection.filter((id) =>
    doc.vectors.some((v) => v.id === id),
  ).length;

  const create = (type: Toolpath['type']) => {
    const vectors = store.ui.selection.filter((id) => doc.vectors.some((v) => v.id === id));
    const active = doc.tools.find((t) => t.id === store.ui.activeTool) ?? doc.tools[0];
    // V-carving needs a V-bit: use one from the library when the active tool is not.
    const tool =
      type === 'vcarve' && active?.type !== 'vbit'
        ? (doc.tools.find((t) => t.type === 'vbit') ?? active)
        : active;
    if (!tool) {
      store.setUi({ message: 'Add a tool first (Tools section below)' });
      return;
    }
    if (vectors.length === 0) {
      store.setUi({ message: 'Select the shapes to machine on the canvas first' });
      return;
    }
    const depth = type === 'profile' ? doc.stock.thickness : Math.min(3, doc.stock.thickness);
    const params =
      type === 'profile'
        ? { side: 'outside' as const, depth }
        : type === 'pocket'
          ? { depth, strategy: 'offset' as const }
          : type === 'vcarve'
            ? { depth: Math.min(6, doc.stock.thickness) }
            : { depth };
    if (type === 'vcarve' && tool.type !== 'vbit') {
      store.setUi({
        message: 'V-carving needs a V-bit: add one in the Tools section (e.g. 60° or 90° V-bit)',
      });
    }
    const name = `${TYPE_INFO[type].label} ${doc.toolpaths.filter((t) => t.type === type).length + 1}`;
    store.execute(
      addToolpath({ type, tool: tool.id, vectors, name, params } as Parameters<
        typeof addToolpath
      >[0]),
    );
    store.setUi({ activeToolpath: store.doc.toolpaths.at(-1)?.id });
  };

  // Keep the active toolpath's preview current.
  useEffect(() => {
    if (active) void runner.refresh(doc, active.id);
  });

  return (
    <>
      <Section title="New toolpath" icon={Route}>
        <div className="cards">
          {(Object.keys(TYPE_INFO) as Toolpath['type'][]).map((type) => {
            const info = TYPE_INFO[type];
            const Icon = info.icon;
            return (
              <button
                key={type}
                className="card"
                onClick={() => create(type)}
                data-testid={`new-${type}`}
                title={info.text}
              >
                <Icon size={18} aria-hidden />
                <strong>{info.label}</strong>
                <span>{info.text}</span>
              </button>
            );
          })}
        </div>
        <Hint tone={selectedCount && doc.tools.length ? 'ok' : 'info'}>
          {doc.tools.length === 0
            ? 'First add a tool in the Tools section below.'
            : selectedCount === 0
              ? 'Select the shapes to machine on the canvas, then pick a toolpath type.'
              : `${selectedCount} shape${selectedCount === 1 ? '' : 's'} selected: pick a toolpath type.`}
        </Hint>
      </Section>

      {doc.toolpaths.length > 0 && (
        <Section title="Toolpaths" icon={Route}>
          <ul className="list">
            {doc.toolpaths.map((t) => {
              const st = statusOf(runner, doc, t);
              const Icon = TYPE_INFO[t.type].icon;
              return (
                <li
                  key={t.id}
                  className={t.id === active?.id ? 'active' : ''}
                  onClick={() => store.setUi({ activeToolpath: t.id })}
                >
                  <Icon size={15} aria-hidden />
                  <span className="name">{t.name ?? t.id}</span>
                  <span className={`chip ${st.tone}`}>{st.text}</span>
                  <Btn
                    icon={X}
                    variant="ghost"
                    title="Delete toolpath"
                    onClick={() => store.execute(deleteToolpath(t.id))}
                  />
                </li>
              );
            })}
          </ul>
          {active && (
            <>
              <TextField
                label="Name"
                value={active.name ?? active.id}
                onCommit={(name) =>
                  store.execute(updateToolpath({ ...active, name: name || active.id }))
                }
              />
              <SelectField
                label="Tool"
                value={active.tool}
                options={doc.tools.map((t) => ({ value: t.id, label: toolLabel(t, doc.units) }))}
                onChange={(tool) => store.execute(updateToolpath({ ...active, tool }))}
              />
              <div className="row" style={{ alignItems: 'center' }}>
                <span className="field-label grow">
                  Machining {active.vectors.length} shape{active.vectors.length === 1 ? '' : 's'}
                </span>
                <Btn
                  label="Show"
                  variant="ghost"
                  onClick={() => store.select(active.vectors)}
                  title="Select this toolpath's shapes on the canvas"
                />
                <Btn
                  label="Use selection"
                  disabled={selectedCount === 0}
                  onClick={() =>
                    store.execute(updateToolpath({ ...active, vectors: [...store.ui.selection] }))
                  }
                  title="Machine the shapes selected now instead"
                />
              </div>
              <ParamsEditor store={store} tp={active} />
            </>
          )}
        </Section>
      )}
    </>
  );
}

function MachineSection({ store }: { store: EditorStore }) {
  const doc = store.doc;
  const m = doc.machine;
  const set = (patch: Partial<Project['machine']>) => store.execute(setMachine({ ...m, ...patch }));
  return (
    <Section title="Machine" icon={Cpu} collapsible defaultOpen={false}>
      <div className="grid2">
        <SelectField
          label="Controller"
          value={m.post}
          options={(['grbl', 'mach3', 'linuxcnc', 'generic'] as const).map((p) => ({
            value: p,
            label:
              p === 'grbl'
                ? 'GRBL'
                : `${p === 'mach3' ? 'Mach3' : p === 'linuxcnc' ? 'LinuxCNC' : 'Generic'} (coming later)`,
            disabled: !AVAILABLE_POSTS.includes(p),
          }))}
          onChange={(post) => set({ post })}
        />
        <NumberField
          label="Safe height"
          units={doc.units}
          min={0}
          value={m.safeZ}
          onCommit={(safeZ) => set({ safeZ })}
          help="Height above the material for moves between cuts"
        />
        <NumberField
          label="Max feed"
          units={doc.units}
          suffix="/min"
          min={1}
          value={m.maxFeed}
          onCommit={(maxFeed) => set({ maxFeed })}
        />
      </div>
      <div className="grid3">
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

/** Always-visible footer: estimate, checker result, Simulate and Export. */
function RunFooter({ store, runner, tp }: { store: EditorStore; runner: CamRunner; tp: Toolpath }) {
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
      const first = res.issues.find((i) => i.severity === 'error');
      store.setUi({ message: `Export blocked: ${first?.message ?? 'checker error'}` });
    }
  };

  const status = !st?.preview
    ? undefined
    : errors.length
      ? { tone: 'error', text: `${errors.length} problem${errors.length === 1 ? '' : 's'}` }
      : { tone: 'ok', text: 'Safety check passed' };

  return (
    <div className="sidebar-footer">
      {st?.error && <Hint tone="error">{st.error}</Hint>}
      <div className="stat">
        {st?.preview ? (
          <span data-testid="tp-estimate" title="Estimated machining time, including acceleration">
            <span className="muted">Estimated time </span>
            <b>{formatDuration(st.preview.seconds)}</b>
            <span className="muted"> · {cutLength(st.preview.cuttingLength, doc.units)}</span>
          </span>
        ) : (
          <span className="muted">{st?.busy === 'preview' ? 'Calculating…' : ' '}</span>
        )}
        <span className="grow" />
        {status && (
          <span className={`chip ${status.tone}`} title={errors.map((e) => e.message).join(' · ')}>
            {status.text}
          </span>
        )}
      </div>
      {st?.preview?.warnings.length ? (
        <Hint tone="warn">{st.preview.warnings.join(' · ')}</Hint>
      ) : null}
      {issues.length > 0 && (
        <ul className="issues" data-testid="tp-issues">
          {issues.map((i, k) => (
            <li key={k} className={i.severity}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <Btn
          icon={Play}
          label={st?.busy === 'simulate' ? 'Simulating…' : 'Simulate'}
          onClick={() => void runner.simulate(doc, tp.id)}
          disabled={!!st?.busy || !!st?.error}
          testId="simulate"
          wide
        />
        <Btn
          icon={Download}
          label="Export G-code"
          variant="primary"
          onClick={() => void doExport()}
          disabled={!simulated || errors.length > 0 || !!st?.busy}
          title={
            !simulated
              ? 'Simulate this toolpath first'
              : errors.length
                ? 'Fix the problems above first'
                : 'Download the .nc file'
          }
          testId="export-nc"
          wide
        />
      </div>
      <span className="muted small" data-testid="sim-state">
        {simulated ? 'Simulated' : 'Not simulated'}
      </span>
    </div>
  );
}

/** Cutting length: mm below a metre, metres above (or inches / feet). */
function cutLength(mm: number, units: Units): string {
  if (units === 'mm')
    return mm >= 1000
      ? `${(mm / 1000).toFixed(2)} m of cutting`
      : `${Math.round(mm)} mm of cutting`;
  const inches = mm / 25.4;
  return inches >= 120
    ? `${(inches / 12).toFixed(1)} ft of cutting`
    : `${inches.toFixed(1)} in of cutting`;
}

export function CamPanel({ store, runner }: { store: EditorStore; runner: CamRunner }) {
  const active = store.doc.toolpaths.find((t) => t.id === store.ui.activeToolpath);
  return (
    <>
      <div className="sidebar-scroll">
        <ToolpathsSection store={store} runner={runner} />
        <ToolsSection store={store} />
        <MachineSection store={store} />
      </div>
      {active && <RunFooter store={store} runner={runner} tp={active} />}
    </>
  );
}
