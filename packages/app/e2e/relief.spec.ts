import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

test('M4: shape → dome relief, 3D view, STL export, undo', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tool-ellipse').click();
  await drag(page, [300, 260], [520, 420]);
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');

  await page.getByTestId('tab-relief').click();
  await page.getByTestId('relief-create').click();
  await page.getByTestId('relief-profile').locator('[data-value="dome"]').click();
  await page.getByTestId('relief-height').fill('8');
  await page.getByTestId('relief-height').press('Enter');
  await page.getByTestId('relief-add-shapes').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Dome 8 mm');
  await expect(page.getByTestId('relief-stats')).toContainText(/– 7\.9\d|– 8\.0\d/);

  await page.getByTestId('relief-3d').click();
  await expect(page.getByTestId('relief-3d-view').locator('canvas')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByTestId('relief-stl').click();
  const stl = readFileSync(await (await download).path());
  const triangles = stl.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(1000);
  expect(stl.length).toBe(84 + 50 * triangles);

  await page.getByRole('button', { name: 'Close 3D' }).click();
  await page.keyboard.press('Control+z'); // undo the dome step
  await expect(page.getByTestId('relief-steps')).toHaveCount(0);
});
