import { expect, test } from '@playwright/test';
import { dispatch, IDS, open, sampleDomain } from './support.js';

/**
 * Gravity-wave animations: warp in/out on the element, ripples through the
 * dot grid. The suite runs with reduced motion by default (playwright.config),
 * so these specs opt back in; the last block checks the reduced-motion path.
 *
 * The grid canvas reports `data-ripples-started` (monotonic) and
 * `data-ripples` (active), so specs assert on counters rather than pixels.
 */

const ENTITY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test.describe('gravity waves', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('a click on empty canvas ripples the dot grid, and the wave dies out', async ({ page }) => {
    const grid = page.getByTestId('gravity-grid');
    await expect(grid).toHaveAttribute('data-motion', 'full');
    await expect(grid).toHaveAttribute('data-ripples-started', '0');

    await page.locator('.react-flow__pane').click({ position: { x: 240, y: 240 } });

    await expect(grid).toHaveAttribute('data-ripples-started', '1');
    // Damped: the wave ends rather than looping.
    await expect(grid).toHaveAttribute('data-ripples', '0');
  });

  test('a new element warps in, and its wave follows', async ({ page }) => {
    const grid = page.getByTestId('gravity-grid');
    // Registered before the dispatch: the warp lasts 0.3s, so a poll started
    // afterwards can miss it on a loaded machine.
    const warpSeen = page.waitForSelector('.react-flow__node.is-warping-in', {
      state: 'attached',
    });
    await page.evaluate(
      (id) =>
        window.__modl.dispatch({
          type: 'create-entity',
          id,
          entityType: 'component',
          title: 'Warped in',
          position: { x: 200, y: 200 },
        }),
      ENTITY,
    );

    // The node arrives warping, then settles; the ripple timer starts the
    // wave in the same tick that ends the warp.
    await warpSeen;
    await expect(page.locator('.react-flow__node.is-warping-in')).toHaveCount(0);
    await expect(grid).toHaveAttribute('data-ripples-started', '1');
    await expect(grid).toHaveAttribute('data-ripples', '0');
  });

  test('a deleted element leaves a warp-out ghost, then an inward wave', async ({ page }) => {
    const grid = page.getByTestId('gravity-grid');
    await dispatch(page, sampleDomain());
    // Three entities arrived, so three waves; wait for the field to settle.
    await expect(grid).toHaveAttribute('data-ripples-started', '3');
    await expect(grid).toHaveAttribute('data-ripples', '0');

    // Registered before the dispatch: the ghost lives for 0.3s, so a poll
    // started afterwards can miss it on a loaded machine.
    const ghostSeen = page.waitForSelector(`[data-testid="warp-ghost-${IDS.ledger}"]`, {
      state: 'attached',
    });
    await page.evaluate(
      (id) => window.__modl.dispatch({ type: 'delete-element', id }),
      IDS.ledger,
    );

    // The node leaves the tree at once; the ghost plays the exit in its place.
    await ghostSeen;
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveCount(0);
    await expect(page.getByTestId(`warp-ghost-${IDS.ledger}`)).toHaveCount(0);
    // One inward wave for the entity; its cascaded connection has no box.
    await expect(grid).toHaveAttribute('data-ripples-started', '4');
  });

  test('loading a document animates nothing', async ({ page }) => {
    const grid = page.getByTestId('gravity-grid');
    await dispatch(page, sampleDomain());
    // The three creation waves have started and died before the baseline is read.
    await expect(grid).toHaveAttribute('data-ripples-started', '3');
    await expect(grid).toHaveAttribute('data-ripples', '0');
    const saved = await page.evaluate(() => window.__modl.serialize());

    await page.evaluate(
      (text) => window.__modl.dispatch({ type: 'load-document', document: JSON.parse(text) }),
      saved,
    );

    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.locator('.react-flow__node.is-warping-in')).toHaveCount(0);
    // Past the point a wrongly scheduled warp would have started its wave.
    await page.waitForTimeout(400);
    expect(await grid.getAttribute('data-ripples-started')).toBe('3');
  });
});

test.describe('reduced motion', () => {
  // No test.use: the suite default is reducedMotion 'reduce'.

  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('disables ripples, warps, and ghosts', async ({ page }) => {
    const grid = page.getByTestId('gravity-grid');
    await expect(grid).toHaveAttribute('data-motion', 'reduced');

    await page.locator('.react-flow__pane').click({ position: { x: 240, y: 240 } });
    await page.locator('.react-flow__pane').dblclick({ position: { x: 320, y: 320 } });

    const node = page.locator('.react-flow__node');
    await expect(node).toHaveCount(1);
    await expect(page.locator('.react-flow__node.is-warping-in')).toHaveCount(0);

    await node.click();
    await page.getByTestId('delete-selected').click();

    await expect(node).toHaveCount(0);
    await expect(page.locator('.warp-ghost')).toHaveCount(0);
    await expect(grid).toHaveAttribute('data-ripples-started', '0');
  });
});
