import { expect, test } from '@playwright/test';
import { dispatch, getDocument, IDS, open, sampleDomain } from './support.js';

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

  test('edges still anchor on element edges when nodes warp in', async ({ page }) => {
    // Regression: React Flow caches handle positions from the DOM at mount.
    // When the warp-in scale covered the handles, a warping node's handles
    // were cached scaled toward its centre, and every connection to it then
    // anchored inside the element instead of on its border.
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'create-connection-node', id: 'fork', shape: 'diamond', title: 'q', position: { x: 100, y: 300 } },
      { type: 'create-connection', id: 'to-fork', connectionType: 'relation', from: [IDS.ui], to: ['fork'], title: '' },
    ]);
    await expect(page.locator('.react-flow__node.is-warping-in')).toHaveCount(0);

    const doc = await getDocument(page);
    const ui = doc.layout[IDS.ui] as { x: number; y: number; width: number; height: number };
    const fork = doc.layout['fork'] as { x: number; y: number; width: number; height: number };

    // authorise leaves the UI's right edge for the gateway.
    const authorise = (await page
      .locator(`.react-flow__edge[data-id^="${IDS.authorise}"] .react-flow__edge-path`)
      .getAttribute('d'))!;
    const [startX, startY] = authorise.replace('M', '').trim().split(/[ ,]+/).map(Number);
    expect(Math.abs(startX! - (ui.x + ui.width))).toBeLessThanOrEqual(8);
    expect(Math.abs(startY! - (ui.y + ui.height / 2))).toBeLessThanOrEqual(8);

    // A junction anchors lines at its centre.
    const toFork = (await page
      .locator(`.react-flow__edge[data-id^="to-fork"] .react-flow__edge-path`)
      .getAttribute('d'))!;
    const coords = toFork.replace(/[MC]/g, ' ').trim().split(/[ ,]+/).map(Number);
    const [endX, endY] = coords.slice(-2);
    expect(Math.abs(endX! - (fork.x + fork.width / 2))).toBeLessThanOrEqual(8);
    expect(Math.abs(endY! - (fork.y + fork.height / 2))).toBeLessThanOrEqual(8);
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
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-style', id: IDS.ledger, style: { stroke: '#e05d5d' } },
    ]);
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

    // The node leaves the tree at once; the ghost plays the exit in its place,
    // wearing the element's own stroke rather than the default border.
    const ghost = await ghostSeen;
    expect(await ghost.evaluate((el) => getComputedStyle(el).borderColor)).toBe(
      'rgb(224, 93, 93)',
    );
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveCount(0);
    await expect(page.getByTestId(`warp-ghost-${IDS.ledger}`)).toHaveCount(0);
    // One inward wave for the entity; its cascaded connection has no box.
    await expect(grid).toHaveAttribute('data-ripples-started', '4');
  });

  test('an expanded group neither ripples nor ghosts; only solid elements do', async ({ page }) => {
    const GROUP = '77777777-7777-4777-8777-777777777777';
    const grid = page.getByTestId('gravity-grid');
    await dispatch(page, sampleDomain());
    await expect(grid).toHaveAttribute('data-ripples-started', '3');
    await expect(grid).toHaveAttribute('data-ripples', '0');

    // The toolbar's sequence: create the group, then open it as a container.
    await dispatch(page, [
      {
        type: 'group-elements',
        id: GROUP,
        title: 'Payments',
        memberIds: [IDS.gateway, IDS.ledger],
        position: { x: 280, y: 0 },
      },
      { type: 'set-expanded', id: GROUP, expanded: true },
    ]);
    await expect(page.getByTestId(`group-${GROUP}`)).toBeVisible();

    // Past the point the creation wave would have started: none did.
    await page.waitForTimeout(400);
    expect(await grid.getAttribute('data-ripples-started')).toBe('3');

    await page.evaluate((id) => window.__modl.dispatch({ type: 'delete-element', id }), GROUP);

    // The container goes without a ghost; its members stay on the board.
    await expect(page.getByTestId(`group-${GROUP}`)).toHaveCount(0);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.locator('.warp-ghost')).toHaveCount(0);
    expect(await grid.getAttribute('data-ripples-started')).toBe('3');
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
