import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** User guide checks (plan.md T7.3). */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const guide = `${root}docs/guide/`;
const read = (path: string) => readFileSync(path, 'utf8');

/** Rows of the first Markdown table after `heading` (cells trimmed). */
function tableAfter(text: string, heading: RegExp): string[][] {
  const lines = text.slice(text.search(heading)).split('\n');
  const start = lines.findIndex((l) => l.startsWith('|'));
  const rows: string[][] = [];
  for (const l of lines.slice(start)) {
    if (!l.startsWith('|')) break;
    if (/^\|[\s|-]+\|$/.test(l)) continue;
    rows.push(
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  }
  return rows;
}

describe('user guide (T7.3)', () => {
  const pages = readdirSync(guide).filter((f) => /^\d\d-.*\.md$/.test(f));

  it('every page exists and is linked from the index, and every link works', () => {
    expect(pages.length).toBeGreaterThanOrEqual(8);
    const index = read(`${guide}README.md`);
    for (const p of pages) expect(index, p).toContain(`](${p})`);
    for (const file of ['README.md', ...pages]) {
      for (const [, link] of read(`${guide}${file}`).matchAll(/\]\(([^)#]+\.md)(#[^)]*)?\)/g))
        expect(existsSync(`${guide}${link}`), `${file} → ${link}`).toBe(true);
    }
  });

  it('the safety table matches plan.md §7 row for row', () => {
    const plan = tableAfter(read(`${root}plan.md`), /^## 7\. CNC safety/m);
    const doc = tableAfter(read(`${guide}02-before-the-first-cut.md`), /^## What Naqsh checks/m);
    expect(plan.length).toBeGreaterThanOrEqual(8);
    expect(doc).toEqual(plan);
  });
});
