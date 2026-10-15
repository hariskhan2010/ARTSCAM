import {
  addRelief,
  addToolpath,
  addVectors,
  alignOffsets,
  bbox,
  chamferCorners,
  circularArrayMatrices,
  distributeOffsets,
  filletCorners,
  gridArrayMatrices,
  joinOpenPaths,
  repairSegments,
  setVectorSegments,
  traceBitmap,
  type AlignMode,
  booleanOp,
  composite,
  deleteVectors,
  duplicateVectors,
  exportDxf,
  exportSvg,
  flatten,
  importDxf,
  importSvg,
  loadProject,
  newProject,
  offset,
  projectSchema,
  reliefToStl,
  rotation,
  saveProject,
  scaling,
  setReliefOp,
  transformSegments,
  transformVectors,
  translation,
  type BooleanOp,
  type Relief,
  type ReliefOp,
  type Segment,
  type Toolpath,
  type Vec2,
  type Vector,
} from '@naqsh/core';
import type { CamRunner } from './cam/runner';
import { SAMPLES } from './samples';
import { shownRelief, type EditorStore, type ReliefForm } from './editor/store';
import { download, pickFile } from './files';

/**
 * Every user action the menus, toolbars and panels share. Each one goes
 * through the store's commands (undo/redo) and reports problems in the
 * status bar message instead of throwing.
 */

// --- File ---------------------------------------------------------------------

export function confirmNew(store: EditorStore) {
  if (
    store.doc.vectors.length > 0 &&
    !window.confirm('Start a new project? Unsaved changes are lost.')
  )
    return;
  store.load(newProject());
}

export async function openProject(store: EditorStore) {
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

/** Opens a sample project (Help › Samples), after confirming unsaved work is dropped. */
export function openSample(store: EditorStore, id: string) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return;
  if (
    store.doc.vectors.length > 0 &&
    !window.confirm(`Open the sample "${sample.name}"? Unsaved changes are lost.`)
  )
    return;
  try {
    store.load(projectSchema.parse(sample.project));
    store.setUi({ message: `Opened the sample "${sample.name}": ${sample.text}` });
  } catch (e) {
    store.setUi({ message: (e as Error).message });
  }
}

export function saveProjectFile(store: EditorStore) {
  try {
    const bytes = saveProject(store.bundle());
    download('project.naqsh.zip', bytes, 'application/zip');
  } catch (e) {
    store.setUi({ message: (e as Error).message });
  }
}

