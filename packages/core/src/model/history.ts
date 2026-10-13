/**
 * Command pattern + undo/redo (CLAUDE.md: all mutations go through commands).
 *
 * A command is a pure function from one document state to the next. It must
 * not mutate its input; it returns a new document that shares unchanged parts
 * with the old one. Undo restores the previous state object, so there are no
 * hand-written inverse operations to get wrong.
 */

export interface Command<D> {
  /** Human-readable name, e.g. for an "Undo Move" menu item. */
  readonly label: string;
  /** Returns the next document. Returning the same object means "no change". */
  apply(doc: D): D;
}

export interface HistoryOptions {
  /** Maximum number of undo steps kept (oldest are dropped). Default 200. */
  limit?: number;
  /**
   * Deep-freeze every state so a command that mutates its input throws.
   * Typed arrays (relief grids) cannot be frozen and are skipped.
   * Default true; turn off only if profiling shows it matters.
   */
  freeze?: boolean;
}

export type HistoryListener<D> = (doc: D) => void;

interface Entry<D> {
  label: string;
  before: D;
  after: D;
}

/** Groups several commands into one undo step. */
export function composite<D>(label: string, commands: readonly Command<D>[]): Command<D> {
  return { label, apply: (doc) => commands.reduce((d, c) => c.apply(d), doc) };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}

export class History<D> {
  #doc: D;
  #undo: Entry<D>[] = [];
  #redo: Entry<D>[] = [];
  #listeners = new Set<HistoryListener<D>>();
  readonly #limit: number;
  readonly #freeze: boolean;

  constructor(initial: D, options: HistoryOptions = {}) {
    const limit = options.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    this.#limit = limit;
    this.#freeze = options.freeze ?? true;
    this.#doc = this.#freeze ? deepFreeze(initial) : initial;
  }

  get doc(): D {
    return this.#doc;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** Label of the step `undo()` would revert, if any. */
  get undoLabel(): string | undefined {
    return this.#undo.at(-1)?.label;
  }

  /** Label of the step `redo()` would reapply, if any. */
  get redoLabel(): string | undefined {
    return this.#redo.at(-1)?.label;
  }

  /**
   * Runs a command. If it throws, the document and history are unchanged.
   * If it returns the same document, nothing is recorded. Returns true when
   * the document changed.
   */
  execute(command: Command<D>): boolean {
    const before = this.#doc;
    const after = command.apply(before);
    if (after === before) return false;
    if (this.#freeze) deepFreeze(after);

    this.#undo.push({ label: command.label, before, after });
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
    this.#set(after);
    return true;
  }

  /** Reverts the last step. Returns false when there is nothing to undo. */
  undo(): boolean {
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#redo.push(entry);
    this.#set(entry.before);
    return true;
  }

  /** Reapplies the last undone step. Returns false when there is nothing to redo. */
  redo(): boolean {
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#undo.push(entry);
    this.#set(entry.after);
    return true;
  }

  /** Replaces the document (e.g. after loading a file) and clears history. */
  reset(doc: D): void {
    this.#undo = [];
    this.#redo = [];
    this.#set(this.#freeze ? deepFreeze(doc) : doc);
  }

  /** Calls `listener` after every change. Returns an unsubscribe function. */
  subscribe(listener: HistoryListener<D>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(doc: D): void {
    this.#doc = doc;
    for (const listener of this.#listeners) listener(doc);
  }
}
