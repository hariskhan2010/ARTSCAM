import { expect, test } from '@playwright/test';

test('T6.14: trace a picture into one vector, undo removes it', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('canvas')).toBeVisible();

  // A small black ring (disc with a hole) on white, drawn in the browser.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 80, 60);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(40, 30, 25, 0, Math.PI * 2);
    ctx.arc(40, 30, 10, 0, Math.PI * 2, true);
    ctx.fill();
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1] as string, 'base64');

  await page.getByTestId('tree-bitmaps').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('bitmap-trace').click();
  await (await chooser).setFiles({ name: 'ring.png', mimeType: 'image/png', buffer });

  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');
  await expect(page.getByTestId('message')).toContainText('2 outlines');

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('vector-count')).toHaveText('0 vectors');
});
