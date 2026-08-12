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
async function serveDist(): Promise<{
  url: string;
  /** Paths the page asked for that the dist does not contain. */
  missing: string[];
  close: () => Promise<void>;
}> {
  try {
    await stat(join(DIST, 'index.html'));
  } catch {
    throw new Error(
      `the app has not been built.\n  Run: npm run build\n  Looked in: ${DIST}`,
    );
  }

  const missing: string[] = [];
  const server = createServer(async (request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const file = join(DIST, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      missing.push(path);
      response.writeHead(404).end('not found');
    }
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/`,
    missing,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export interface RenderOptions {
  out: string;
  width: number;
  height: number;
}

interface PageDiagnostics {
  /** Console lines, `type: text`, in the order the page wrote them. */
  console: string[];
  /** Messages of uncaught exceptions the page threw. */
  errors: string[];
  crashed: boolean;
}

/**
 * Explains a page that loaded but never signalled ready, from what was
 * observed while waiting. The bare Playwright timeout said nothing a caller
 * could act on (#56).
 */
function describeStall(diagnostics: PageDiagnostics, missing: string[]): string {
  const lines = ['the app did not become ready within 20s.'];

  if (diagnostics.crashed) {
    lines.push('  The page crashed. A very large viewport or document can run the browser out of memory.');
  }
  if (missing.length > 0) {
    lines.push('  The page asked for files the built app does not contain at these paths:');
    lines.push(...missing.map((path) => `    ${path}`));
    lines.push('  The app was probably built for a different serving path. Rebuild: npm run build');
  }
  if (diagnostics.errors.length > 0) {
    lines.push('  The page threw before the app signalled ready:');
    lines.push(...diagnostics.errors.map((error) => `    ${error}`));
  }
  if (diagnostics.console.length > 0) {
    lines.push('  Page console:');
    lines.push(...diagnostics.console.slice(-20).map((entry) => `    ${entry}`));
  }
  if (lines.length === 1) {
    lines.push('  The page loaded without errors or console output, and the app never signalled ready.');
  }
  return lines.join('\n');
}

/** Loads the document into the real app and screenshots the board. */
export async function renderDocument(document: Document, options: RenderOptions): Promise<void> {
  const server = await serveDist();

  let browser;
  try {
    browser = await chromium.launch();
  } catch (cause) {
    await server.close();
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes("Executable doesn't exist")) {
      throw new Error(
        'the Playwright browser is not installed.\n  Run: npx playwright install chromium',
        { cause },
      );
    }
    throw cause;
  }

  try {
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 2,
    });

    const diagnostics: PageDiagnostics = { console: [], errors: [], crashed: false };
    page.on('console', (message) => diagnostics.console.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => diagnostics.errors.push(error.message));
    page.on('crash', () => {
      diagnostics.crashed = true;
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });
    try {
      await page.waitForFunction(() => window.__modl?.ready === true, undefined, { timeout: 20000 });
    } catch (cause) {
      throw new Error(describeStall(diagnostics, server.missing), { cause });
    }

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