export async function importVectors(store: EditorStore) {
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

export function exportSvgFile(store: EditorStore) {
  const { doc } = store;
  const visible = new Set(doc.layers.filter((l) => l.visible).map((l) => l.id));
  const text = exportSvg(
    doc.vectors.filter((v) => visible.has(v.layer)),
    { width: doc.stock.width, height: doc.stock.height },
  );
  download('design.svg', text, 'image/svg+xml');
}

export function exportDxfFile(store: EditorStore) {
  const { doc } = store;
  const layers = new Map(doc.layers.filter((l) => l.visible).map((l) => [l.id, l.name]));
  const text = exportDxf(
    doc.vectors
      .filter((v) => layers.has(v.layer))
      .map((v) => ({ segments: v.segments, closed: v.closed, layer: layers.get(v.layer) ?? '0' })),
  );
  download('design.dxf', text, 'application/dxf');
}

// --- Edit ---------------------------------------------------------------------

/** Selected vectors in the order they were picked (Trim/Intersect use the first as subject). */
export function selectedVectors(store: EditorStore): Vector[] {
  return store.ui.selection
    .map((id) => store.doc.vectors.find((v) => v.id === id))
    .filter((v): v is Vector => !!v);
}

/** The one selected vector, when it is editable text. */
export function selectedText(store: EditorStore): Vector | undefined {
  const sel = selectedVectors(store);
  return sel.length === 1 && sel[0]?.text ? sel[0] : undefined;
}

/** Opens the text card on the selected text shape; "Update text" replaces it. */
export function editText(store: EditorStore) {
  const v = selectedText(store);
  if (!v?.text) return;
  const { content, fontId, size, align, matrix } = v.text;
  store.setUi({
    tool: 'text',
    textDraft: {
      at: [matrix[4], matrix[5]],
      text: content,
      fontId,
      size,
      align,
      matrix,
      editing: v.id,
    },
  });
}

export function copySelection(store: EditorStore): boolean {
  const sel = selectedVectors(store);
  if (sel.length === 0) {
    store.setUi({ message: 'Select shapes to copy' });
    return false;
  }
  store.clipboard = sel.map((v) => ({ layer: v.layer, closed: v.closed, segments: v.segments }));
  store.setUi({ message: `Copied ${sel.length} shape${sel.length === 1 ? '' : 's'}` });
  return true;
}

export function cutSelection(store: EditorStore): void {
  if (!copySelection(store)) return;
  store.execute(deleteVectors(store.ui.selection));
}

/** Pastes the clipboard a little down and to the right, into the active layer, and selects it. */
export function pasteClipboard(store: EditorStore): void {
  if (store.clipboard.length === 0) {
    store.setUi({ message: 'Nothing to paste: copy shapes first' });
    return;
  }
  const m = translation(5, -5);
  const layer = store.ui.activeLayer;
  const vectors = store.clipboard.map((v) => ({
    ...v,
    layer,
    segments: transformSegments(v.segments, m),
  }));
  // Next paste goes a step further, like repeated Ctrl+V in drawing programs.
  store.clipboard = vectors.map((v) => ({ ...v }));
  const before = new Set(store.doc.vectors.map((v) => v.id));
  store.execute(addVectors(vectors, 'Paste'));
  store.select(store.doc.vectors.filter((v) => !before.has(v.id)).map((v) => v.id));
}

export function deleteSelection(store: EditorStore): void {
  if (store.ui.selection.length) store.execute(deleteVectors(store.ui.selection));
}

export function duplicateSelection(store: EditorStore): void {
  const ids = store.ui.selection;
  if (!ids.length) return;
  const before = new Set(store.doc.vectors.map((v) => v.id));
  store.execute(duplicateVectors(ids, translation(5, -5)));
  store.select(store.doc.vectors.filter((v) => !before.has(v.id)).map((v) => v.id));
}

export function selectAll(store: EditorStore): void {
  const ok = new Set(store.doc.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
  store.select(store.doc.vectors.filter((v) => ok.has(v.layer)).map((v) => v.id));
}

// --- Vector -------------------------------------------------------------------

/** Flattening tolerance for booleans/offsets (mm). */
const GEOM_TOL = 0.01;
/** Ends closer than this (mm) count as touching when joining or repairing shapes. */
const JOIN_TOL = 0.05;

/** Closed rings of the given vectors (open vectors are ignored). */
export function ringsOf(vectors: readonly Vector[]): Vec2[][] {
  return vectors
    .filter((v) => v.closed)
    .flatMap((v) => flatten(v.segments, GEOM_TOL, true).map((p) => p.points));
}

/** One vector holding all rings of a region (outer + holes stay together). */
export function regionVector(rings: Vec2[][], layer: string): Omit<Vector, 'id'> | undefined {
  const segments: Segment[] = [];
  for (const ring of rings) {
    ring.forEach((p, i) => segments.push({ type: i === 0 ? 'move' : 'line', p: [p[0], p[1]] }));
    segments.push({ type: 'close' });
  }
  return segments.length ? { layer, closed: true, segments } : undefined;
}

/** Weld (union), Trim (difference) or Intersect the selected closed shapes. */
export function booleanSelection(store: EditorStore, op: BooleanOp, label: string): void {
  const closed = selectedVectors(store).filter((v) => v.closed);
  const [first, ...rest] = closed;
  if (!first || rest.length === 0) {
    store.setUi({ message: `${label} needs two or more closed shapes selected` });
    return;
  }
  const result =
    op === 'union'
      ? booleanOp('union', ringsOf(closed), [], 'nonZero')
      : booleanOp(op, ringsOf([first]), ringsOf(rest));
  const vec = regionVector(result, first.layer);
  store.execute(
    composite(label, [
      deleteVectors(closed.map((v) => v.id)),
      ...(vec ? [addVectors([vec], label)] : []),
    ]),
  );
  const last = store.doc.vectors.at(-1);
  store.select(vec && last ? [last.id] : []);
}

/** Adds an outline `distance` outside (sign 1) or inside (−1) each selected closed shape. */
export function offsetSelection(store: EditorStore, sign: 1 | -1, distance: number): void {
  const closed = selectedVectors(store).filter((v) => v.closed);
  if (closed.length === 0) {
    store.setUi({ message: 'Select closed shapes to offset' });
    return;
  }
  const vecs = closed
    .map((v) => regionVector(offset(ringsOf([v]), sign * distance), v.layer))
    .filter((v): v is Omit<Vector, 'id'> => !!v);
  if (vecs.length === 0) {
    store.setUi({ message: 'The inset is larger than the shape, so nothing is left' });
    return;
  }
  store.execute(addVectors(vecs, sign > 0 ? 'Offset outward' : 'Offset inward'));
}

export type QuickTransform = 'mirror' | 'flip' | 'rotateCcw' | 'rotateCw' | 'centre';

/** Mirror, flip, rotate by 90° about the selection centre, or centre it on the material. */
export function transformSelection(store: EditorStore, kind: QuickTransform): void {
  const sel = selectedVectors(store);
  const ids = sel.map((v) => v.id);
  if (!ids.length) {
    store.setUi({ message: 'Select shapes first' });
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of sel)
    for (const p of flatten(v.segments, GEOM_TOL, v.closed).flatMap((x) => x.points)) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const { width, height } = store.doc.stock;
  const [m, label] =
    kind === 'mirror'
      ? [scaling(-1, 1, cx, cy), 'Mirror']
      : kind === 'flip'
        ? [scaling(1, -1, cx, cy), 'Flip']
        : kind === 'rotateCcw'
          ? [rotation(Math.PI / 2, cx, cy), 'Rotate']
          : kind === 'rotateCw'
            ? [rotation(-Math.PI / 2, cx, cy), 'Rotate']
            : [translation(width / 2 - cx, height / 2 - cy), 'Centre on material'];
  store.execute(transformVectors(ids, m, label));
}

// --- Vector editing tools (T6.7) ---------------------------------------------------

/** Rounds (fillet) or cuts (chamfer) the line–line corners of the selected shapes. */
export function cornerSelection(
  store: EditorStore,
  kind: 'fillet' | 'chamfer',
  size: number,
): void {
  const sel = selectedVectors(store);
  if (!sel.length) {
    store.setUi({ message: 'Select shapes first' });
    return;
  }
  const label = kind === 'fillet' ? 'Fillet corners' : 'Chamfer corners';
  const changed = sel.flatMap((v) => {
    const segs =
      kind === 'fillet'
        ? filletCorners(v.segments, size, v.closed)
        : chamferCorners(v.segments, size, v.closed);
    return segs === v.segments || JSON.stringify(segs) === JSON.stringify(v.segments)
      ? []
      : [setVectorSegments(v.id, segs, v.closed, label)];
  });
  if (!changed.length) {
    store.setUi({ message: 'No corners between straight lines in the selection' });
    return;
  }
  store.execute(composite(label, changed));
}

/** Copies the selection in a grid (cols × rows at dx, dy apart). */
export function gridArraySelection(
  store: EditorStore,
  cols: number,
  rows: number,
  dx: number,
  dy: number,
): void {
  const ids = selectedVectors(store).map((v) => v.id);
  if (!ids.length) return store.setUi({ message: 'Select shapes first' });
  const ms = gridArrayMatrices(cols, rows, dx, dy).slice(1);
  if (!ms.length) return;
  store.execute(
    composite(
      'Array',
      ms.map((m) => duplicateVectors(ids, m)),
    ),
  );
}

/** Copies the selection around a centre: `count` in all (including the original) over `degrees`. */
export function circularArraySelection(
  store: EditorStore,
  count: number,
  centre: Vec2,
  degrees: number,
): void {
  const ids = selectedVectors(store).map((v) => v.id);
  if (!ids.length) return store.setUi({ message: 'Select shapes first' });
  const ms = circularArrayMatrices(count, centre, degrees).slice(1);
  if (!ms.length) return;
  store.execute(
    composite(
      'Circular array',
      ms.map((m) => duplicateVectors(ids, m)),
    ),
  );
}

function selectionBoxes(store: EditorStore) {
  return selectedVectors(store).flatMap((v) => {
    const b = bbox(v.segments);
    return b ? [{ id: v.id, box: b }] : [];
  });
}

/** Lines the selected shapes up on an edge or centre of the selection. */
export function alignSelection(store: EditorStore, mode: AlignMode): void {
  const items = selectionBoxes(store);
  if (items.length < 2) return store.setUi({ message: 'Select two or more shapes to align' });
  const offs = alignOffsets(
    items.map((i) => i.box),
    mode,
  );
  store.execute(
    composite(
      'Align',
      items.map((it, k) => {
        const [dx, dy] = offs[k] as [number, number];
        return transformVectors([it.id], translation(dx, dy), 'Align');
      }),
    ),
  );
}

/** Spaces the selected shapes with equal gaps (left to right, or bottom to top). */
export function distributeSelection(store: EditorStore, axis: 'x' | 'y'): void {
  const items = selectionBoxes(store);
  if (items.length < 3)
    return store.setUi({ message: 'Select three or more shapes to distribute' });
  const offs = distributeOffsets(
    items.map((i) => i.box),
    axis,
  );
  store.execute(
    composite(
      'Distribute',
      items.map((it, k) => {
        const [dx, dy] = offs[k] as [number, number];
        return transformVectors([it.id], translation(dx, dy), 'Distribute');
      }),
    ),
  );
}

/** Joins the selected open shapes whose ends meet (within 0.05 mm). */
export function joinSelection(store: EditorStore): void {
  const open = selectedVectors(store).filter((v) => !v.closed);
  if (open.length < 2) return store.setUi({ message: 'Select two or more open shapes to join' });
  const joined = joinOpenPaths(
    open.map((v) => v.segments),
    JOIN_TOL,
  );
  if (joined.length === open.length)
    return store.setUi({ message: 'None of the selected shapes have ends that meet' });
  const layer = (open[0] as Vector).layer;
  store.execute(
    composite('Join', [
      deleteVectors(open.map((v) => v.id)),
      addVectors(
        joined.map((j) => ({ layer, closed: j.closed, segments: j.segments })),
        'Join',
      ),
    ]),
  );
  store.select(store.doc.vectors.slice(-joined.length).map((v) => v.id));
  store.setUi({ message: `Joined ${open.length} shapes into ${joined.length}` });
}

/**
 * Cleans the selected shapes: removes zero-length pieces and repeated points,
 * closes shapes whose ends nearly meet, and deletes exact duplicates.
 */
export function repairSelection(store: EditorStore): void {
  const sel = selectedVectors(store);
  if (!sel.length) return store.setUi({ message: 'Select shapes first' });
  let fixes = 0;
  const seen = new Set<string>();
  const dupes: string[] = [];
  const edits = sel.flatMap((v) => {
    const key = JSON.stringify([v.closed, v.segments]);
    if (seen.has(key)) {
      dupes.push(v.id);
      return [];
    }
    seen.add(key);
    const r = repairSegments(v.segments, v.closed, JOIN_TOL);
    fixes += r.fixes;
    return r.fixes ? [setVectorSegments(v.id, r.segments, r.closed, 'Repair')] : [];
  });
  if (!edits.length && !dupes.length) return store.setUi({ message: 'Nothing to repair' });
  store.execute(composite('Repair', [...edits, ...(dupes.length ? [deleteVectors(dupes)] : [])]));
  store.setUi({
    message: `Repaired: ${fixes} fix${fixes === 1 ? '' : 'es'}, ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'} removed`,
  });
}

// --- Relief -------------------------------------------------------------------

type FromVector = Extract<ReliefOp, { op: 'fromVector' }>;

export function activeRelief(store: EditorStore): Relief | undefined {
  return shownRelief(store.doc, store.ui);
}

/** Shows the front or back relief in the Relief panel, canvas and 3D view. */
export function openReliefSide(store: EditorStore, side: 'front' | 'back') {
  store.setUi({ sidebarTab: 'relief', reliefSide: side });
}

/** The shown relief, creating one on the shown side when there is none. */
export function ensureRelief(store: EditorStore): Relief {
  const existing = activeRelief(store);
  if (existing) return existing;
  store.execute(addRelief(store.ui.reliefForm.resolution, undefined, store.ui.reliefSide));
  const created = store.doc.reliefs.at(-1) as Relief;
  store.setUi({ activeRelief: created.id });
  return created;
}

export function setReliefForm(store: EditorStore, patch: Partial<ReliefForm>): void {
  store.setUi({ reliefForm: { ...store.ui.reliefForm, ...patch } });
}

/** Shape to relief: each selected closed shape with the form's profile and height. */
export function shapesToRelief(store: EditorStore, mode?: FromVector['mode']): void {
  const closed = selectedVectors(store).filter((v) => v.closed);
  if (closed.length === 0) {
    store.setUi({ message: 'Select closed shapes on the canvas first' });
    return;
  }
  const f = store.ui.reliefForm;
  const relief = ensureRelief(store);
  store.execute(
    composite(
      'Shapes to relief',
      closed.map((v) =>
        setReliefOp(relief.id, {
          op: 'fromVector',
          vector: v.id,
          profile: f.profile,
          height: f.height,
          ...(f.profile === 'angle' ? { angle: f.angle } : {}),
          mode: mode ?? f.mode,
        }),
      ),
    ),
  );
}

function needRelief(store: EditorStore): Relief | undefined {
  const r = activeRelief(store);
  if (!r) store.setUi({ message: 'Make a relief first (Relief › Shape to relief)' });
  return r;
}

export function smoothRelief(store: EditorStore): void {
  const r = needRelief(store);
  if (r)
    store.execute(
      setReliefOp(r.id, { op: 'smooth', radius: store.ui.reliefForm.smoothRadius, passes: 3 }),
    );
}

export function scaleRelief(store: EditorStore): void {
  const r = needRelief(store);
  if (r) store.execute(setReliefOp(r.id, { op: 'scale', factor: store.ui.reliefForm.factor }));
}

export function invertRelief(store: EditorStore): void {
  const r = needRelief(store);
  if (r) store.execute(setReliefOp(r.id, { op: 'invert' }));
}

// --- Sweeps, textures, sculpting (M6) ------------------------------------------

export type SweepRole = 'rail' | 'railB' | 'section' | 'endSection';

/** Uses the one selected shape as a sweep's rail or cross-section. */
export function pickSweepShape(store: EditorStore, role: SweepRole): void {
  const sel = selectedVectors(store);
  if (sel.length !== 1) {
    store.setUi({ message: 'Select one shape first' });
    return;
  }
  const v = sel[0] as Vector;
  if (role.startsWith('section') || role === 'endSection') {
    if (v.closed) {
      store.setUi({
        message: 'A cross-section is an open shape (draw it with the line or pen tool)',
      });
      return;
    }
  }
  setReliefForm(store, { [role]: v.id });
}

/** The picked shape's id, if it still exists. */
export function sweepShape(store: EditorStore, role: SweepRole): string | undefined {
  const id = store.ui.reliefForm[role];
  return id && store.doc.vectors.some((v) => v.id === id) ? id : undefined;
}

/** Runs a relief step, reporting a failure (e.g. a bad cross-section) instead of keeping it. */
function addReliefStep(store: EditorStore, op: ReliefOp): void {
  const relief = ensureRelief(store);
  store.execute(setReliefOp(relief.id, op));
  const err = store.relief(relief.id).error;
  if (err) {
    store.undo();
    store.setUi({ message: err });
  }
}

export function addExtrude(store: EditorStore): void {
  const rail = sweepShape(store, 'rail');
  const section = sweepShape(store, 'section');
  if (!rail || !section) {
    store.setUi({ message: 'Pick a rail and a cross-section first' });
    return;
  }
  const end = sweepShape(store, 'endSection');
  addReliefStep(store, {
    op: 'extrude',
    rail,
    section,
    ...(end && { endSection: end }),
    mode: store.ui.reliefForm.mode,
  });
}

export function addSpin(store: EditorStore): void {
  const section = sweepShape(store, 'section');
  const v = store.doc.vectors.find((x) => x.id === section);
  if (!section || !v) {
    store.setUi({ message: 'Pick a cross-section first' });
    return;
  }
  // The centre is the section's left end: draw it from the centre outward.
  const pts = flatten(v.segments, 0.01, false).flatMap((p) => p.points);
  const a = pts[0];
  const b = pts.at(-1);
  if (!a || !b) return;
  const centre = a[0] <= b[0] ? a : b;
  addReliefStep(store, {
    op: 'spin',
    section,
    centre: [centre[0], centre[1]],
    mode: store.ui.reliefForm.mode,
  });
}

export function addTwoRail(store: EditorStore): void {
  const railA = sweepShape(store, 'rail');
  const railB = sweepShape(store, 'railB');
  const section = sweepShape(store, 'section');
  if (!railA || !railB || !section) {
    store.setUi({ message: 'Pick two rails and a cross-section first' });
    return;
  }
  addReliefStep(store, {
    op: 'twoRail',
    railA,
    railB,
    section,
    ...(store.ui.reliefForm.sweepScaleHeight && { scaleHeight: true }),
    mode: store.ui.reliefForm.mode,
  });
}

/** Adds the form's texture, inside the one selected closed shape if there is one. */
export function addTexture(store: EditorStore): void {
  const f = store.ui.reliefForm;
  const sel = selectedVectors(store).filter((v) => v.closed);
  addReliefStep(store, {
    op: 'texture',
    pattern: f.texture,
    spacing: f.textureSpacing,
    height: f.textureHeight,
    ...(f.textureAngle ? { angle: f.textureAngle } : {}),
    ...(sel.length === 1 && { within: (sel[0] as Vector).id }),
    mode: f.mode,
  });
}

/** One brush stroke (world mm points) with the form's brush. */
export function sculptStroke(store: EditorStore, points: [number, number][]): void {
  if (points.length === 0) return;
  const f = store.ui.reliefForm;
  addReliefStep(store, {
    op: 'sculpt',
    tool: f.brush,
    radius: f.brushRadius,
    strength: f.brushStrength,
    points,
  });
}

export function exportStl(store: EditorStore): void {
  const r = needRelief(store);
  const grid = r ? store.relief(r.id).grid : undefined;
  if (grid) download('relief.stl', reliefToStl(grid), 'model/stl');
}

/** Decodes an image file to grayscale bytes (rows top to bottom), at most `max` px on the long side. */
async function imageToGray(
  file: File,
  max = 1000,
): Promise<{ px: Uint8Array; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) {
    const a = (rgba[i * 4 + 3] as number) / 255;
    // Luminance; transparent pixels count as black (no height).
    px[i] = Math.round(
      a *
        (0.299 * (rgba[i * 4] as number) +
          0.587 * (rgba[i * 4 + 1] as number) +
          0.114 * (rgba[i * 4 + 2] as number)),
    );
  }
  return { px, w, h };
}

/** Image to relief: picks an image, fits it in the material, bright parts high. */
export async function addImageRelief(store: EditorStore): Promise<void> {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const { px, w, h } = await imageToGray(file);
    const relief = ensureRelief(store);
    const id = store.addImage(px);
    const { doc } = store;
    const f = store.ui.reliefForm;
    // Fit the image inside the material, keeping its aspect ratio, centred.
    const s = Math.min(doc.stock.width / w, doc.stock.height / h);
    const W = w * s;
    const H = h * s;
    store.execute(
      setReliefOp(relief.id, {
        op: 'fromImage',
        image: id,
        px: w,
        py: h,
        x: (doc.stock.width - W) / 2,
        y: (doc.stock.height - H) / 2,
        w: W,
        h: H,
        height: f.imageHeight,
        mode: f.mode,
      }),
    );
  } catch (e) {
    store.setUi({ message: `Could not read the image: ${(e as Error).message}` });
  }
}

