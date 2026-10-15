import { expect, test, type Page } from '@playwright/test';

async function at(page: Page, p: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  return [box.x + p[0], box.y + p[1]] as const;
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...(await at(page, from)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, to)), { steps: 6 });
  await page.mouse.up();
}
async function click(page: Page, p: [number, number]) {
  await page.mouse.click(...(await at(page, p)));
}
/** Optional screenshots for a visual check: SHOTS=<dir> pnpm test:e2e vector-tools. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}
const num = async (page: Page, id: string) => Number(await page.getByTestId(id).inputValue());

test('T6.7: arc by three clicks, fillet, grid array, align, undo', async ({ page }) => {
  await page.goto('./');

  // Arc: start, end, then a point it passes through.
  await page.getByTestId('tool-arc').click();
  await click(page, [200, 300]);
  await click(page, [400, 300]);
  await click(page, [300, 220]);
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');
  const arcW = await num(page, 'sel-w');
  const arcH = await num(page, 'sel-h');
  expect(arcH).toBeGreaterThan(arcW * 0.3); // a real bulge, not a line

  // Rectangle → fillet keeps its size.
  await page.getByTestId('tool-rect').click();
  await drag(page, [450, 150], [520, 200]);
  const w = await num(page, 'sel-w');
  await page.getByText('Arrange and edit', { exact: true }).click();
  await page.getByTestId('corner-fillet').click();
  await expect(page.getByTestId('vector-count')).toHaveText('2 vectors');
  expect(await num(page, 'sel-w')).toBeCloseTo(w, 3);

  // Grid array 3 × 1, then undo it in one step.
  await page.getByTestId('array-cols').fill('3');
  await page.getByTestId('array-cols').press('Enter');
  await page.getByTestId('array-grid').click();
  await expect(page.getByTestId('vector-count')).toHaveText('4 vectors');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('vector-count')).toHaveText('2 vectors');

  // Align the arc and the rectangle on their bottoms: the selection gets shorter.
  await page.getByTestId('tool-select').click();
  await drag(page, [150, 120], [600, 340]);
  const before = await num(page, 'sel-h');
  await page.getByTestId('align-bottom').click();
  await shot(page, 'vector-tools');
  await expect.poll(() => num(page, 'sel-h')).toBeLessThan(before - 1);
});
