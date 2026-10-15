import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function at(page: Page, p: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  return [box.x + p[0], box.y + p[1]] as const;
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...(await at(page, from)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, to)), { steps: 8 });
  await page.mouse.up();
}

async function click(page: Page, p: [number, number]) {
  await page.mouse.click(...(await at(page, p)));
}

/** Optional screenshots for a visual check: SHOTS=<dir> pnpm test:e2e m6. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test('M6: border extrude, spun rosette, texture and a sculpt stroke → 3D → finish export', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');

  // Frame (the rail) and a small open cross-section inside it, drawn with the pen.
  await page.getByTestId('tool-rect').click();
  await drag(page, [150, 150], [650, 450]);
  await page.getByTestId('tool-pen').click();
  await click(page, [350, 300]);
  await click(page, [375, 280]);
  await click(page, [400, 300]);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('vector-count')).toHaveText('2 vectors');

  await page.getByTestId('tree-add-relief').click();
  await page.getByText('Sweeps', { exact: true }).click();

  // The pen path is still selected: it is the cross-section.
  await page.getByTestId('sweep-section').click();
  await expect(page.getByTestId('sweep-section-value')).toHaveText('shape 2');
  // Select the frame: it is the rail.
  await page.getByTestId('tool-select').click();
  await click(page, [150, 300]);
  await page.getByTestId('sweep-rail').click();
  await expect(page.getByTestId('sweep-rail-value')).toHaveText('shape 1');

  await page.getByTestId('sweep-extrude').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Extrude along shape 1');
  await page.getByTestId('sweep-spin').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Spin section 2');

  await page.getByText('Texture', { exact: true }).click();
  await page.getByTestId('texture-pattern').selectOption('dimples');
  await page.getByTestId('texture-add').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Texture dimples');

  await page.getByText('Sculpt', { exact: true }).click();
  await page.getByTestId('sculpt-start').click();
  await drag(page, [250, 380], [550, 380]);
  await expect(page.getByTestId('relief-steps')).toContainText('Sculpt raise');
  await expect(page.getByTestId('relief-stats')).not.toContainText('0.00 – 0.00');

  // One stroke is one step.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('relief-steps')).not.toContainText('Sculpt');
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('relief-steps')).toContainText('Sculpt raise');

  await shot(page, 'm6-relief-2d');
  await page.getByTestId('relief-3d').click();
  await expect(page.getByTestId('relief-3d-view').locator('canvas')).toBeVisible();
  await page.waitForTimeout(process.env.SHOTS ? 1500 : 0); // let the 3D view render for the shot
  await shot(page, 'm6-relief-3d');
  await page.getByRole('button', { name: 'Close 3D' }).click();

  await page.getByTestId('tab-cam').click();
  await page.getByTestId('add-tool').selectOption({ label: '6 mm ball nose' });
  await page.getByTestId('new-finish3d').click();
  await expect(page.getByTestId('tp-estimate')).toContainText('Estimated time', {
    timeout: 60_000,
  });
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('sim-state')).toHaveText('Simulated', { timeout: 60_000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('export-nc').click();
  const gcode = readFileSync(await (await download).path(), 'utf8');
  expect(gcode).toContain('ball nose');
  await expect(page.getByTestId('message')).toContainText('checker passed');
});
