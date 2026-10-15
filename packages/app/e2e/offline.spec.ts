import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// The service worker exists only in production builds (test:e2e:prod builds dist/ first).
test.skip(!process.env.NAQSH_PROD, 'offline mode needs the production build');

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

/** The sub-path the build was made for (NAQSH_BASE, e.g. /ARTSCAM/ on GitHub Pages). */
const prefix = process.env.NAQSH_BASE ?? '/';

/** Serves dist/ under the prefix on a free port; the test shuts it down to go truly offline. */
function serveDist(): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const full = new URL(req.url ?? '/', 'http://x').pathname;
    if (!full.startsWith(prefix)) return res.writeHead(404).end();
    const path = '/' + full.slice(prefix.length);
    const file = normalize(join(dist, path === '/' ? 'index.html' : path));
    if (!file.startsWith(normalize(dist))) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`,
      }),
    ),
  );
}

test('works offline after the first visit, including Urdu text', async ({ page }) => {
  const { server, url } = await serveDist();
  await page.goto(url);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await expect(page.getByTestId('canvas')).toBeVisible();

  // Stop the server: from here on, only the service worker's cache can answer.
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();

  // Fonts and the HarfBuzz WASM come from the cache too.
  await page.getByTestId('tool-text').click();
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.click(box.x + 400, box.y + 400);
  await page.getByTestId('text-input').fill('اللہ');
  await expect(page.getByTestId('text-add')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('text-add').click();
  await expect(page.getByTestId('vector-count')).toHaveText('1 vectors');
});
