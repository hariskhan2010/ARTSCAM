import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { History, composite, deepFreeze, type Command } from './history';
import { projectSchema, type Project, type Segment } from './schema';

const fixtureUrl = new URL('../../../../fixtures/projects/sample-project.json', import.meta.url);

function sampleProject(): Project {
  return projectSchema.parse(JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8')));
}

// --- Test commands: immutable updates on the project document -------------

const setStockWidth = (width: number): Command<Project> => ({
  label: 'Set stock width',
  apply: (p) => ({ ...p, stock: { ...p.stock, width } }),
});

const addLayer = (id: string): Command<Project> => ({
  label: 'Add layer',
  apply: (p) => ({ ...p, layers: [...p.layers, { id, name: id, visible: true, locked: false }] }),
});

const toggleLayer = (index: number): Command<Project> => ({
  label: 'Toggle layer',
  apply: (p) => ({
    ...p,
    layers: p.layers.map((l, i) =>
      i === index % p.layers.length ? { ...l, visible: !l.visible } : l,
    ),
  }),
});

const addSquare = (id: string, x: number, y: number): Command<Project> => ({
  label: 'Add square',
  apply: (p) => ({
    ...p,
    vectors: [
      ...p.vectors,
      {
        id,
        layer: p.layers[0]!.id,
        closed: true,
        segments: [
          { type: 'move', p: [x, y] },
          { type: 'line', p: [x + 10, y] },
          { type: 'line', p: [x + 10, y + 10] },
          { type: 'close' },
        ],
      },
    ],
  }),
});

const translate = (s: Segment, dx: number, dy: number): Segment => {
  const t = ([x, y]: [number, number]): [number, number] => [x + dx, y + dy];
  switch (s.type) {
    case 'move':
    case 'line':
      return { ...s, p: t(s.p) };
    case 'quad':
      return { ...s, c: t(s.c), p: t(s.p) };
    case 'cubic':
      return { ...s, c1: t(s.c1), c2: t(s.c2), p: t(s.p) };
    case 'close':
      return s;
  }
};

const moveVector = (index: number, dx: number, dy: number): Command<Project> => ({
  label: 'Move',
  apply: (p) => ({
    ...p,
    vectors: p.vectors.map((v, i) =>
      i === index % p.vectors.length
        ? { ...v, segments: v.segments.map((s) => translate(s, dx, dy)) }
        : v,
    ),
  }),
});

const removeLastUnusedVector = (): Command<Project> => ({
  label: 'Delete vector',
  apply: (p) => {
    const used = new Set([
      ...p.reliefs.flatMap((r) => r.ops.flatMap((o) => (o.op === 'fromVector' ? [o.vector] : []))),
      ...p.toolpaths.flatMap((t) => t.vectors),
    ]);
    const victim = p.vectors.findLast((v) => !used.has(v.id));
    return victim ? { ...p, vectors: p.vectors.filter((v) => v !== victim) } : p;
  },
});

/** Small deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCommand(rand: () => number, step: number): Command<Project> {
  const pick = Math.floor(rand() * 6);
  const n = Math.round(rand() * 1000) / 10;
  switch (pick) {
    case 0:
      return setStockWidth(100 + n);
    case 1:
      return addLayer(`L${step + 2}`);
    case 2:
      return toggleLayer(step);
    case 3:
      return addSquare(`s${step}`, n, n / 2);
    case 4:
      return moveVector(step, n - 50, 0.1 + n / 7);
    default:
      return composite('Add and move', [
        addSquare(`c${step}`, n, n),
        moveVector(-1, 1 / 3, -1 / 3),
      ]);
  }
}

// --- Acceptance: 100-step undo/redo restores identical document -----------

describe('History: 100-step undo/redo (T0.4 acceptance)', () => {
  it('undoes 100 steps back to the identical original and redoes to the identical end', () => {
    const initial = sampleProject();
    const initialCopy = structuredClone(initial);
    const history = new History(initial);
    const rand = rng(42);

    // snapshots[i] = deep copy of the document after i steps.
    const snapshots: Project[] = [initialCopy];
    const states: Project[] = [history.doc];
    while (snapshots.length <= 100) {
      if (history.execute(randomCommand(rand, snapshots.length))) {
        expect(projectSchema.safeParse(history.doc).success).toBe(true);
        snapshots.push(structuredClone(history.doc));
        states.push(history.doc);
      }
    }
    expect(snapshots.length).toBe(101);
    const final = history.doc;

    for (let i = 100; i > 0; i--) {
      expect(history.undo()).toBe(true);
      expect(history.doc).toEqual(snapshots[i - 1]);
      expect(history.doc).toBe(states[i - 1]);
    }
    expect(history.undo()).toBe(false);
    expect(history.doc).toBe(initial);
    expect(history.doc).toEqual(initialCopy);

    for (let i = 1; i <= 100; i++) {
      expect(history.redo()).toBe(true);
      expect(history.doc).toEqual(snapshots[i]);
    }
    expect(history.redo()).toBe(false);
    expect(history.doc).toBe(final);
    expect(JSON.stringify(history.doc)).toBe(JSON.stringify(snapshots[100]));
  });

  it('matches a reference model under 600 random execute/undo/redo operations', () => {
    const history = new History(sampleProject(), { limit: 10_000 });
    const rand = rng(7);
    // Reference model: a plain list of states and a cursor.
    const timeline: string[] = [JSON.stringify(history.doc)];
    let cursor = 0;

    for (let step = 0; step < 600; step++) {
      const r = rand();
      if (r < 0.5) {
        if (history.execute(randomCommand(rand, step))) {
          timeline.length = cursor + 1;
          timeline.push(JSON.stringify(history.doc));
          cursor++;
        }
      } else if (r < 0.8) {
        expect(history.undo()).toBe(cursor > 0);
        if (cursor > 0) cursor--;
      } else {
        expect(history.redo()).toBe(cursor < timeline.length - 1);
        if (cursor < timeline.length - 1) cursor++;
      }
      expect(JSON.stringify(history.doc)).toBe(timeline[cursor]);
      expect(history.canUndo).toBe(cursor > 0);
      expect(history.canRedo).toBe(cursor < timeline.length - 1);
    }
  });
});

// --- Behaviour ------------------------------------------------------------

describe('History behaviour', () => {
  it('freezes states so a mutating command throws and changes nothing', () => {
    const history = new History(sampleProject());
    const before = history.doc;
    const bad: Command<Project> = {
      label: 'Bad',
      apply: (p) => {
        p.stock.width = 1;
        return p;
      },
    };
    expect(() => history.execute(bad)).toThrow(TypeError);
    expect(history.doc).toBe(before);
    expect(history.doc.stock.width).toBe(300);
    expect(history.canUndo).toBe(false);
  });

  it('leaves state untouched when a command throws', () => {
    const history = new History(sampleProject());
    history.execute(setStockWidth(500));
    const doc = history.doc;
    const failing: Command<Project> = {
      label: 'Fail',
      apply: () => {
        throw new Error('nope');
      },
    };
    expect(() => history.execute(failing)).toThrow('nope');
    expect(history.doc).toBe(doc);
    expect(history.undoLabel).toBe('Set stock width');
  });

  it('records nothing when a command returns the same document', () => {
    const history = new History<Project>({ ...sampleProject(), vectors: [] });
    expect(history.execute(removeLastUnusedVector())).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  it('clears redo when a new command runs after undo', () => {
    const history = new History(sampleProject());
    history.execute(setStockWidth(400));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.execute(addLayer('L2'));
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it('treats a composite as a single undo step', () => {
    const history = new History(sampleProject());
    const start = history.doc;
    history.execute(composite('Add two', [addLayer('A'), addLayer('B')]));
    expect(history.doc.layers.map((l) => l.id)).toEqual(['L1', 'A', 'B']);
    expect(history.undoLabel).toBe('Add two');
    history.undo();
    expect(history.doc).toBe(start);
  });

  it('drops the oldest steps beyond the limit', () => {
    const history = new History(sampleProject(), { limit: 3 });
    for (let w = 1; w <= 5; w++) history.execute(setStockWidth(w * 100));
    let undos = 0;
    while (history.undo()) undos++;
    expect(undos).toBe(3);
    expect(history.doc.stock.width).toBe(200);
  });

  it('rejects an invalid limit', () => {
    expect(() => new History(1, { limit: 0 })).toThrow(RangeError);
    expect(() => new History(1, { limit: 1.5 })).toThrow(RangeError);
  });

  it('exposes undo/redo labels', () => {
    const history = new History(sampleProject());
    expect(history.undoLabel).toBeUndefined();
    history.execute(addLayer('X'));
    expect(history.undoLabel).toBe('Add layer');
    history.undo();
    expect(history.undoLabel).toBeUndefined();
    expect(history.redoLabel).toBe('Add layer');
  });

  it('notifies subscribers on execute, undo, redo and reset, until unsubscribed', () => {
    const history = new History(sampleProject());
    const seen: number[] = [];
    const off = history.subscribe((d) => seen.push(d.stock.width));
    history.execute(setStockWidth(111));
    history.undo();
    history.redo();
    history.reset({ ...sampleProject(), stock: { ...sampleProject().stock, width: 222 } });
    off();
    history.execute(setStockWidth(333));
    expect(seen).toEqual([111, 300, 111, 222]);
  });

  it('reset replaces the document and clears both stacks', () => {
    const history = new History(sampleProject());
    history.execute(addLayer('A'));
    history.execute(addLayer('B'));
    history.undo();
    const fresh = sampleProject();
    history.reset(fresh);
    expect(history.doc).toBe(fresh);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('can run without freezing', () => {
    const doc = sampleProject();
    const history = new History(doc, { freeze: false });
    history.execute(addLayer('A'));
    expect(Object.isFrozen(doc)).toBe(false);
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays but skips typed arrays', () => {
    const grid = new Float32Array(4);
    const value = deepFreeze({ a: { b: [1, { c: 2 }] }, grid });
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
    expect(() => {
      (value.a.b as unknown[]).push(3);
    }).toThrow(TypeError);
    grid[0] = 5; // still writable; relief grids are replaced, not mutated, by commands
    expect(grid[0]).toBe(5);
  });
});
