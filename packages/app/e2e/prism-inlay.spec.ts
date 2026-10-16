import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

async function simulateAndExport(page: Page): Promise<string> {
  await expect(page.getByTestId('tp-estimate')).toContainText('Estimated time', {
    timeout: 30_000,
  });
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('sim-state')).toHaveText('Simulated', { timeout: 60_000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('export-nc').click();
  const gcode = readFileSync(await (await download).path(), 'utf8');
  await expect(page.getByTestId('message')).toContainText('checker passed');
  return gcode;
}

test('T6.12: raised prism and inlay plug on a shape, simulated and exported', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('tool-rect').click();
  await drag(page, [400, 300], [480, 340]);
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');

  await page.getByTestId('tab-cam').click();
  await page.getByTestId('add-tool').selectOption({ label: '90° V-bit, 1/2"' });
  await page.getByTestId('new-prism').click();
  await expect(page.getByTestId('tp-prism-mode').locator('[data-value="raised"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('tp-margin')).toBeVisible();
  const prism = await simulateAndExport(page);
  expect(prism).toContain('90 deg V-bit');
  expect(prism).toMatch(/G1 .*Z-3/);

  await page.getByTestId('new-inlay').click();
  await page.getByTestId('tp-inlay-part').locator('[data-value="plug"]').click();
  const plug = await simulateAndExport(page);
  expect(plug).toContain('mirrored');
});
