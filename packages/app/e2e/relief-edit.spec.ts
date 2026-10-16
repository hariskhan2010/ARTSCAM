import { expect, test, type Page } from '@playwright/test';

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

test('T6.9: fade, trim and scale inside a shape', async ({ page }) => {
  await page.goto('./');
  // A flat 4 mm relief from a large rectangle.
  await page.getByTestId('tool-rect').click();
  await drag(page, [150, 150], [650, 450]);
  await page.getByTestId('tab-relief').click();
  await page.getByTestId('relief-create').click();
  await page.getByTestId('relief-profile').locator('[data-value="flat"]').click();
  await page.getByTestId('relief-height').fill('4');
  await page.getByTestId('relief-height').press('Enter');
  await page.getByTestId('relief-add-shapes').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Flat 4 mm');
  await expect(page.getByTestId('relief-stats')).toContainText('0.00 – 4.00');

  // A smaller shape inside it (still selected after drawing).
  await page.getByTestId('tool-rect').click();
  await drag(page, [300, 250], [500, 350]);
  await expect(page.getByTestId('vector-count')).toHaveText('2 vectors');

  await page.getByText('Edit relief', { exact: true }).click();
  await page.getByTestId('edit-keep-inside').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Keep inside shape 2');
  await expect(page.getByTestId('relief-stats')).toContainText('– 4.00');

  await page.getByTestId('edit-fade-line').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Fade (linear) · in shape 2');
  await expect(page.getByTestId('relief-stats')).not.toContainText('– 4.00');

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('relief-steps')).not.toContainText('Fade');
  await page.getByTestId('edit-fade-radial').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Fade (radial) · in shape 2');

  await page.getByTestId('edit-scale-inside').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Scale height × 0.5 · in shape 2');

  await page.getByTestId('edit-keep-outside').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Cut out shape 2');
  await expect(page.getByTestId('relief-stats')).toContainText('0.00 – 0.00');
});
