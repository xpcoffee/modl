import { expect, test, type Page } from '@playwright/test';
import type { Command } from '@modl/core';
import { dispatch, fit, open, sampleDomain, viewportZoom } from './support.js';

/** React Flow's default zoom floor, which small boards keep. */
const DEFAULT_MIN_ZOOM = 0.5;

/**
 * A board too large to fit on screen at the default floor: a 6 by 5 grid of
 * components spanning roughly 6200 by 3700 flow pixels, against a 1280 by
 * 720 window that shows 2560 by 1440 at 0.5x.
 */
function largeDomain(): Command[] {
  const commands: Command[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const n = (row * 6 + col + 1).toString().padStart(2, '0');
      commands.push({
        type: 'create-entity',
        id: `00000000-0000-4000-8000-0000000000${n}`,
        entityType: 'component',
        title: `Component ${n}`,
        position: { x: col * 1200, y: row * 900 },
      });
    }
  }
  return commands;
}

/**
 * Drives the zoom-out control until the camera sits on the zoom floor,
 * which React Flow reports by disabling the button.
 */
async function zoomOutToFloor(page: Page): Promise<void> {
  const zoomOut = page.locator('.react-flow__controls-zoomout');
  for (let i = 0; i < 20; i += 1) {
    if (!(await zoomOut.isEnabled())) break;
    await zoomOut.click();
  }
  await expect(zoomOut).toBeDisabled();
}

test.beforeEach(async ({ page }) => {
  await open(page);
});

test('a large board fits fully on screen below the default zoom floor', async ({ page }) => {
  await dispatch(page, largeDomain());
  await expect(page.locator('.react-flow__node')).toHaveCount(30);

  await fit(page);

  expect(await viewportZoom(page)).toBeLessThan(DEFAULT_MIN_ZOOM);

  const window = page.viewportSize();
  if (!window) throw new Error('no page viewport size');
  const boxes = await page
    .locator('.react-flow__node')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  expect(boxes).toHaveLength(30);
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(window.width);
    expect(box.bottom).toBeLessThanOrEqual(window.height);
  }
});

test('a small board keeps the default zoom floor', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  await zoomOutToFloor(page);

  expect(await viewportZoom(page)).toBe(DEFAULT_MIN_ZOOM);
});

test('the floor drops when new elements grow the board past it', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await zoomOutToFloor(page);
  expect(await viewportZoom(page)).toBe(DEFAULT_MIN_ZOOM);

  await dispatch(page, [
    {
      type: 'create-entity',
      id: '00000000-0000-4000-8000-000000000099',
      entityType: 'component',
      title: 'Far corner',
      position: { x: 6000, y: 3600 },
    },
  ]);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  await zoomOutToFloor(page);
  expect(await viewportZoom(page)).toBeLessThan(DEFAULT_MIN_ZOOM);
});
