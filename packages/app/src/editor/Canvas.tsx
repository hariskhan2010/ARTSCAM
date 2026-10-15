import {
  addVectors,
  gridRange,
  type Grid,
  deleteVectors,
  duplicateVectors,
  ellipse,
  evalPiece,
  line,
  pieces,
  polygon,
  rectangle,
  setVectorSegments,
  star,
  transformSegments,
  transformVectors,
  translation,
  type Matrix,
  type Segment,
  type Vec2,
  type Vector,
} from '@naqsh/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasOverlay } from './CanvasOverlay';
import {
  anchorPoints,
  boxFrom,
  gridStep,
  handlePositions,
  handleTransform,
  marqueeSelect,
  pickHandle,
  pickVector,
  screenToWorld,
  selectionBBox,
  snap,
  worldToScreen,
  zoomAt,
  type Handle,
  type View,
} from './geometry';
import {
  deleteNode,
  editPoints,
  movePoint,
  penSegments,
  pickPoint,
  splitSegment,
  type NodeRef,
  type PenNode,
} from './nodes';
import type { CamRunner } from '../cam/runner';
import type { SimResult } from '../cam/protocol';
import { shownRelief, useStore, type EditorStore } from './store';
import { currentView } from './viewActions';
import { copySelection, cutSelection, pasteClipboard, sculptStroke } from '../actions';

/** A brush stroke as an open polyline, for the canvas preview. */
function strokeSegments(points: readonly [number, number][]): Segment[] {
  const [first, ...rest] = points;
  if (!first) return [];
  return [
    { type: 'move', p: first },
    ...(rest.length ? rest : [first]).map((p): Segment => ({ type: 'line', p })),
  ];
}

/** Hit radius in screen pixels. */
const HIT_PX = 6;
/**
 * Grab radius for points: at least the snap radius (HIT_PX × 1.5), so a point
 * that snapped away from the click can still be picked up where you clicked.
 */
const POINT_HIT_PX = 10;
const HANDLE_PX = 4;
const ROTATE_PX = 24;

/** What the current pointer drag is doing. */
type Drag =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'move'; start: Vec2; ids: string[]; moved: boolean }
  | {
      kind: 'handle';
      handle: Handle;
      start: Vec2;
      box: NonNullable<ReturnType<typeof selectionBBox>>;
    }
  | { kind: 'marquee'; start: Vec2; additive: boolean }
  | { kind: 'shape'; start: Vec2 }
  | { kind: 'node'; id: string; ref: NodeRef }
  | { kind: 'pen'; node: number }
  | { kind: 'sculpt'; points: [number, number][] };

/** Live preview shown while dragging, before the command is committed. */
type Preview =
  | { kind: 'matrix'; ids: Set<string>; m: Matrix }
  | { kind: 'segments'; id: string; segments: Segment[] }
  | { kind: 'draft'; segments: Segment[]; closed: boolean }
  | { kind: 'marquee'; a: Vec2; b: Vec2 };

function shapeFor(
  tool: string,
  a: Vec2,
  b: Vec2,
  sides: number,
  square: boolean,
): Segment[] | undefined {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (square && (tool === 'rect' || tool === 'ellipse')) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * s;
    dy = Math.sign(dy || 1) * s;
  }
  const r = Math.hypot(dx, dy);
  switch (tool) {
    case 'rect':
      return dx && dy ? rectangle(a[0], a[1], dx, dy) : undefined;
    case 'ellipse':
      return dx && dy
        ? ellipse(a[0] + dx / 2, a[1] + dy / 2, Math.abs(dx) / 2, Math.abs(dy) / 2)
        : undefined;
    case 'polygon':
      return r > 0 ? polygon(a[0], a[1], r, Math.max(3, sides), Math.atan2(dy, dx)) : undefined;
    case 'star':
      return r > 0
        ? star(a[0], a[1], r, r * 0.45, Math.max(2, sides), Math.atan2(dy, dx))
        : undefined;
    case 'line':
      return r > 0 ? line(a, [a[0] + dx, a[1] + dy]) : undefined;
  }
  return undefined;
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  view: View,
  segments: readonly Segment[],
  closed: boolean,
) {
  const S = (p: Vec2) => worldToScreen(view, p);
  let open = false;
  for (const s of segments) {
    switch (s.type) {
      case 'move':
        if (open && closed) ctx.closePath();
        ctx.moveTo(...S(s.p));
        open = true;
        break;
      case 'line':
        ctx.lineTo(...S(s.p));
        break;
      case 'quad':
        ctx.quadraticCurveTo(...S(s.c), ...S(s.p));
        break;
      case 'cubic':
        ctx.bezierCurveTo(...S(s.c1), ...S(s.c2), ...S(s.p));
        break;
      case 'close':
        ctx.closePath();
        open = false;
        break;
    }
  }
  if (open && closed) ctx.closePath();
}

