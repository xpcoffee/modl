import { expect, type Page } from '@playwright/test';
import type { Command, Document, TraceEntry } from '@modl/core';

/**
 * The state behind the stubbed file pickers. Playwright cannot drive the
 * native save and open dialogs, so `open` replaces both pickers with fakes
 * that write into this object and read back out of it.
 */
interface FakePickers {
  /** Everything the fake handles wrote, by file name. */
  savedFiles: Record<string, string>;
  /** How many times the save dialog appeared, for overwrite assertions. */
  savePrompts: number;
  /** The name the next save dialog answers with, overriding the suggestion. */
  nextSaveName?: string | undefined;
  /** Files the open dialog serves, first in first out; empty cancels. */
  openQueue: { name: string; content: string }[];
}

declare global {
  interface Window {
    __pickers: FakePickers;
  }
}

export const IDS = {
  ui: '11111111-1111-4111-8111-111111111111',
  gateway: '22222222-2222-4222-8222-222222222222',
  ledger: '33333333-3333-4333-8333-333333333333',
  authorise: '44444444-4444-4444-8444-444444444444',
  post: '55555555-5555-4555-8555-555555555555',
} as const;

/** Loads the app and waits for the runtime API to come up. */
export async function open(page: Page): Promise<void> {
  await stubFilePickers(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__modl?.ready === true);
  await page.evaluate(() => window.__modl.reset());
}

/** Replaces both native file pickers with fakes backed by `window.__pickers`. */
async function stubFilePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pickers: FakePickers = {
      savedFiles: {},
      savePrompts: 0,
      nextSaveName: undefined,
      openQueue: [],
    };
    window.__pickers = pickers;

    const handleFor = (name: string): FileSystemFileHandle => {
      const handle = {
        kind: 'file' as const,
        name,
        async createWritable() {
          let text = '';
          return {
            async write(chunk: string) {
              text += chunk;
            },
            async close() {
              pickers.savedFiles[name] = text;
            },
          };
        },
        async getFile() {
          return new File([pickers.savedFiles[name] ?? ''], name, { type: 'application/json' });
        },
      };
      return handle as unknown as FileSystemFileHandle;
    };

    window.showSaveFilePicker = async (options) => {
      pickers.savePrompts += 1;
      const name = pickers.nextSaveName ?? options?.suggestedName ?? 'domain.modl.json';
      pickers.nextSaveName = undefined;
      return handleFor(name);
    };

    window.showOpenFilePicker = async () => {
      const next = pickers.openQueue.shift();
      if (!next) throw new DOMException('canceled', 'AbortError');
      pickers.savedFiles[next.name] = next.content;
      return [handleFor(next.name)];
    };
  });
}

/** What the fake save dialog wrote under a name, or undefined. */
export async function savedFile(page: Page, name: string): Promise<string | undefined> {
  return page.evaluate((n) => window.__pickers.savedFiles[n], name);
}

/** How many times the fake save dialog has appeared. */
export async function savePrompts(page: Page): Promise<number> {
  return page.evaluate(() => window.__pickers.savePrompts);
}

/** Serves a file through the next fake open dialog. */
export async function queueOpenFile(page: Page, name: string, content: string): Promise<void> {
  await page.evaluate((spec) => {
    window.__pickers.openQueue.push(spec);
  }, { name, content });
}

/** The name the next fake save dialog answers with. */
export async function setNextSaveName(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    window.__pickers.nextSaveName = n;
  }, name);
}

export async function dispatch(page: Page, commands: Command[]): Promise<void> {
  await page.evaluate((batch) => window.__modl.dispatchAll(batch), commands);
}

/**
 * Refits the camera. `fitView` runs on mount only, so a domain built after
 * load can sit outside the viewport and land outside hit-testing.
 */
export async function fit(page: Page): Promise<void> {
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(300);
}

/**
 * Applies a filter through the command bus, for tests about what the board
 * then draws. Tests about the search menu itself drive the menu.
 */
export async function setFilter(page: Page, expression: string): Promise<void> {
  await dispatch(page, [{ type: 'set-filter', expression }]);
}

/** Opens the search menu and waits for its input. */
export async function openSearch(page: Page): Promise<void> {
  await page.keyboard.press('Control+f');
  await page.getByTestId('search-input').waitFor();
}

/**
 * Waits for the element to sit in the middle of the board, which is what a
 * pan is for. The tolerance covers the pan settling and the rounding of a
 * transform. A pan aimed at the wrong place misses by hundreds of pixels, so
 * the two never read alike.
 */
export async function expectCentred(page: Page, testId: string, tolerance = 10): Promise<void> {
  const pane = await page.locator('.react-flow__pane').boundingBox();
  if (!pane) throw new Error('the board is not on screen');
  await expect
    .poll(async () => {
      const target = await page.getByTestId(testId).boundingBox();
      if (!target) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(target.x + target.width / 2 - (pane.x + pane.width / 2)),
        Math.abs(target.y + target.height / 2 - (pane.y + pane.height / 2)),
      );
    })
    .toBeLessThan(tolerance);
}

/** The zoom the camera is drawn at, read from the viewport transform. */
export async function viewportZoom(page: Page): Promise<number> {
  const transform = await page
    .locator('.react-flow__viewport')
    .evaluate((viewport) => viewport.style.transform);
  const scale = /scale\(([^)]+)\)/.exec(transform);
  if (!scale) throw new Error(`no scale in viewport transform: ${transform}`);
  return Number(scale[1]);
}

export async function getDocument(page: Page): Promise<Document> {
  return page.evaluate(() => window.__modl.getDocument());
}

export async function getTrace(page: Page): Promise<TraceEntry[]> {
  return page.evaluate(() => window.__modl.getTrace());
}

export async function serialize(page: Page): Promise<string> {
  return page.evaluate(() => window.__modl.serialize());
}

/** A three-component domain with two interactions. */
export function sampleDomain(): Command[] {
  return [
    { type: 'create-entity', id: IDS.ui, entityType: 'component', title: 'Checkout UI', position: { x: 0, y: 0 } },
    { type: 'create-entity', id: IDS.gateway, entityType: 'component', title: 'Payment gateway', position: { x: 280, y: 0 } },
    { type: 'create-entity', id: IDS.ledger, entityType: 'component', title: 'Ledger', position: { x: 560, y: 0 } },
    { type: 'create-connection', id: IDS.authorise, connectionType: 'interaction', from: [IDS.ui], to: [IDS.gateway], title: 'authorise' },
    { type: 'create-connection', id: IDS.post, connectionType: 'interaction', from: [IDS.gateway], to: [IDS.ledger], title: 'post entry' },
    { type: 'set-tag', id: IDS.ui, key: 'team', values: ['web'] },
    { type: 'set-tag', id: IDS.gateway, key: 'team', values: ['payments'] },
    { type: 'set-tag', id: IDS.ledger, key: 'team', values: ['payments'] },
  ];
}
