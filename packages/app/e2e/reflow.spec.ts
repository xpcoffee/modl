import { expect, test, type Page } from '@playwright/test';
import type { EntityLayout } from '@modl/core';
import { dispatch, getDocument, getTrace, open, serialize } from './support.js';

/**
 * The reflow button (issue #43): one press re-spaces the board so that
 * neighbours clear each other, as one command that undoes in one step. The
 * suite runs with reduced motion by default (playwright.config), so the
 * glide specs opt back in; the canvas stamps `data-glides` (monotonic)
 * so they assert on a counter rather than pixels.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LINK = '44444444-4444-4444-8444-444444444444';

/** Two components on top of each other, joined by a line. */
async function overlappingPair(page: Page): Promise<void> {
  await dispatch(page, [
    { type: 'create-entity', id: A, entityType: 'component', title: 'Checkout UI', position: { x: 0, y: 0 } },
    { type: 'create-entity', id: B, entityType: 'component', title: 'Gateway', position: { x: 40, y: 10 } },
    { type: 'create-connection', id: LINK, connectionType: 'interaction', from: [A], to: [B], title: '' },
  ]);
}

function box(document: Awaited<ReturnType<typeof getDocument>>, id: string): EntityLayout {
  return document.layout[id] as EntityLayout;
}

test.describe('reflow', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('one press respaces overlapping elements, and one undo puts them back', async ({ page }) => {
    await overlappingPair(page);
    const before = await serialize(page);

    await page.getByTestId('board-reflow').click();

    const doc = await getDocument(page);
    const a = box(doc, A);
    const b = box(doc, B);
    // B stays to A's right, one horizontal gap clear of it.
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(64);

    // The whole tidy-up is one command in the trace...
    const trace = await getTrace(page);
    expect(trace.filter((entry) => entry.command.type === 'reflow-layout')).toHaveLength(1);

    // ...so one undo restores every position exactly.
    await page.evaluate(() => window.__modl.undo());
    expect(await serialize(page)).toBe(before);
  });

  test('a press on a board that already reads dispatches nothing', async ({ page }) => {
    await overlappingPair(page);
    await page.getByTestId('board-reflow').click();

    // The first press settled the board; the second has nothing to move.
    await page.getByTestId('board-reflow').click();
    const trace = await getTrace(page);
    expect(trace.filter((entry) => entry.command.type === 'reflow-layout')).toHaveLength(1);
  });

  test('under reduced motion the elements land at once', async ({ page }) => {
    await overlappingPair(page);
    await page.getByTestId('board-reflow').click();

    await expect(page.getByTestId('canvas')).toHaveAttribute('data-glides', '0');
    const b = box(await getDocument(page), B);
    await expect(page.locator(`.react-flow__node[data-id="${B}"]`)).toHaveCSS(
      'transform',
      `matrix(1, 0, 0, 1, ${b.x}, ${b.y})`,
    );
  });
});

test.describe('reflow glide', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('a reflow glides the moved elements to their new positions', async ({ page }) => {
    await overlappingPair(page);
    await page.getByTestId('board-reflow').click();

    await expect(page.getByTestId('canvas')).toHaveAttribute('data-glides', '1');

    // The glide settles on exactly the positions the command wrote.
    const b = box(await getDocument(page), B);
    await expect(page.locator(`.react-flow__node[data-id="${B}"]`)).toHaveCSS(
      'transform',
      `matrix(1, 0, 0, 1, ${b.x}, ${b.y})`,
    );
  });

  test('a plain drag never glides', async ({ page }) => {
    await overlappingPair(page);
    await dispatch(page, [{ type: 'move-element', id: B, position: { x: 400, y: 200 } }]);
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-glides', '0');
  });
});