/** Index of the drawing segment of `segments` nearest to p within tol, and its t. */
function nearestSegment(
  segments: readonly Segment[],
  p: Vec2,
  tol: number,
): { seg: number; t: number } | undefined {
  let start: Vec2 | undefined;
  let subStart: Vec2 | undefined;
  let best: { seg: number; t: number; d: number } | undefined;
  segments.forEach((s, i) => {
    if (s.type === 'move') {
      start = s.p;
      subStart = s.p;
      return;
    }
    if (s.type === 'close') {
      start = subStart;
      return;
    }
    if (!start) return;
    const [piece] = pieces([{ type: 'move', p: [start[0], start[1]] }, s]);
    start = s.p;
    if (!piece) return;
    for (let k = 1; k < 64; k++) {
      const q = evalPiece(piece, k / 64);
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= tol && (!best || d < best.d)) best = { seg: i, t: k / 64, d };
    }
  });
  return best && { seg: best.seg, t: best.t };
}

/** Hill-shaded image of a relief grid (light from the top-left), cached per grid. */
const reliefImages = new WeakMap<Grid, HTMLCanvasElement>();
function reliefImage(g: Grid): HTMLCanvasElement {
  const cached = reliefImages.get(g);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = g.cols;
  c.height = g.rows;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(g.cols, g.rows);
  const { min, max } = gridRange(g.z);
  const span = Math.max(1e-6, max - min);
  for (let r = 0; r < g.rows; r++) {
    for (let col = 0; col < g.cols; col++) {
      const z = g.z[r * g.cols + col] as number;
      const zl = g.z[r * g.cols + Math.max(0, col - 1)] as number;
      const zu = g.z[Math.min(g.rows - 1, r + 1) * g.cols + col] as number;
      // Slope towards the light (up-left) brightens, away darkens.
      const shade = Math.max(-60, Math.min(60, (z - zl - (zu - z)) * (40 / g.resolution)));
      const t = (z - min) / span;
      const o = ((g.rows - 1 - r) * g.cols + col) * 4;
      img.data[o] = 150 + t * 80 + shade;
      img.data[o + 1] = 120 + t * 70 + shade;
      img.data[o + 2] = 90 + t * 50 + shade;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  reliefImages.set(g, c);
  return c;
}

/** Shaded image of a simulated stock heightmap, cached per result. */
const simImages = new WeakMap<SimResult, HTMLCanvasElement>();
function simImage(sim: SimResult): HTMLCanvasElement {
  const cached = simImages.get(sim);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = sim.cols;
  c.height = sim.rows;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(sim.cols, sim.rows);
  // Shade relative to the deepest cut so shallow pockets still read clearly.
  let deepest = sim.top;
  for (let i = 0; i < sim.z.length; i++) deepest = Math.min(deepest, sim.z[i] as number);
  const range = Math.max(1e-6, sim.top - deepest);
  for (let r = 0; r < sim.rows; r++) {
    for (let col = 0; col < sim.cols; col++) {
      const i = r * sim.cols + col;
      const z = sim.z[i] as number;
      // Light from the top-left: compare with the neighbour up-left.
      const zn = sim.z[Math.max(0, r - 1) * sim.cols + Math.max(0, col - 1)] as number;
      const shade = Math.max(-50, Math.min(50, (zn - z) * -80));
      const depth = (sim.top - z) / range; // 0 top … 1 bottom
      const o = ((sim.rows - 1 - r) * sim.cols + col) * 4; // flip: row 0 is the bottom
      img.data[o] = 222 - depth * 120 + shade;
      img.data[o + 1] = 184 - depth * 105 + shade;
      img.data[o + 2] = 135 - depth * 80 + shade;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  simImages.set(sim, c);
  return c;
}

export function Canvas({ store, runner }: { store: EditorStore; runner?: CamRunner }) {
  useStore(store);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | undefined>(undefined);
  const previewRef = useRef<Preview | undefined>(undefined);
  const penRef = useRef<PenNode[]>([]);
  const nodeSelRef = useRef<{ id: string; ref: NodeRef } | undefined>(undefined);
  const spaceRef = useRef(false);
  const closeHoverRef = useRef(false);
  /** Text tool remembers the last font and size used. */
  const lastFontRef = useRef('naskh');
  const lastSizeRef = useRef(30);
  const [penCount, setPenCount] = useState(0);
  const sizeRef = useRef<[number, number]>([800, 600]);

  const ui = store.ui;

  const view = (): View => currentView(store);

  const visibleVectors = (): Vector[] => {
    const shown = new Set(store.doc.layers.filter((l) => l.visible).map((l) => l.id));
    return store.doc.vectors.filter((v) => shown.has(v.layer));
  };
  const editableVectors = (): Vector[] => {
    const ok = new Set(store.doc.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
    return store.doc.vectors.filter((v) => ok.has(v.layer));
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(canvas);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    ctx.fillStyle = color('--canvas-bg', '#eceff3');
    ctx.fillRect(0, 0, w, h);

    const v = view();
    const { stock } = store.doc;
    const sel = new Set(store.ui.selection);
    const preview = previewRef.current;

    // Stock
    const [sx0, sy0] = worldToScreen(v, [0, stock.height]);
    ctx.fillStyle = color('--stock', '#ffffff');
    ctx.fillRect(sx0, sy0, stock.width * v.scale, stock.height * v.scale);

    const camTp = store.ui.sidebarTab === 'cam' ? store.ui.activeToolpath : undefined;
    const camState = camTp ? runner?.state.get(camTp) : undefined;

    // Grid
    const step = gridStep(v.scale);
    const [wx0, wy1] = screenToWorld(v, [0, 0]);
    const [wx1, wy0] = screenToWorld(v, [w, h]);
    ctx.lineWidth = 1;
    for (const major of [false, true]) {
      const g = major ? step * 5 : step;
      ctx.strokeStyle = color(major ? '--grid-major' : '--grid', major ? '#c9d0da' : '#e1e5eb');
      ctx.beginPath();
      for (let x = Math.ceil(wx0 / g) * g; x <= wx1; x += g) {
        const X = Math.round(worldToScreen(v, [x, 0])[0]) + 0.5;
        ctx.moveTo(X, 0);
        ctx.lineTo(X, h);
      }
      for (let y = Math.ceil(wy0 / g) * g; y <= wy1; y += g) {
        const Y = Math.round(worldToScreen(v, [0, y])[1]) + 0.5;
        ctx.moveTo(0, Y);
        ctx.lineTo(w, Y);
      }
      ctx.stroke();
    }
    // Relief heights as a shaded image while working on the relief.
    if (store.ui.sidebarTab === 'relief') {
      const rel = shownRelief(store.doc, store.ui);
      const g = rel ? store.relief(rel.id).grid : undefined;
      if (g) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(
          reliefImage(g),
          sx0,
          sy0,
          g.cols * g.resolution * v.scale,
          g.rows * g.resolution * v.scale,
        );
      }
    }

    // Simulated stock covers the grid inside the stock.
    if (camState?.sim) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        simImage(camState.sim),
        sx0,
        sy0,
        stock.width * v.scale,
        stock.height * v.scale,
      );
    }

    ctx.strokeStyle = color('--stock-edge', '#7a8696');
    ctx.strokeRect(sx0 + 0.5, sy0 + 0.5, stock.width * v.scale, stock.height * v.scale);
    // Origin marker
    const [ox, oy] = worldToScreen(v, [0, 0]);
    ctx.strokeStyle = '#d2453c';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + 20, oy);
    ctx.stroke();
    ctx.strokeStyle = '#2f9e44';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox, oy - 20);
    ctx.stroke();

    // Vectors
    const segOf = (vec: Vector): Segment[] => {
      if (preview?.kind === 'matrix' && preview.ids.has(vec.id))
        return transformSegments(vec.segments, preview.m);
      if (preview?.kind === 'segments' && preview.id === vec.id) return preview.segments;
      return vec.segments;
    };
    const locked = new Set(store.doc.layers.filter((l) => l.locked).map((l) => l.id));
    ctx.lineWidth = 1.5;
    for (const vec of visibleVectors()) {
      ctx.beginPath();
      tracePath(ctx, v, segOf(vec), vec.closed);
      ctx.strokeStyle = sel.has(vec.id)
        ? color('--sel', '#1971c2')
        : locked.has(vec.layer)
          ? '#9aa4b1'
          : color('--ink', '#1f2933');
      ctx.setLineDash(vec.closed ? [] : [6, 3]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Text being placed
    const textDraft = store.ui.textDraft;
    if (store.ui.tool === 'text' && textDraft) {
      const tp = store.ui.textPreview;
      if (tp) {
        ctx.beginPath();
        tracePath(ctx, v, tp, true);
        ctx.fillStyle = 'rgba(47,111,237,0.18)';
        ctx.fill('nonzero');
        ctx.strokeStyle = color('--sel', '#1971c2');
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const [ax, ay] = worldToScreen(v, textDraft.at);
      ctx.strokeStyle = color('--sel', '#1971c2');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax - 8, ay);
      ctx.lineTo(ax + 8, ay);
      ctx.moveTo(ax, ay - 8);
      ctx.lineTo(ax, ay + 8);
      ctx.stroke();
      ctx.lineWidth = 1.5;
    }

    // Toolpath preview: rapids dashed red, cuts blue, darker when deeper.
    const path = camState?.preview?.path;
    if (path) {
      ctx.lineWidth = 1;
      for (const rapid of [true, false]) {
        ctx.beginPath();
        ctx.strokeStyle = rapid ? 'rgba(201,42,42,0.7)' : color('--toolpath', '#1c7ed6');
        ctx.setLineDash(rapid ? [4, 4] : []);
        for (let i = 4; i < path.length; i += 4) {
          const isRapid = path[i + 3] === 0;
          if (isRapid !== rapid) continue;
          ctx.moveTo(...worldToScreen(v, [path[i - 4] as number, path[i - 3] as number]));
          ctx.lineTo(...worldToScreen(v, [path[i] as number, path[i + 1] as number]));
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Draft shape / pen preview
    if (preview?.kind === 'draft') {
      ctx.beginPath();
      tracePath(ctx, v, preview.segments, preview.closed);
      ctx.strokeStyle = color('--sel', '#1971c2');
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (store.ui.tool === 'pen') {
      ctx.fillStyle = color('--sel', '#1971c2');
      penRef.current.forEach((n, i) => {
        const [x, y] = worldToScreen(v, n.p);
        const r = i === 0 ? 4.5 : 3;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      });
      const first = penRef.current[0];
      if (first && closeHoverRef.current) {
        const [x, y] = worldToScreen(v, first.p);
        ctx.strokeStyle = color('--sel', '#1971c2');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.lineWidth = 1.5;
      }
    }

    // Selection box and handles
    const selected = visibleVectors().filter((x) => sel.has(x.id));
    if (store.ui.tool === 'select' && selected.length > 0) {
      const box = selectionBBox(selected.map((x) => ({ segments: segOf(x) })));
      if (box) {
        const [ax, ay] = worldToScreen(v, [box.minX, box.maxY]);
        const [bx, by] = worldToScreen(v, [box.maxX, box.minY]);
        ctx.strokeStyle = color('--sel', '#1971c2');
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(ax, ay, bx - ax, by - ay);
        ctx.setLineDash([]);
        if (!preview || preview.kind !== 'matrix') {
          const hs = handlePositions(box, ROTATE_PX / v.scale);
          ctx.fillStyle = '#fff';
          for (const [name, p] of Object.entries(hs)) {
            const [x, y] = worldToScreen(v, p);
            ctx.beginPath();
            if (name === 'rotate') ctx.arc(x, y, HANDLE_PX + 1, 0, 2 * Math.PI);
            else ctx.rect(x - HANDLE_PX, y - HANDLE_PX, 2 * HANDLE_PX, 2 * HANDLE_PX);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    }

    // Node handles
    if (store.ui.tool === 'node') {
      for (const vec of selected) {
        const segs = segOf(vec);
        const pts = editPoints(segs);
        ctx.strokeStyle = '#8aa1b9';
        ctx.beginPath();
        // Lines from each control handle to its anchor.
        segs.forEach((s, i) => {
          if (s.type === 'quad' || s.type === 'cubic') {
            const prev = segs
              .slice(0, i)
              .reverse()
              .find((q) => q.type !== 'close');
            const c1 = s.type === 'quad' ? s.c : s.c1;
            const c2 = s.type === 'quad' ? s.c : s.c2;
            if (prev) {
              ctx.moveTo(...worldToScreen(v, prev.p));
              ctx.lineTo(...worldToScreen(v, c1));
            }
            ctx.moveTo(...worldToScreen(v, s.p));
            ctx.lineTo(...worldToScreen(v, c2));
          }
        });
        ctx.stroke();
        const active = nodeSelRef.current;
        for (const p of pts) {
          const [x, y] = worldToScreen(v, p.point);
          const isActive =
            active?.id === vec.id && active.ref.seg === p.seg && active.ref.key === p.key;
          ctx.fillStyle = isActive ? color('--sel', '#1971c2') : '#fff';
          ctx.strokeStyle = color('--sel', '#1971c2');
          ctx.beginPath();
          if (p.anchor) ctx.rect(x - 3.5, y - 3.5, 7, 7);
          else ctx.arc(x, y, 3, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    if (preview?.kind === 'marquee') {
      const [ax, ay] = worldToScreen(v, preview.a);
      const [bx, by] = worldToScreen(v, preview.b);
      ctx.fillStyle = 'rgba(25,113,194,0.08)';
      ctx.strokeStyle = color('--sel', '#1971c2');
      ctx.fillRect(ax, ay, bx - ax, by - ay);
      ctx.strokeRect(ax, ay, bx - ax, by - ay);
    }
    // `store` is stable; drawing reads its latest state each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Redraw on every store change.
  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  });

  // Keep the backing store sized to the element.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = [r.width, r.height];
      store.canvasSize = [r.width, r.height];
      store.touch(); // rulers and the zoom readout depend on the canvas size
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw, store]);

  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return screenToWorld(view(), [e.clientX - r.left, e.clientY - r.top]);
  };

  const snapped = (p: Vec2, exclude?: Set<string>): [number, number] => {
    const v = view();
    const pts = store.ui.snapPoints
      ? anchorPoints(visibleVectors().filter((x) => !exclude?.has(x.id)))
      : [];
    return snap(p, {
      grid: store.ui.snapGrid,
      gridSize: gridStep(v.scale),
      points: pts,
      radius: (HIT_PX * 1.5) / v.scale,
    }).point;
  };

  const finishPen = (closed: boolean) => {
    const nodes = penRef.current;
    penRef.current = [];
    previewRef.current = undefined;
    closeHoverRef.current = false;
    setPenCount(0);
    if (nodes.length >= 2) {
      store.execute(
        addVectors(
          [{ layer: store.ui.activeLayer, closed, segments: penSegments(nodes, closed) }],
          'Pen',
        ),
      );
      const last = store.doc.vectors.at(-1);
      if (last) store.select([last.id]);
    }
    draw();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    canvas.setPointerCapture(e.pointerId);
    canvas.focus();
    const v = view();
    const tol = HIT_PX / v.scale;
    const p = toWorld(e);
    const tool = store.ui.tool;

    if (e.button === 1 || tool === 'pan' || spaceRef.current) {
      dragRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'select') {
      const selected = visibleVectors().filter((x) => store.ui.selection.includes(x.id));
      const box = selectionBBox(selected);
      const handle = box && pickHandle(box, p, tol, ROTATE_PX / v.scale);
      if (box && handle) {
        dragRef.current = { kind: 'handle', handle, start: p, box };
        return;
      }
      const hit = pickVector(editableVectors(), p, tol);
      if (hit) {
        let sel = store.ui.selection;
        if (e.shiftKey)
          sel = sel.includes(hit.id) ? sel.filter((x) => x !== hit.id) : [...sel, hit.id];
        else if (!sel.includes(hit.id)) sel = [hit.id];
        store.select(sel);
        if (sel.includes(hit.id))
          dragRef.current = {
            kind: 'move',
            start: snapped(p, new Set(sel)),
            ids: [...sel],
            moved: false,
          };
        return;
      }
      if (!e.shiftKey) store.select([]);
      dragRef.current = { kind: 'marquee', start: p, additive: e.shiftKey };
      return;
    }

    if (tool === 'node') {
      for (const vec of visibleVectors().filter((x) => store.ui.selection.includes(x.id))) {
        const hit = pickPoint(editPoints(vec.segments), p, POINT_HIT_PX / v.scale);
        if (hit) {
          nodeSelRef.current = { id: vec.id, ref: { seg: hit.seg, key: hit.key } };
          dragRef.current = { kind: 'node', id: vec.id, ref: { seg: hit.seg, key: hit.key } };
          draw();
          return;
        }
      }
      const hit = pickVector(editableVectors(), p, tol);
      nodeSelRef.current = undefined;
      store.select(hit ? [hit.id] : []);
      return;
    }

    if (tool === 'pen') {
      const q = snapped(p);
      const nodes = penRef.current;
      const first = nodes[0];
      if (
        first &&
        nodes.length > 2 &&
        Math.hypot(first.p[0] - q[0], first.p[1] - q[1]) <= tol * 1.5
      ) {
        finishPen(true);
        return;
      }
      nodes.push({ p: q });
      setPenCount(nodes.length);
      dragRef.current = { kind: 'pen', node: nodes.length - 1 };
      previewRef.current = { kind: 'draft', segments: penSegments(nodes, false), closed: false };
      draw();
      return;
    }

    if (tool === 'sculpt') {
      // Raw (unsnapped) brush path; becomes one relief step on release.
      dragRef.current = { kind: 'sculpt', points: [[p[0], p[1]]] };
      previewRef.current = {
        kind: 'draft',
        segments: strokeSegments([[p[0], p[1]]]),
        closed: false,
      };
      draw();
      return;
    }

    if (tool === 'text') {
      const at = snapped(p);
      const draft = store.ui.textDraft;
      store.setUi({
        // Clicking again moves the text; an edited text keeps its rotation and scale.
        textDraft: draft
          ? {
              ...draft,
              at,
              ...(draft.matrix && {
                matrix: [
                  draft.matrix[0],
                  draft.matrix[1],
                  draft.matrix[2],
                  draft.matrix[3],
                  at[0],
                  at[1],
                ] as const,
              }),
            }
          : {
              at,
              text: '',
              fontId: lastFontRef.current,
              size: lastSizeRef.current,
              align: 'center',
            },
      });
      return;
    }

    // Shape tools
    dragRef.current = { kind: 'shape', start: snapped(p) };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toWorld(e);
    if (!dragRef.current) {
      store.setUi({ cursor: p });
      if (store.ui.tool === 'pen' && penRef.current.length > 0) {
        const q = snapped(p);
        const nodes = penRef.current;
        const first = nodes[0] as PenNode;
        // Near the first point: show the closed shape the next click would make.
        const closing =
          nodes.length > 2 &&
          Math.hypot(first.p[0] - q[0], first.p[1] - q[1]) <= (HIT_PX * 1.5) / view().scale;
        closeHoverRef.current = closing;
        previewRef.current = {
          kind: 'draft',
          segments: closing ? penSegments(nodes, true) : penSegments([...nodes, { p: q }], false),
          closed: closing,
        };
        draw();
      }
      return;
    }
    const d = dragRef.current;
    switch (d.kind) {
      case 'pan': {
        const v = view();
        store.setUi({
          view: {
            ...v,
            originX: v.originX + e.clientX - d.lastX,
            originY: v.originY + e.clientY - d.lastY,
          },
        });
        d.lastX = e.clientX;
        d.lastY = e.clientY;
        return;
      }
      case 'move': {
        const q = snapped(p, new Set(d.ids));
        d.moved = true;
        previewRef.current = {
          kind: 'matrix',
          ids: new Set(d.ids),
          m: translation(q[0] - d.start[0], q[1] - d.start[1]),
        };
        break;
      }
      case 'handle':
        previewRef.current = {
          kind: 'matrix',
          ids: new Set(store.ui.selection),
          m: handleTransform(d.box, d.handle, d.start, p, {
            uniform: e.shiftKey,
            snapAngle: e.shiftKey,
          }),
        };
        break;
      case 'marquee':
        previewRef.current = { kind: 'marquee', a: d.start, b: p };
        break;
      case 'shape': {
        const segs = shapeFor(store.ui.tool, d.start, snapped(p), store.ui.sides, e.shiftKey);
        previewRef.current = segs
          ? { kind: 'draft', segments: segs, closed: store.ui.tool !== 'line' }
          : undefined;
        break;
      }
      case 'node': {
        const vec = store.doc.vectors.find((x) => x.id === d.id);
        if (vec) {
          const q = snapped(p, new Set([d.id]));
          previewRef.current = {
            kind: 'segments',
            id: d.id,
            segments: movePoint(vec.segments, d.ref, q),
          };
        }
        break;
      }
      case 'sculpt': {
        // Keep a point every ~quarter brush radius: enough for a smooth stroke.
        const last = d.points.at(-1) as [number, number];
        const step = Math.max(0.05, store.ui.reliefForm.brushRadius / 4);
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= step) d.points.push([p[0], p[1]]);
        previewRef.current = { kind: 'draft', segments: strokeSegments(d.points), closed: false };
        break;
      }
      case 'pen': {
        const node = penRef.current[d.node];
        if (node) {
          const dist = Math.hypot(p[0] - node.p[0], p[1] - node.p[1]);
          if (dist > HIT_PX / view().scale) node.out = [p[0], p[1]];
          else delete node.out;
          previewRef.current = {
            kind: 'draft',
            segments: penSegments(penRef.current, false),
            closed: false,
          };
        }
        break;
      }
    }
    store.setUi({ cursor: p });
    draw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    dragRef.current = undefined;
    const preview = previewRef.current;
    if (!d) return;
    const p = toWorld(e);
    switch (d.kind) {
      case 'move':
        if (d.moved && preview?.kind === 'matrix')
          store.execute(transformVectors(d.ids, preview.m, 'Move'));
        break;
      case 'handle':
        if (preview?.kind === 'matrix') {
          store.execute(
            transformVectors(
              store.ui.selection,
              preview.m,
              d.handle === 'rotate' ? 'Rotate' : 'Scale',
            ),
          );
        }
        break;
      case 'marquee': {
        const ids = marqueeSelect(editableVectors(), boxFrom(d.start, p));
        store.select(d.additive ? [...store.ui.selection, ...ids] : ids);
        break;
      }
      case 'shape': {
        const segs = shapeFor(store.ui.tool, d.start, snapped(p), store.ui.sides, e.shiftKey);
        if (segs) {
          store.execute(
            addVectors(
              [{ layer: store.ui.activeLayer, closed: store.ui.tool !== 'line', segments: segs }],
              `Draw ${store.ui.tool}`,
            ),
          );
          const last = store.doc.vectors.at(-1);
          if (last) store.select([last.id]);
        }
        break;
      }
      case 'node':
        if (preview?.kind === 'segments') store.execute(setVectorSegments(d.id, preview.segments));
        break;
      case 'pen':
        // Keep the pen preview; the path stays open until Enter / closing click.
        previewRef.current = {
          kind: 'draft',
          segments: penSegments(penRef.current, false),
          closed: false,
        };
        draw();
        return;
      case 'sculpt': {
        const last = d.points.at(-1) as [number, number];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) d.points.push([p[0], p[1]]);
        sculptStroke(store, d.points);
        break;
      }
      case 'pan':
        break;
    }
    previewRef.current = undefined;
    draw();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = toWorld(e);
    const tol = HIT_PX / view().scale;
    if (store.ui.tool === 'pen') {
      // The double-click's two pointer-downs added a duplicate last node.
      penRef.current.pop();
      finishPen(false);
      return;
    }
    if (store.ui.tool === 'select') {
      const hit = pickVector(editableVectors(), p, tol);
      if (hit) {
        store.select([hit.id]);
        store.setUi({ tool: 'node' });
      }
      return;
    }
    if (store.ui.tool === 'node') {
      for (const vec of visibleVectors().filter((x) => store.ui.selection.includes(x.id))) {
        const near = nearestSegment(vec.segments, p, tol);
        if (near && !pickPoint(editPoints(vec.segments), p, POINT_HIT_PX / view().scale)) {
          store.execute(
            setVectorSegments(
              vec.id,
              splitSegment(vec.segments, near.seg, near.t),
              undefined,
              'Add node',
            ),
          );
          return;
        }
      }
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const r = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    store.setUi({ view: zoomAt(view(), [e.clientX - r.left, e.clientY - r.top], factor) });
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.type === 'keyup') {
        if (e.key === ' ') spaceRef.current = false;
        return;
      }
      if (e.key === ' ') {
        spaceRef.current = true;
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && (key === 'c' || key === 'x' || key === 'v')) {
        e.preventDefault();
        if (key === 'c') copySelection(store);
        else if (key === 'x') cutSelection(store);
        else pasteClipboard(store);
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        store.select(editableVectors().map((v) => v.id));
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (store.ui.selection.length) {
          const before = new Set(store.doc.vectors.map((v) => v.id));
          store.execute(duplicateVectors(store.ui.selection, translation(5, -5)));
          store.select(store.doc.vectors.filter((v) => !before.has(v.id)).map((v) => v.id));
        }
        return;
      }
      if (e.key === 'Escape') {
        if (store.ui.textDraft) store.setUi({ textDraft: undefined, textPreview: undefined });
        setPenCount(0);
        closeHoverRef.current = false;
        penRef.current = [];
        previewRef.current = undefined;
        nodeSelRef.current = undefined;
        if (store.ui.tool === 'select') store.select([]);
        draw();
        return;
      }
      if (e.key === 'Enter' && store.ui.tool === 'pen') {
        finishPen(false);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ns = nodeSelRef.current;
        if (store.ui.tool === 'node' && ns) {
          const vec = store.doc.vectors.find((v) => v.id === ns.id);
          const out = vec && ns.ref.key === 'p' ? deleteNode(vec.segments, ns.ref.seg) : undefined;
          if (out) store.execute(setVectorSegments(ns.id, out, undefined, 'Delete node'));
          nodeSelRef.current = undefined;
          return;
        }
        if (store.ui.selection.length) store.execute(deleteVectors(store.ui.selection));
        return;
      }
      const nudge = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-nudge, 0],
        ArrowRight: [nudge, 0],
        ArrowUp: [0, nudge],
        ArrowDown: [0, -nudge],
      };
      const arrow = arrows[e.key];
      if (arrow && store.ui.selection.length) {
        e.preventDefault();
        store.execute(transformVectors(store.ui.selection, translation(...arrow), 'Nudge'));
        return;
      }
      if (mod || e.altKey) return;
      const tools: Record<string, typeof store.ui.tool> = {
        v: 'select',
        n: 'node',
        p: 'pen',
        r: 'rect',
        e: 'ellipse',
        g: 'polygon',
        s: 'star',
        l: 'line',
        h: 'pan',
        t: 'text',
        b: 'sculpt',
      };
      const t = tools[key];
      if (t) {
        penRef.current = [];
        previewRef.current = undefined;
        store.setUi({ tool: t });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Switching tools drops text that was never added.
  useEffect(() => {
    if (ui.tool !== 'text' && store.ui.textDraft)
      store.setUi({ textDraft: undefined, textPreview: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.tool]);

  // Remember the font and size for the next text.
  useEffect(() => {
    if (ui.textDraft) {
      lastFontRef.current = ui.textDraft.fontId;
      lastSizeRef.current = ui.textDraft.size;
    }
  }, [ui.textDraft]);

  // Switching tools abandons an unfinished pen path.
  useEffect(() => {
    if (ui.tool !== 'pen' && penRef.current.length) {
      penRef.current = [];
      previewRef.current = undefined;
      closeHoverRef.current = false;
      setPenCount(0);
    }
  }, [ui.tool]);

  const cancelPen = () => {
    penRef.current = [];
    previewRef.current = undefined;
    closeHoverRef.current = false;
    setPenCount(0);
    draw();
  };

  const cursor = ui.tool === 'pan' ? 'grab' : ui.tool === 'select' ? 'default' : 'crosshair';
  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="canvas"
        tabIndex={0}
        className="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (penRef.current.length && !dragRef.current) {
            closeHoverRef.current = false;
            previewRef.current = {
              kind: 'draft',
              segments: penSegments(penRef.current, false),
              closed: false,
            };
            draw();
          }
          store.setUi({ cursor: undefined });
        }}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <CanvasOverlay
        store={store}
        penCount={penCount}
        onFinishPen={finishPen}
        onCancelPen={cancelPen}
      />
    </>
  );
}
