import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bugReportUrl, versionText } from './about';

/** Bug triage (plan.md T7.4). */

const forms = fileURLToPath(new URL('../../../.github/ISSUE_TEMPLATE/', import.meta.url));

/** Field ids of an issue form (top-level `id:` keys of its body items). */
const fieldIds = (yaml: string) => [...yaml.matchAll(/^ {4}id: ([\w-]+)$/gm)].map((m) => m[1]);

describe('bug reports (T7.4)', () => {
  it('the report link opens the bug form with the version and browser filled in', () => {
    const url = new URL(bugReportUrl('TestBrowser/1.0'));
    expect(url.pathname).toBe('/hariskhan2010/ARTSCAM/issues/new');
    expect(url.searchParams.get('template')).toBe('bug.yml');
    expect(url.searchParams.get('version')).toBe(versionText());
    expect(url.searchParams.get('browser')).toBe('TestBrowser/1.0');
  });

  it('every pre-filled key is a field of the bug form; forms have names and bodies', () => {
    const bug = readFileSync(`${forms}bug.yml`, 'utf8');
    const ids = fieldIds(bug);
    for (const key of ['version', 'browser']) expect(ids).toContain(key);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of ['bug.yml', 'idea.yml']) {
      const text = readFileSync(`${forms}${f}`, 'utf8');
      expect(text, f).toMatch(/^name: .+$/m);
      expect(text, f).toMatch(/^description: .+$/m);
      expect(text, f).toMatch(/^body:$/m);
      // Tabs are not allowed in YAML indentation.
      expect(text, f).not.toMatch(/\t/);
    }
  });
});
