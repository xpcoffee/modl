import { expect, test, type Page } from '@playwright/test';
import { IDS, dispatch, fit, getTrace, open, sampleDomain } from './support.js';

const ENTITY = '99999999-9999-4999-8999-999999999999';

function createEntity() {
  return {
    type: 'create-entity',
    id: ENTITY,
    entityType: 'component',
    title: 'Rebindable',
    position: { x: 200, y: 200 },
  } as const;
}

async function elementCount(page: Page): Promise<number> {
  return page.evaluate(() => Object.keys(window.__modl.getDocument().model.elements).length);
}

async function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...window.__modl.getState().selection].sort());
}

/** Opens the preferences dialog and walks into the input bindings page. */
async function openBindings(page: Page): Promise<void> {
  await page.getByTestId('open-preferences').click();
  await page.getByTestId('open-keybindings').click();
  await page.getByTestId('binding-undo').waitFor();
}

test.beforeEach(async ({ page }) => {
  await open(page);
});

test('the bindings page replaces the panel, and the breadcrumb walks back', async ({ page }) => {
  await page.getByTestId('open-preferences').click();
  await expect(page.getByTestId('motion-system')).toBeVisible();

  await page.getByTestId('open-keybindings').click();
  await expect(page.getByTestId('motion-system')).toBeHidden();
  await expect(page.getByTestId('binding-undo')).toContainText('Ctrl+Z');
  await expect(page.getByTestId('binding-redo')).toContainText('Ctrl+Y or Ctrl+Shift+Z');
  await expect(page.getByTestId('binding-box-select')).toContainText('Shift+Left drag');
  await expect(page.getByTestId('binding-pan')).toContainText('Middle drag');

  await page.getByTestId('breadcrumb-preferences').click();
  await expect(page.getByTestId('motion-system')).toBeVisible();
  await expect(page.getByTestId('binding-undo')).toHaveCount(0);
});

test('a rebound key acts immediately, and survives a reload', async ({ page }) => {
  await dispatch(page, [createEntity()]);
  expect(await elementCount(page)).toBe(1);

  await openBindings(page);
  await page.getByTestId('binding-undo').click();
  await expect(page.getByTestId('binding-undo')).toContainText('Press a key');
  await page.keyboard.press('Control+u');
  await expect(page.getByTestId('binding-undo')).toContainText('Ctrl+U');
  await page.getByTestId('close-preferences').click();

  // The key that moved away no longer undoes.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  expect(await elementCount(page)).toBe(1);

  await page.keyboard.press('Control+u');
  await expect.poll(() => elementCount(page)).toBe(0);

  await page.reload();
  await page.waitForFunction(() => window.__modl?.ready === true);
  await openBindings(page);
  await expect(page.getByTestId('binding-undo')).toContainText('Ctrl+U');
});

test('the delete binding feeds React Flow, so the new key deletes the selection', async ({
  page,
}) => {
  await dispatch(page, [createEntity()]);
  await fit(page);

  await openBindings(page);
  await page.getByTestId('binding-delete').click();
  await page.keyboard.press('x');
  await expect(page.getByTestId('binding-delete')).toContainText('X');
  await page.getByTestId('close-preferences').click();

  const node = page.locator(`.react-flow__node[data-id="${ENTITY}"]`);
  await node.click();
  await expect.poll(() => selection(page)).toEqual([ENTITY]);

  // The keys that moved away no longer delete.
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  await expect(node).toHaveCount(1);

  await page.keyboard.press('x');
  await expect(node).toHaveCount(0);
});

test('escape backs out of a capture without changing the binding', async ({ page }) => {
  await openBindings(page);
  await page.getByTestId('binding-redo').click();
  await expect(page.getByTestId('binding-redo')).toContainText('Press a key');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('binding-redo')).toContainText('Ctrl+Y or Ctrl+Shift+Z');
  // The Escape that backed out did not also close the dialog.
  await expect(page.getByTestId('preferences')).toBeVisible();
});

test('reset restores every default at once', async ({ page }) => {
  await dispatch(page, [createEntity()]);

  await openBindings(page);
  await page.getByTestId('binding-undo').click();
  await page.keyboard.press('Control+u');
  await expect(page.getByTestId('binding-undo')).toContainText('Ctrl+U');

  await page.getByTestId('reset-keybindings').click();
  await expect(page.getByTestId('binding-undo')).toContainText('Ctrl+Z');
  expect(await page.evaluate(() => window.localStorage.getItem('modl.keybindings'))).toBeNull();

  await page.getByTestId('close-preferences').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => elementCount(page)).toBe(0);
});

test('the box-select modifier can move to alt', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await fit(page);

  await openBindings(page);
  await page.getByTestId('binding-box-select').click();
  await expect(page.getByTestId('binding-box-select')).toContainText('Press a button');

  const panel = (await page.getByTestId('preferences').boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.click(panel.x + panel.width / 2, panel.y + 12);
  await page.keyboard.up('Alt');
  await expect(page.getByTestId('binding-box-select')).toContainText('Alt+Left drag');
  await page.getByTestId('close-preferences').click();

  const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(gateway.x - 25, gateway.y - 25);
  await page.mouse.down();
  await page.mouse.move(gateway.x + gateway.width + 25, gateway.y + gateway.height + 25, {
    steps: 8,
  });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  await expect
    .poll(() => selection(page))
    .toEqual([IDS.gateway, IDS.authorise, IDS.post].sort());
});

test('the search binding follows the reader, and never reaches the document or the trace', async ({
  page,
}) => {
  await openBindings(page);
  await page.getByTestId('binding-search').click();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('binding-search')).toContainText('Ctrl+K');
  await page.getByTestId('close-preferences').click();

  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('search-input')).toBeVisible();

  expect((await getTrace(page)).length).toBe(0);
  expect(await page.evaluate(() => window.__modl.serialize())).not.toContain('binding');
});
