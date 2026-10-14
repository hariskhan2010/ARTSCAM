import {
  evaluateRelief,
  History,
  newProject,
  type Command,
  type Grid,
  type ProjectBundle,
  type Project,
  type Segment,
  type TextAlign,
} from '@naqsh/core';
import { useSyncExternalStore } from 'react';
import type { View } from './geometry';

/**
 * Editor store: the project document lives in core's History (all mutations
 * are commands, so undo/redo is free). UI-only state — selection, active tool,
 * view, snapping — lives beside it and is never saved or undone.
 */

export type ToolName =
  'select' | 'node' | 'pen' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'text' | 'pan';

/** Text being placed with the Text tool (not part of the document until added). */
export interface TextDraft {
  /** Anchor in world mm: baseline of the first line; left, centre or right edge by `align`. */
  at: [number, number];
  text: string;
  fontId: string;
  /** Font size (em height) in mm. */
  size: number;
  align: TextAlign;
}

export interface UiState {
  tool: ToolName;
  selection: readonly string[];
  /** Layer new vectors go into. */
  activeLayer: string;
  view: View | undefined;
  snapGrid: boolean;
  snapPoints: boolean;
  /** Polygon sides / star points for the shape tools. */
  sides: number;
  /** Cursor position in world mm, for the status bar. */
  cursor: [number, number] | undefined;
  /** Short message (import warnings, errors). */
  message: string | undefined;
  sidebarTab: 'design' | 'relief' | 'cam';
  /** Relief shown in the Relief panel, the canvas and the 3D view. */
  activeRelief: string | undefined;
  show3d: boolean;
  /** Toolpath shown in the CAM panel and previewed on the canvas. */
  activeToolpath: string | undefined;
  /** Tool being edited in the tool library. */
  activeTool: string | undefined;
  textDraft: TextDraft | undefined;
  /** Laid-out outline of the draft text (world mm), for the canvas preview. */
  textPreview: Segment[] | undefined;
}

export class EditorStore {
  readonly history: History<Project>;
  /** Grayscale images used by image reliefs, by id (immutable, so outside the undo history). */
  images: Record<string, Uint8Array> = {};
  /** Relief grids are derived from their ops; cached by everything they depend on. */
  #reliefCache = new Map<string, { key: string; grid?: Grid; error?: string }>();
  #ui: UiState;
  #listeners = new Set<() => void>();
  #version = 0;

  constructor(doc: Project = newProject()) {
    this.history = new History(doc);
    this.#ui = {
      tool: 'select',
      selection: [],
      activeLayer: doc.layers[0]?.id ?? 'L1',
      view: undefined,
      snapGrid: true,
      snapPoints: true,
      sides: 6,
      cursor: undefined,
      message: undefined,
      sidebarTab: 'design',
      activeRelief: undefined,
      show3d: false,
      activeToolpath: undefined,
      activeTool: undefined,
      textDraft: undefined,
      textPreview: undefined,
    };
    this.history.subscribe(() => {
      this.#pruneSelection();
      this.#emit();
    });
  }

  get doc(): Project {
    return this.history.doc;
  }

  get ui(): UiState {
    return this.#ui;
  }

  /** Changes on every document or UI update (for useSyncExternalStore). */
  get version(): number {
    return this.#version;
  }

  execute(command: Command<Project>): boolean {
    return this.history.execute(command);
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  /** Replaces the document (open file / new) and resets history and selection. */
  load(doc: Project, images: Record<string, Uint8Array> = {}): void {
    this.images = images;
    this.#reliefCache.clear();
    this.#ui = {
      ...this.#ui,
      selection: [],
      activeLayer: doc.layers[0]?.id ?? 'L1',
      view: undefined,
    };
    this.history.reset(doc);
  }

  setUi(patch: Partial<UiState>): void {
    this.#ui = { ...this.#ui, ...patch };
    this.#emit();
  }

  select(ids: readonly string[]): void {
    this.setUi({ selection: [...new Set(ids)] });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #pruneSelection(): void {
    const ids = new Set(this.doc.vectors.map((v) => v.id));
    const kept = this.#ui.selection.filter((id) => ids.has(id));
    const layerOk = this.doc.layers.some((l) => l.id === this.#ui.activeLayer);
    if (kept.length !== this.#ui.selection.length || !layerOk) {
      this.#ui = {
        ...this.#ui,
        selection: kept,
        activeLayer: layerOk ? this.#ui.activeLayer : (this.doc.layers[0]?.id ?? 'L1'),
      };
    }
  }

  /** The relief's height grid (rebuilt only when its inputs change), or its error. */
  relief(id: string): { grid?: Grid; error?: string } {
    const r = this.doc.reliefs.find((x) => x.id === id);
    if (!r) return { error: 'No such relief' };
    const used = new Set(r.ops.flatMap((o) => (o.op === 'fromVector' ? [o.vector] : [])));
    const key = JSON.stringify([r, this.doc.vectors.filter((v) => used.has(v.id))]);
    const hit = this.#reliefCache.get(id);
    if (hit?.key === key) return hit;
    let entry: { key: string; grid?: Grid; error?: string };
    try {
      entry = { key, grid: evaluateRelief(r, this.doc, this.images) };
    } catch (e) {
      entry = { key, error: (e as Error).message };
    }
    this.#reliefCache.set(id, entry);
    return entry;
  }

  /** Stores a grayscale image for an image relief and returns its new id. */
  addImage(px: Uint8Array): string {
    let n = 1;
    while (this.images[`img${n}`]) n++;
    const id = `img${n}`;
    this.images[id] = px;
    return id;
  }

  /** Everything File › Save writes: project, relief grids and images. */
  bundle(): ProjectBundle {
    const reliefData: Record<string, Float32Array> = {};
    for (const r of this.doc.reliefs) {
      reliefData[r.id] = this.relief(r.id).grid?.z ?? new Float32Array(r.cols * r.rows);
    }
    const used = new Set(
      this.doc.reliefs.flatMap((r) =>
        r.ops.flatMap((o) => (o.op === 'fromImage' ? [o.image] : [])),
      ),
    );
    const images = Object.fromEntries(Object.entries(this.images).filter(([k]) => used.has(k)));
    return { project: this.doc, reliefData, images };
  }

  /** Notifies listeners without changing anything (derived data arrived). */
  touch(): void {
    this.#emit();
  }

  #emit(): void {
    this.#version++;
    for (const l of this.#listeners) l();
  }
}

/** Re-renders when the store changes; returns the store for convenience. */
export function useStore(store: EditorStore): EditorStore {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store;
}
