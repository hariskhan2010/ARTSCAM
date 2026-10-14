import { History, newProject, type Command, type Project } from '@naqsh/core';
import { useSyncExternalStore } from 'react';
import type { View } from './geometry';

/**
 * Editor store: the project document lives in core's History (all mutations
 * are commands, so undo/redo is free). UI-only state — selection, active tool,
 * view, snapping — lives beside it and is never saved or undone.
 */

export type ToolName =
  'select' | 'node' | 'pen' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'pan';

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
}

export class EditorStore {
  readonly history: History<Project>;
  /** Relief height grids by relief id (binary data kept outside the undo history). */
  reliefData: Record<string, Float32Array> = {};
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
  load(doc: Project, reliefData: Record<string, Float32Array> = {}): void {
    this.reliefData = reliefData;
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
