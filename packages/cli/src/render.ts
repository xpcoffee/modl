import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { Document } from '@modl/core';

const DIST = resolve(import.meta.dirname, '../../app/dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/**
 * Serves the built app so a browser can load it. A `file://` page cannot run
 * module scripts, and the point of rendering here is to get what the app
 * actually draws rather than a second drawing that can drift from it.
 */
async function serveDist(): Promise<{ url: string; close: () => Promise<void> }> {
  try {
    await stat(join(DIST, 'index.html'));
  } catch {
    throw new Error(
      `the app has not been built.\n  Run: npm run build\n  Looked in: ${DIST}`,
    );
  }

  const server = createServer(async (request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const file = join(DIST, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export interface RenderOptions {
  out: string;
  width: number;
  height: number;
}

/** Loads the document into the real app and screenshots the board. */
export async function renderDocument(document: Document, options: RenderOptions): Promise<void> {
  const server = await serveDist();
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 2,
    });
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__modl?.ready === true, undefined, { timeout: 20000 });

    const result = await page.evaluate(
      (doc) => window.__modl.dispatch({ type: 'load-document', document: doc }),
      document as never,
    );
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);

    // Frame the whole document, since nothing has panned the camera.
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForTimeout(600);

    // The zoom controls belong to the app, not to a picture of a document.
    await page.addStyleTag({ content: '.react-flow__controls { display: none }' });

    await page.locator('[data-testid="canvas"]').screenshot({ path: options.out });
  } finally {
    await browser.close();
    await server.close();
  }
}

declare global {
  interface Window {
    __modl: {
      ready: boolean;
      dispatch(command: unknown): { ok: true } | { ok: false; error: { code: string; message: string } };
    };
  }
}
