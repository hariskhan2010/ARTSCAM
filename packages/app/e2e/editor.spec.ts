import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/vector/${name}`, import.meta.url));

/** Canvas-relative pointer drag. */
async function drag(
  page: Page,
  from: readonly [number, number],
  to: readonly [number, number],
  opts: { shift?: boolean } = {},
) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
}

async function click(page: Page, at: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.click(box.x + at[0], box.y + at[1]);
}

const count = (page: Page) => page.getByTestId('vector-count');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('draw, select, move, undo and redo', async ({ page }) => {
  await page.getByTestId('tool-rect').click();
  await drag(page, [300, 300], [450, 400]);
  await expect(count(page)).toHaveText('1 vectors');

  await page.getByTestId('tool-select').click();
  await click(page, [375, 350]);
  const x0 = Number(await page.getByTestId('sel-x').inputValue());
  await drag(page, [375, 350], [475, 350]);
  const x1 = Number(await page.getByTestId('sel-x').inputValue());
  expect(x1).toBeGreaterThan(x0 + 10);

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('sel-x')).toHaveValue(String(x0));
  await page.getByTestId('undo').click();
  await expect(count(page)).toHaveText('0 vectors');
  await page.getByTestId('redo').click();
  await page.getByTestId('redo').click();
  await expect(count(page)).toHaveText('1 vectors');
});

test('typed position and size edits apply and undo', async ({ page }) => {
  await page.getByTestId('tool-ellipse').click();
  await drag(page, [300, 300], [400, 380]);
  const w = page.getByTestId('sel-w');
  await w.fill('50');
  await w.press('Enter');
  await expect(w).toHaveValue('50');
  await page.keyboard.press('Control+z');
  await expect(w).not.toHaveValue('50');
});

test('shape tools, keyboard shortcuts and delete', async ({ page }) => {
  for (const [tool, from, to] of [
    ['tool-polygon', [200, 200], [240, 200]],
    ['tool-star', [400, 200], [440, 220]],
    ['tool-line', [200, 450], [400, 500]],
  ] as const) {
    await page.getByTestId(tool).click();
    await drag(page, from, to);
  }
  await expect(count(page)).toHaveText('3 vectors');
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+d');
  await expect(count(page)).toHaveText('6 vectors');
  await page.keyboard.press('Delete');
  await expect(count(page)).toHaveText('3 vectors');
});

test('pen draws a closed curved path, node tool edits it', async ({ page }) => {
  await page.getByTestId('tool-pen').click();
  await click(page, [300, 300]);
  await drag(page, [420, 300], [460, 260]); // smooth node
  await click(page, [380, 420]);
  await click(page, [300, 300]); // close on the first node
  await expect(count(page)).toHaveText('1 vectors');

  await page.getByTestId('tool-node').click();
  // The first node sits at (300, 300); drag it away.
  await drag(page, [300, 300], [260, 330]);
  await expect(page.getByTestId('undo')).toHaveAttribute('title', /Edit nodes/);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('undo')).toHaveAttribute('title', /Pen/);
});

test('pen shows how to finish, and Cancel / Finish work', async ({ page }) => {
  await page.getByTestId('tool-pen').click();
  await expect(page.getByTestId('tool-hint')).toContainText('Click the first point to close');
  await click(page, [300, 300]);
  await click(page, [400, 300]);
  await expect(page.getByTestId('pen-count')).toHaveText('2 points');
  await page.getByTestId('pen-cancel').click();
  await expect(page.getByTestId('pen-count')).toHaveCount(0);
  await expect(count(page)).toHaveText('0 vectors');

  await click(page, [300, 300]);
  await click(page, [400, 300]);
  await click(page, [400, 380]);
  await page.getByTestId('pen-finish').click();
  await expect(count(page)).toHaveText('1 vectors');

  // Switching tools drops an unfinished path.
  await click(page, [200, 200]);
  await page.getByTestId('tool-rect').click();
  await expect(page.getByTestId('pen-count')).toHaveCount(0);
});

test('zoom and pan keep the editor responsive', async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.wheel(0, -500);
  await page.getByTestId('tool-pan').click();
  await drag(page, [300, 300], [200, 250]);
  await page.getByTestId('tool-rect').click();
  await drag(page, [100, 100], [150, 150]);
  await expect(count(page)).toHaveText('1 vectors');
});

test('SVG import at scale and export round trip', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import').click();
  await (await chooser).setFiles(fixture('sign.svg'));
  await expect(count(page)).toHaveText('5 vectors');
  await expect(page.getByTestId('message')).toContainText('Imported 5 vectors');

  const download = page.waitForEvent('download');
  await page.getByTestId('export-svg').click();
  const file = await (await download).path();
  const text = readFileSync(file, 'utf8');
  expect(text).toContain('width="300mm"');
  expect(text.match(/<path/g)).toHaveLength(5);
});

test('DXF import', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import').click();
  await (await chooser).setFiles(fixture('sign.dxf'));
  await expect(count(page)).toHaveText('5 vectors');
});

test('autosave restores the drawing after a reload', async ({ page }) => {
  await page.getByTestId('tool-rect').click();
  await drag(page, [300, 300], [420, 380]);
  await expect(count(page)).toHaveText('1 vectors');
  await page.waitForTimeout(1500); // autosave fires a second after the change
  await page.reload();
  await expect(count(page)).toHaveText('1 vectors');
  await expect(page.getByTestId('message')).toContainText('Restored your last session');
});
