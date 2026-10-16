import { expect, test } from '@playwright/test';

/** A 20 × 20 mm pyramid, 8 mm high, as ASCII STL (base left open: seen from above it does not matter). */
function pyramidStl(): string {
  const a = '0 0 0';
  const b = '20 0 0';
  const c = '20 20 0';
  const d = '0 20 0';
  const apex = '10 10 8';
  const facet = (p: string, q: string, r: string) =>
    `facet normal 0 0 1\n outer loop\n  vertex ${p}\n  vertex ${q}\n  vertex ${r}\n endloop\nendfacet`;
  return `solid pyramid\n${[facet(a, b, apex), facet(b, c, apex), facet(c, d, apex), facet(d, a, apex)].join('\n')}\nendsolid pyramid\n`;
}

test('T6.10: paste a starter clip as one undoable step, edit it, import an STL', async ({
  page,
}) => {
  await page.goto('./');

  await page.getByTestId('tool-clipart').click();
  await expect(page.getByTestId('clip-library')).toBeVisible();
  await page.getByTestId('clip-starter-rosette').click();

  const placed = page.getByTestId('clip-placed');
  await expect(placed).toContainText('Rosette');
  await expect(page.getByTestId('tree-clipart')).toContainText('1');

  // Pasting into an empty project made the relief too, in the same step.
  await page.keyboard.press('Control+z');
  await expect(placed).toHaveCount(0);
  await expect(page.getByText('No clipart in this relief yet.')).toBeVisible();
  await page.getByTestId('tab-relief').click();
  await expect(page.getByTestId('relief-create')).toBeVisible();

  await page.keyboard.press('Control+y');
  await page.getByTestId('tree-clipart').click();
  await expect(placed).toContainText('Rosette');

  // Placement is editable afterwards: turn it.
  await page.getByTestId('clip-rotation-0').fill('45');
  await page.getByTestId('clip-rotation-0').press('Enter');
  await page.getByTestId('tab-relief').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Clipart Rosette');
  await expect(page.getByTestId('relief-steps')).toContainText('turned 45°');
  await expect(page.getByTestId('relief-stats')).toContainText('0.00 – 3.00 mm');

  // A 3D model, seen from above.
  await page.getByTestId('tree-clipart').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('clip-import').click();
  await (
    await chooser
  ).setFiles({
    name: 'pyramid.stl',
    mimeType: 'model/stl',
    buffer: Buffer.from(pyramidStl()),
  });
  await expect(page.getByTestId('message')).toContainText('Imported pyramid.stl (4 triangles)');
  await expect(page.getByTestId('clip-placed-1')).toContainText('Imported');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('clip-placed-1')).toHaveCount(0);
  await expect(page.getByTestId('clip-placed-0')).toContainText('Rosette');
});
