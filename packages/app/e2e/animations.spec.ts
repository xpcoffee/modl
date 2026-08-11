import { expect, test, type Page } from '@playwright/test';
import { dispatch, getDocument, IDS, open, openSearch, sampleDomain } from './support.js';

/**
 * Gravity-wave animations: warp in/out on the element, ripples through the
 * dot grid. The suite runs with reduced motion by default (playwright.config),
 * so these specs opt back in; the last block checks the reduced-motion path.
 *
 * The grid canvas reports `data-ripples-started` (monotonic) and
 * `data-ripples` (active), so specs assert on counters rather than pixels.
 */

const ENTITY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/**
 * How far the wave from a click at `x, y` reaches on screen, in CSS pixels:
 * the furthest pixel the wave moved or lit, measured against the resting
 * grid. Sizes a wave the way a reader sees it, whatever the zoom.
 */
async function waveRadiusOnScreen(page: Page, x: number, y: number): Promise<number> {
  await page.evaluate(
    ([pageX, pageY]) => {
      const canvas = document.querySelector('canvas.gravity-grid') as HTMLCanvasElement;
      const context = canvas.getContext('2d')!;
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const centreX = (pageX! - rect.left) * scale;
      const centreY = (pageY! - rect.top) * scale;
      const read = () => context.getImageData(0, 0, canvas.width, canvas.height).data;

      delete (window as unknown as { __waveRadius?: number }).__waveRadius;
      const resting = read();
      let furthest = 0;
      const started = performance.now();
      const tick = () => {
        const now = read();
        for (let i = 0; i < now.length; i += 4) {
          if (Math.abs(now[i + 3]! - resting[i + 3]!) <= 8) continue;
          const pixel = i / 4;
          const dx = (pixel % canvas.width) - centreX;
          const dy = Math.floor(pixel / canvas.width) - centreY;
          furthest = Math.max(furthest, Math.hypot(dx, dy) / scale);
        }
        if (performance.now() - started < 500) requestAnimationFrame(tick);
        else (window as unknown as { __waveRadius: number }).__waveRadius = furthest;
      };
      requestAnimationFrame(tick);
    },
    [x, y],
  );

  await page.mouse.click(x, y);
  await page.waitForFunction(
    () => (window as unknown as { __waveRadius?: number }).__waveRadius !== undefined,
  );
  return page.evaluate(() => (window as unknown as { __waveRadius: number }).__waveRadius);
}

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

  test('a wave keeps its size on screen when the board is zoomed out', async ({ page }) => {
    // Regression: wave geometry is in flow pixels, so zooming out shrank the
    // wave along with the board until there was nothing left to see. A reader
    // on a large board saw clicks answer with nothing at all (issue #30).
    const framed = await waveRadiusOnScreen(page, 500, 400);
    expect(framed).toBeGreaterThan(50);

    await dispatch(page, [{ type: 'set-view', pan: { x: 0, y: 0 }, zoom: 0.4 }]);
    await expect(page.locator('.react-flow__viewport')).toHaveAttribute(
      'style',
      /scale\(0\.4\)/,
    );

    const zoomedOut = await waveRadiusOnScreen(page, 500, 400);
    expect(Math.abs(zoomedOut - framed) / framed).toBeLessThan(0.25);
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

    // A junction anchors lines on the vertex facing where the line comes
    // from: the fork sits below the UI, so the line arrives at its top.
    const toFork = (await page
      .locator(`.react-flow__edge[data-id^="to-fork"] .react-flow__edge-path`)
      .getAttribute('d'))!;
    const coords = toFork.replace(/[MC]/g, ' ').trim().split(/[ ,]+/).map(Number);
    const [endX, endY] = coords.slice(-2);
    expect(Math.abs(endX! - (fork.x + fork.width / 2))).toBeLessThanOrEqual(8);
    expect(Math.abs(endY! - fork.y)).toBeLessThanOrEqual(8);
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

  test('replaces the search button with the bar rather than growing one', async ({ page }) => {
    await openSearch(page);

    const bar = page.getByTestId('search-bar');
    expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    const panel = page.getByTestId('search-panel');
    expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });

  test('removes the bar rather than shrinking it', async ({ page }) => {
    await openSearch(page);

    // The click's first effect on the bar decides the outcome: an unmount
    // with no animation, or the shrink class arriving first.
    const outcome = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const bar = document.querySelector('[data-testid="search-bar"]')!;
          const observer = new MutationObserver(() => {
            if (!document.contains(bar)) {
              observer.disconnect();
              resolve('unmounted');
            } else if (bar.classList.contains('is-closing')) {
              observer.disconnect();
              resolve('shrinking');
            }
          });
          observer.observe(document.body, { attributes: true, childList: true, subtree: true });
          document.querySelector<HTMLElement>('[data-testid="search-close"]')?.click();
        }),
    );
    expect(outcome).toBe('unmounted');
    await expect(page.getByTestId('search-open')).toBeVisible();
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

  test('the motion preference overrides the system, and survives a reload', async ({ page }) => {
    const grid = page.getByTestId('gravity-grid');

    await page.getByTestId('open-preferences').click();
    await expect(page.getByTestId('motion-system')).toBeChecked();
    await expect(page.getByTestId('motion-system-state')).toContainText('asking for no motion');

    await page.getByTestId('motion-full').check();
    await page.getByTestId('close-preferences').click();

    await expect(grid).toHaveAttribute('data-motion', 'full');
    await page.locator('.react-flow__pane').click({ position: { x: 240, y: 240 } });
    await expect(grid).toHaveAttribute('data-ripples-started', '1');

    // The warps run off CSS, which reads the same override.
    const warpSeen = page.waitForSelector('.react-flow__node.is-warping-in', { state: 'attached' });
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
    await warpSeen;
    const box = page.locator('.react-flow__node.is-warping-in .entity-node');
    expect(await box.evaluate((el) => getComputedStyle(el).animationName)).toBe('warp-in');

    await page.reload();
    await page.waitForFunction(() => window.__modl?.ready === true);
    await expect(page.getByTestId('gravity-grid')).toHaveAttribute('data-motion', 'full');
    await page.getByTestId('open-preferences').click();
    await expect(page.getByTestId('motion-full')).toBeChecked();
  });
});

