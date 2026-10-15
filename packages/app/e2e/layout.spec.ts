import { expect, test, type Page } from '@playwright/test';

/** Window layout (menus, toolbars, view tabs, project tree, status bar). */

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

/** Optional screenshots for a visual check: SHOTS=<dir> pnpm test:e2e layout. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test('menu bar: menus in order, items run actions, unbuilt items say "Coming later"', async ({
  page,
}) => {
  await page.goto('/');
  const titles = await page.getByRole('menubar').locator('.menu-title').allTextContents();
  expect(titles).toEqual([
    'File',
    'Edit',
    'View',
    'Model',
    'Vector',
    'Bitmap',
    'Relief',
    'Toolpath',
    '3D Printing',
    'Window',
    'Help',
  ]);

  // Vector › Rectangle picks the tool; draw a shape with it.
  await page.getByTestId('menu-vector').click();
  await page.getByTestId('mi-vector-rectangle').click();
  await expect(page.getByTestId('tool-rect')).toHaveAttribute('aria-pressed', 'true');
  await drag(page, [200, 200], [320, 300]);
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');

  // Edit › Copy, Edit › Paste; Edit › Undo.
  await page.getByTestId('menu-edit').click();
  await page.getByTestId('mi-edit-copy').click();
  await page.getByTestId('menu-edit').click();
  await page.getByTestId('mi-edit-paste').click();
  await expect(page.getByTestId('vector-count')).toHaveText('2 vectors');
  await page.getByTestId('menu-edit').click();
  await page.getByTestId('mi-edit-undo-paste').click();
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');

  // Not built yet: disabled, with the tooltip, and clicking does nothing.
  await page.getByTestId('menu-relief').click();
  const turn = page.getByTestId('mi-relief-turn');
  await expect(turn).toHaveAttribute('aria-disabled', 'true');
  await expect(turn).toHaveAttribute('title', 'Coming later');
  await shot(page, 'menu-relief');
  await turn.click({ force: true }); // aria-disabled: Playwright would wait for it to enable
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('2D / 3D view tabs and the relief toolbar', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tool-ellipse').click();
  await drag(page, [250, 200], [400, 320]);
  await expect(page.getByTestId('view-2d')).toHaveAttribute('aria-selected', 'true');

  // Shape to relief from the toolbar creates the relief and opens its panel.
  await page.getByTestId('tb-shape-relief').click();
  await expect(page.getByTestId('relief-steps')).toContainText('Dome 5 mm');
  await expect(page.getByTestId('tab-relief')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('mi-relief')).toContainText('max');

  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('relief-3d-view').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('view-3d')).toHaveAttribute('aria-selected', 'true');
  await shot(page, 'view-3d');
  await page.getByTestId('view-2d').click();
  await expect(page.getByTestId('relief-3d-view')).toHaveCount(0);
});

test('project tree shows its panels; + buttons create things; status shows X Y Z and W H', async ({
  page,
}) => {
  await page.goto('/');
  const tree = page.getByRole('tree', { name: 'Project' });
  const rows = await tree.locator('.tree-row > .tree-label').allTextContents();
  expect(rows).toEqual([
    'Vectors',
    'Design',
    'Bitmaps',
    'Front Relief',
    'Back Relief',
    'Clipart',
    'Sheets',
    'Toolpaths',
  ]);
  await expect(page.getByTestId('tree-clipart')).toHaveAttribute('aria-disabled', 'true');

  // + on Vectors adds a layer, listed under it.
  await page.getByTestId('tree-add-layer').click();
  await expect(tree).toContainText('Layer 2');

  await page.getByTestId('tool-rect').click();
  await drag(page, [200, 200], [300, 260]);
  await expect(page.getByTestId('status-wh')).toContainText(/W \d/);

  // + on Front Relief creates it and opens the Relief panel.
  await page.getByTestId('tree-add-relief').click();
  await expect(page.getByTestId('relief-stats')).toBeVisible();
  await expect(page.getByTestId('tree-add-relief')).toHaveCount(0);

  // + on Back Relief creates a second, separate relief for the other face.
  await page.getByTestId('tree-add-back-relief').click();
  await expect(page.getByText('turn the material over left to right')).toBeVisible();
  await expect(page.getByTestId('tree-add-back-relief')).toHaveCount(0);
  await page.getByTestId('tab-relief').click();
  await expect(page.getByText('turn the material over left to right')).toHaveCount(0);

  // Toolpath from the toolbar appears in the tree; picking it shows its settings.
  await page.getByTestId('tab-cam').click();
  await page.getByTestId('add-tool').selectOption({ label: '6 mm flat end mill' });
  await page.getByTestId('tb-tp-profile').click();
  await expect(tree).toContainText('Profile 1');
  await page.getByTestId('tab-design').click();
  await expect(page.getByTestId('sel-x')).toBeVisible();
  await tree.getByText('Profile 1').click();
  await expect(page.getByTestId('tp-depth')).toBeVisible();

  // Status bar: X, Y and Z (relief height) under the cursor.
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 250, box.y + 230);
  await expect(page.getByTestId('status-xyz')).toContainText(/X [\d.]+ {2}Y [\d.]+ {2}Z [\d.]+/);
  await expect(page.getByTestId('ruler-top')).toBeVisible();
  await expect(page.getByTestId('ruler-left')).toBeVisible();
  await shot(page, 'tree-toolpath');
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });
  test('menus, toolbars, tree and rulers follow the dark theme', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tool-star').click();
    await drag(page, [300, 250], [380, 330]);
    await page.getByTestId('tb-shape-relief').click();
    const bg = (sel: string) =>
      page
        .locator(sel)
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    for (const sel of ['.menubar', '.toolbar-row', '.project-tree', '.model-info', '.status'])
      expect(await bg(sel), sel).not.toBe('rgb(255, 255, 255)');
    await page.getByTestId('menu-file').click();
    await shot(page, 'dark-menu');
    await page.keyboard.press('Escape');
    await page.getByTestId('view-3d').click();
    await expect(page.getByTestId('relief-3d-view').locator('canvas')).toBeVisible();
    await shot(page, 'dark-3d');
  });
});

test('usable at 1366 × 551: everything in reach without page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 551 });
  await page.goto('/');
  for (const id of ['menu-help', 'tb-delete', 'tb-tp-finish3d', 'tool-clipart', 'tab-cam']) {
    await expect(page.getByTestId(id)).toBeInViewport();
  }
  await expect(page.getByTestId('model-info')).toBeInViewport();
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth - innerWidth,
    document.documentElement.scrollHeight - innerHeight,
  ]);
  expect(scroll).toEqual([0, 0]);
  await page.getByTestId('tool-ellipse').click();
  await drag(page, [200, 150], [320, 250]);
  await expect(page.getByTestId('sel-x')).toBeVisible();
  await shot(page, 'small-light');
});
