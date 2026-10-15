import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Optional screenshots for a visual check: SHOTS=<dir> pnpm test:e2e text-vcarve. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

async function clickCanvas(page: Page, at: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.click(box.x + at[0], box.y + at[1]);
}

test('M3: Urdu text with the Text tool, V-carved, simulated and exported', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('tool-text').click();
  await clickCanvas(page, [450, 450]);

  await page.getByTestId('text-font').selectOption('nastaliq');
  await page.getByTestId('text-size').fill('60');
  await page.getByTestId('text-size').press('Enter');
  await page.getByTestId('text-input').fill('اللہ');
  // Shaped preview appears, then the text becomes one closed shape.
  await expect(page.getByTestId('text-add')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('text-add').click();
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');
  await expect(page.getByTestId('sel-w')).not.toHaveValue('0');

  await page.getByTestId('tab-cam').click();
  await page.getByTestId('add-tool').selectOption({ label: '60° V-bit, 1/2"' });
  await page.getByTestId('new-vcarve').click();
  await expect(page.getByTestId('tp-estimate')).toContainText('Estimated time', {
    timeout: 30_000,
  });
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('sim-state')).toHaveText('Simulated', { timeout: 60_000 });

  const download = page.waitForEvent('download');
  await page.getByTestId('export-nc').click();
  const gcode = readFileSync(await (await download).path(), 'utf8');
  expect(gcode).toContain('60 deg V-bit');
  expect(gcode).toMatch(/G1 .*Z-\d/);
  await expect(page.getByTestId('message')).toContainText('checker passed');
});

test('text stays editable after it is added and moved; the edit undoes in one step', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByTestId('tool-text').click();
  await clickCanvas(page, [400, 400]);
  await page.getByTestId('text-size').fill('30');
  await page.getByTestId('text-size').press('Enter');
  await page.getByTestId('text-input').fill('AB');
  await expect(page.getByTestId('text-add')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('text-add').click();
  const width = async () => Number(await page.getByTestId('sel-w').inputValue());
  const w1 = await width();
  expect(w1).toBeGreaterThan(0);

  // Move it, then edit: the card opens with the saved text and size.
  await page.getByTestId('sel-y').fill('20');
  await page.getByTestId('sel-y').press('Enter');
  await page.getByTestId('edit-text').click();
  await expect(page.getByTestId('text-input')).toHaveValue('AB');
  await expect(page.getByTestId('text-size')).toHaveValue('30');
  await page.getByTestId('text-input').fill('ABCDEF');
  await expect(page.getByTestId('text-add')).toHaveText('Update text');
  await expect(page.getByTestId('text-add')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('text-add').click();

  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');
  await expect.poll(width).toBeGreaterThan(w1 * 2);
  // Still where it was moved to.
  expect(Number(await page.getByTestId('sel-y').inputValue())).toBeCloseTo(20, 0);

  await page.keyboard.press('Control+z');
  await expect.poll(width).toBeCloseTo(w1, 3);
});

test('text: Escape cancels, mixed Urdu and English shapes without missing glyphs', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByTestId('tool-text').click();
  await clickCanvas(page, [400, 400]);
  await page.getByTestId('text-input').fill('پاکستان Zindabad 2024');
  await expect(page.getByTestId('text-add')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText('This font has no glyph')).toHaveCount(0);
  await page.getByTestId('text-input').press('Escape');
  await expect(page.getByTestId('text-input')).toHaveCount(0);
  await expect(page.getByTestId('vector-count')).toHaveText('0 vectors');
});

test('T6.8: text on a curve stays on it when edited, and V-carves', async ({ page }) => {
  await page.goto('./');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const at = (x: number, y: number) => [box.x + x, box.y + y] as const;
  // The curve: a circle, left selected after drawing.
  await page.getByTestId('tool-ellipse').click();
  await page.mouse.move(...at(300, 250));
  await page.mouse.down();
  await page.mouse.move(...at(500, 450), { steps: 6 });
  await page.mouse.up();
  const num = async (id: string) => Number(await page.getByTestId(id).inputValue());
  const circle = {
    x: await num('sel-x'),
    y: await num('sel-y'),
    w: await num('sel-w'),
    h: await num('sel-h'),
  };

  await page.getByTestId('tool-text').click();
  await clickCanvas(page, [600, 600]);
  await page.getByTestId('text-size').fill('8');
  await page.getByTestId('text-size').press('Enter');
  await page.getByTestId('text-input').fill('NAQSH CARVING');
  await page.getByTestId('text-path-on').click();
  await page.getByTestId('text-path-flip').click();
  await page.getByTestId('text-path-offset').fill('2');
  await page.getByTestId('text-path-offset').press('Enter');
  await expect(page.getByTestId('text-add')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('text-add').click();
  await expect(page.getByTestId('vector-count')).toHaveText('2 vectors');
  await shot(page, 'text-on-curve');
  // Flipped to the outside and centred where it reads level: across the top of the circle.
  const textCentre = (await num('sel-x')) + (await num('sel-w')) / 2;
  expect(Math.abs(textCentre - (circle.x + circle.w / 2))).toBeLessThan(1);
  expect(await num('sel-y')).toBeGreaterThan(circle.y + circle.h / 2);

  // Edit: the curve settings come back; new words stay on the curve.
  await page.getByTestId('edit-text').click();
  await expect(page.getByTestId('text-path-offset')).toHaveValue('2');
  await page.getByTestId('text-input').fill('NAQSH');
  await expect(page.getByTestId('text-add')).toHaveText('Update text');
  await page.getByTestId('text-add').click();
  await expect(page.getByTestId('vector-count')).toHaveText('2 vectors');

  await page.getByTestId('tab-cam').click();
  await page.getByTestId('add-tool').selectOption({ label: '60° V-bit, 1/2"' });
  await page.getByTestId('new-vcarve').click();
  await expect(page.getByTestId('tp-estimate')).toContainText('Estimated time', {
    timeout: 30_000,
  });
});
