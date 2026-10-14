import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

test('M2 flow: tool → profile → simulate → export, blocked until simulated', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tool-rect').click();
  await drag(page, [300, 300], [500, 450]);
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');

  await page.getByTestId('tab-cam').click();
  // No tool yet: creating a toolpath asks for one.
  await page.getByTestId('new-profile').click();
  await expect(page.getByTestId('message')).toContainText('Add a tool first');

  await page.getByTestId('add-tool').selectOption({ label: '6 mm flat end mill' });
  await page.getByTestId('new-profile').click();
  await page.getByTestId('tp-depth').fill('6');
  await page.getByTestId('tp-depth').press('Enter');

  await expect(page.getByTestId('tp-estimate')).toContainText('Time');
  await expect(page.getByTestId('sim-state')).toHaveText('Not simulated');
  await expect(page.getByTestId('export-nc')).toBeDisabled();

  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('sim-state')).toHaveText('Simulated');
  await expect(page.getByTestId('export-nc')).toBeEnabled();

  const download = page.waitForEvent('download');
  await page.getByTestId('export-nc').click();
  const file = await (await download).path();
  const gcode = readFileSync(file, 'utf8');
  expect(gcode).toContain('G21 G90 G94 G17');
  expect(gcode).toContain('M3 S18000');
  expect(gcode).toMatch(/Z-6[ \n]/);
  expect(gcode.trim().endsWith('M30')).toBe(true);
  await expect(page.getByTestId('message')).toContainText('checker passed');

  // Any edit re-locks export until simulated again.
  await page.getByTestId('tp-side').selectOption('inside');
  await expect(page.getByTestId('sim-state')).toHaveText('Not simulated');
  await expect(page.getByTestId('export-nc')).toBeDisabled();
});

test('checker errors block export even after simulation', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tool-rect').click();
  await drag(page, [300, 300], [400, 400]);
  await page.getByTestId('tab-cam').click();
  await page.getByTestId('add-tool').selectOption({ label: '6 mm flat end mill' });
  await page.getByTestId('new-pocket').click();
  // Deeper than the 18 mm stock.
  await page.getByTestId('tp-depth').fill('25');
  await page.getByTestId('tp-depth').press('Enter');
  await expect(page.getByTestId('tp-issues')).toContainText('depth');
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('sim-state')).toHaveText('Simulated');
  await expect(page.getByTestId('export-nc')).toBeDisabled();
});
