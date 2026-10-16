import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

test('T6.12 fluting: ball nose → fluting → simulate → export', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('tool-rect').click();
  await drag(page, [300, 300], [500, 450]);
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');

  await page.getByTestId('tab-cam').click();
  await page.getByTestId('add-tool').selectOption({ label: '6 mm ball nose' });
  await page.getByTestId('new-fluting').click();
  await page.getByTestId('tp-depth').fill('2');
  await page.getByTestId('tp-depth').press('Enter');
  await page.getByTestId('tp-ramp-in').fill('15');
  await page.getByTestId('tp-ramp-in').press('Enter');

  await expect(page.getByTestId('tp-estimate')).toContainText('Estimated time');
  await expect(page.getByTestId('export-nc')).toBeDisabled();
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('sim-state')).toHaveText('Simulated');
  await expect(page.getByTestId('export-nc')).toBeEnabled();

  const download = page.waitForEvent('download');
  await page.getByTestId('export-nc').click();
  const gcode = readFileSync(await (await download).path(), 'utf8');
  expect(gcode).toContain('(Tool: 6 mm ball nose');
  expect(gcode).toMatch(/Z-2[ \n]/);
  expect(gcode.trim().endsWith('M30')).toBe(true);
  await expect(page.getByTestId('message')).toContainText('checker passed');
});