/**
 * Bitmap › Trace image to vectors: picks an image and adds its dark (or light)
 * parts as one closed vector, sized and placed by the Bitmaps panel settings.
 */
export async function traceImage(store: EditorStore): Promise<void> {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const { px, w, h } = await imageToGray(file);
    const { doc } = store;
    const f = store.ui.traceForm;
    // Fit inside the material like Image to relief, or use the set width; centred.
    const s = f.fit ? Math.min(doc.stock.width / w, doc.stock.height / h) : f.width / w;
    const segments = traceBitmap(px, w, h, {
      threshold: f.threshold,
      invert: f.invert,
      turdSize: f.specks,
      smooth: f.smooth,
      pixelSize: s,
      origin: [(doc.stock.width - w * s) / 2, (doc.stock.height - h * s) / 2],
    });
    if (segments.length === 0) {
      store.setUi({ message: 'Nothing to trace: try another threshold or Invert' });
      return;
    }
    const before = new Set(doc.vectors.map((v) => v.id));
    store.execute(
      addVectors([{ layer: store.ui.activeLayer, closed: true, segments }], `Trace ${file.name}`),
    );
    store.select(store.doc.vectors.filter((v) => !before.has(v.id)).map((v) => v.id));
    const rings = segments.filter((seg) => seg.type === 'move').length;
    store.setUi({ message: `Traced ${file.name}: ${rings} outlines in one vector` });
  } catch (e) {
    store.setUi({ message: `Could not trace the image: ${(e as Error).message}` });
  }
}

