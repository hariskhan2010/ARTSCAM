import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function clickCanvas(page: Page, at: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.click(box.x + at[0], box.y + at[1]);
}

test('M3: Urdu text with the Text tool, V-carved, simulated and exported', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');
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
  await page.goto('/');
  await page.getByTestId('tool-text').click();
  await clickCanvas(page, [400, 400]);
  await page.getByTestId('text-input').fill('پاکستان Zindabad 2024');
  await expect(page.getByTestId('text-add')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText('This font has no glyph')).toHaveCount(0);
  await page.getByTestId('text-input').press('Escape');
  await expect(page.getByTestId('text-input')).toHaveCount(0);
  await expect(page.getByTestId('vector-count')).toHaveText('0 vectors');
});