test.describe('turning motion off', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('the search button grows into the bar, then the panel unfolds below it', async ({ page }) => {
    await open(page);
    await openSearch(page);

    // Two parts in sequence: the bar widens at once, the panel's unfold
    // starts only after the bar's part has run.
    const bar = page.getByTestId('search-bar');
    expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe('search-bar-open');
    expect(await bar.evaluate((el) => getComputedStyle(el).animationDelay)).toBe('0s');
    const panel = page.getByTestId('search-panel');
    expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe(
      'search-panel-open',
    );
    expect(await panel.evaluate((el) => getComputedStyle(el).animationDelay)).toBe('0.15s');
  });

  test('the bar shrinks back into the button when closed', async ({ page }) => {
    await open(page);
    await openSearch(page);

    // The click's first effect on the bar decides the outcome: the closing
    // class arriving, or an unmount that skipped the animation. Watching the
    // mutation itself dodges frame timing, which headless runs stretch past
    // the animations' 300ms.
    const closing = await page.evaluate(
      () =>
        new Promise<{ bar: string; barDelay: string; panel: string; panelDelay: string } | string>(
          (resolve) => {
            const bar = document.querySelector('[data-testid="search-bar"]')!;
            const observer = new MutationObserver(() => {
              if (!document.contains(bar)) {
                observer.disconnect();
                resolve('unmounted');
              } else if (bar.classList.contains('is-closing')) {
                observer.disconnect();
                const panel = document.querySelector('[data-testid="search-panel"]')!;
                resolve({
                  bar: getComputedStyle(bar).animationName,
                  barDelay: getComputedStyle(bar).animationDelay,
                  panel: getComputedStyle(panel).animationName,
                  panelDelay: getComputedStyle(panel).animationDelay,
                });
              }
            });
            observer.observe(document.body, { attributes: true, childList: true, subtree: true });
            document.querySelector<HTMLElement>('[data-testid="search-close"]')?.click();
          },
        ),
    );
    // The open played backwards: the panel folds up at once, the bar narrows
    // only after the panel's part has run.
    expect(closing).toEqual({
      bar: 'search-bar-close',
      barDelay: '0.15s',
      panel: 'search-panel-close',
      panelDelay: '0s',
    });

    // The shrink ends with the button back in place.
    await expect(page.getByTestId('search-bar')).toHaveCount(0);
    await expect(page.getByTestId('search-open')).toBeVisible();
  });

  test('reopening during the shrink brings the bar straight back', async ({ page }) => {
    await open(page);
    await openSearch(page);
    await page.getByTestId('search-close').click();
    await openSearch(page);

    await expect(page.getByTestId('search-input')).toBeVisible();
    // Well past the shrink timer: a stale timer would have emptied the bar.
    await page.waitForTimeout(400);
    await expect(page.getByTestId('search-bar')).toBeVisible();
  });

  test('stills the board, and stops a wave already in flight', async ({ page }) => {
    await open(page);
    const grid = page.getByTestId('gravity-grid');
    await expect(grid).toHaveAttribute('data-motion', 'full');

    await page.locator('.react-flow__pane').click({ position: { x: 240, y: 240 } });
    await expect(grid).toHaveAttribute('data-ripples-started', '1');

    await page.getByTestId('open-preferences').click();
    await page.getByTestId('motion-reduced').check();

    await expect(grid).toHaveAttribute('data-motion', 'reduced');
    await expect(grid).toHaveAttribute('data-ripples', '0');
    // Escape closes the panel, the dialog's own behaviour.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preferences')).toBeHidden();

    await page.locator('.react-flow__pane').click({ position: { x: 400, y: 400 } });
    // Still one: the click after the preference started no wave.
    await page.waitForTimeout(400);
    expect(await grid.getAttribute('data-ripples-started')).toBe('1');
  });

  test('the panel is the reader\'s, and going back to the system hands it back', async ({
    page,
  }) => {
    await open(page);
    const grid = page.getByTestId('gravity-grid');

    await page.getByTestId('open-preferences').click();
    await expect(page.getByTestId('motion-system-state')).toContainText('allowing motion');
    await page.getByTestId('motion-reduced').check();
    await expect(grid).toHaveAttribute('data-motion', 'reduced');

    await page.getByTestId('motion-system').check();

    // The system says motion is fine, so handing the answer back restores it.
    await expect(grid).toHaveAttribute('data-motion', 'full');

    // Nothing the reader chose here belongs to the document.
    expect(await page.evaluate(() => window.__modl.getTrace().length)).toBe(0);
    expect(await page.evaluate(() => JSON.stringify(window.__modl.getDocument()))).not.toContain(
      'motion',
    );
  });
});