// --- Toolpath -----------------------------------------------------------------

export const TOOLPATH_LABEL: Record<Toolpath['type'], string> = {
  profile: 'Profile',
  pocket: 'Pocket',
  vcarve: 'V-carve',
  drill: 'Drill',
  rough3d: '3D rough',
  finish3d: '3D finish',
};

/** Creates a toolpath of `type` for the selection (or the relief) and makes it active. */
export function createToolpath(store: EditorStore, type: Toolpath['type']): void {
  const doc = store.doc;
  const vectors = store.ui.selection.filter((id) => doc.vectors.some((v) => v.id === id));
  const active = doc.tools.find((t) => t.id === store.ui.activeTool) ?? doc.tools[0];
  // V-carving needs a V-bit: use one from the library when the active tool is not.
  // Each job prefers the tool type it needs when the library has one.
  const want =
    type === 'vcarve'
      ? 'vbit'
      : type === 'finish3d'
        ? 'ballnose'
        : type === 'rough3d'
          ? 'flat'
          : undefined;
  const tool =
    want && active?.type !== want ? (doc.tools.find((t) => t.type === want) ?? active) : active;
  const relief = activeRelief(store);
  const is3d = type === 'rough3d' || type === 'finish3d';
  if (!tool) {
    store.setUi({ message: 'Add a tool first (Tools section below)' });
    return;
  }
  if (is3d && !relief) {
    store.setUi({ message: 'Make a relief first (step 2, Relief)' });
    return;
  }
  if (vectors.length === 0 && !is3d) {
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
          : type === 'rough3d'
            ? { allowance: 0.5 }
            : type === 'finish3d'
              ? { pattern: 'x' as const }
              : { depth };
  if (type === 'vcarve' && tool.type !== 'vbit') {
    store.setUi({
      message: 'V-carving needs a V-bit: add one in the Tools section (e.g. 60° or 90° V-bit)',
    });
  }
  const name = `${TOOLPATH_LABEL[type]} ${doc.toolpaths.filter((t) => t.type === type).length + 1}`;
  store.execute(
    addToolpath({
      type,
      tool: tool.id,
      // 3D jobs cover the whole relief unless shapes are selected as a boundary (roughing only).
      vectors: is3d && type === 'finish3d' ? [] : vectors,
      name,
      params,
      ...(is3d && relief ? { relief: relief.id } : {}),
    } as Parameters<typeof addToolpath>[0]),
  );
  store.setUi({ activeToolpath: store.doc.toolpaths.at(-1)?.id });
}

/**
 * Exports the toolpath's G-code. The CAM worker runs the safety checker on
 * the output text and refuses (export blocked) on any error or when the
 * current settings have not been simulated.
 */
export async function exportGcode(store: EditorStore, runner: CamRunner, tpId: string) {
  const res = await runner.export(store.doc, tpId);
  if (!res) return;
  if (res.ok) {
    download(res.fileName, res.gcode, 'text/plain');
    store.setUi({ message: `Exported ${res.fileName}: G-code checker passed` });
  } else {
    const first = res.issues.find((i) => i.severity === 'error');
    store.setUi({ message: `Export blocked: ${first?.message ?? 'checker error'}` });
  }
}
