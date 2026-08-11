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
  await page.getByTestId('binding-undo-0').waitFor();
}

test.beforeEach(async ({ page }) => {
  await open(page);
});

test('the bindings page replaces the panel, and the breadcrumb walks back', async ({ page }) => {
  await page.getByTestId('open-preferences').click();
  await expect(page.getByTestId('motion-system')).toBeVisible();

  await page.getByTestId('open-keybindings').click();
  await expect(page.getByTestId('motion-system')).toBeHidden();
  await expect(page.getByTestId('binding-undo-0')).toContainText('Ctrl+Z');
  await expect(page.getByTestId('binding-redo-0')).toContainText('Ctrl+Y');
  await expect(page.getByTestId('binding-redo-1')).toContainText('Ctrl+Shift+Z');
  await expect(page.getByTestId('binding-box-select-0')).toContainText('Shift+Left drag');
  await expect(page.getByTestId('binding-pan-0')).toContainText('Left drag');
  await expect(page.getByTestId('binding-pan-1')).toContainText('Middle drag');
  await expect(page.getByTestId('binding-cancel-0')).toContainText('Escape');

  await page.getByTestId('breadcrumb-preferences').click();
  await expect(page.getByTestId('motion-system')).toBeVisible();
  await expect(page.getByTestId('binding-undo-0')).toHaveCount(0);
});

test('a rebound key acts immediately, and survives a reload', async ({ page }) => {
  await dispatch(page, [createEntity()]);
  expect(await elementCount(page)).toBe(1);

  await openBindings(page);
  await page.getByTestId('binding-undo-0').click();
  await expect(page.getByTestId('binding-undo-0')).toContainText('Press a key');
  await page.keyboard.press('Control+u');
  await expect(page.getByTestId('binding-undo-0')).toContainText('Ctrl+U');
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
  await expect(page.getByTestId('binding-undo-0')).toContainText('Ctrl+U');
});

test('the delete binding feeds React Flow, so the new key deletes the selection', async ({
  page,
}) => {
  await dispatch(page, [createEntity()]);
  await fit(page);

  await openBindings(page);
  // Delete holds two slots; empty the Backspace one, then move the other.
  await page.getByTestId('remove-delete-1').click();
  await expect(page.getByTestId('add-binding-delete')).toBeVisible();
  await page.getByTestId('binding-delete-0').click();
  await page.keyboard.press('x');
  await expect(page.getByTestId('binding-delete-0')).toContainText('X');
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
  await page.getByTestId('binding-redo-0').click();
  await expect(page.getByTestId('binding-redo-0')).toContainText('Press a key');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('binding-redo-0')).toContainText('Ctrl+Y');
  // The Escape that backed out did not also close the dialog.
  await expect(page.getByTestId('preferences')).toBeVisible();
});

test('reset restores every default at once', async ({ page }) => {
  await dispatch(page, [createEntity()]);

  await openBindings(page);
  await page.getByTestId('binding-undo-0').click();
  await page.keyboard.press('Control+u');
  await expect(page.getByTestId('binding-undo-0')).toContainText('Ctrl+U');
  await page.getByTestId('remove-pan-0').click();
  await page.getByTestId('mode-box-select-begin-end').click();

  await page.getByTestId('reset-keybindings').click();
  await expect(page.getByTestId('binding-undo-0')).toContainText('Ctrl+Z');
  await expect(page.getByTestId('binding-pan-0')).toContainText('Left drag');
  await expect(page.getByTestId('mode-box-select-hold')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.localStorage.getItem('modl.keybindings'))).toBeNull();

  await page.getByTestId('close-preferences').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => elementCount(page)).toBe(0);
});

test('the box-select modifier can move to alt', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await fit(page);

  await openBindings(page);
  await page.getByTestId('binding-box-select-0').click();
  await expect(page.getByTestId('binding-box-select-0')).toContainText('Press a key or button');

  const panel = (await page.getByTestId('preferences').boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.click(panel.x + panel.width / 2, panel.y + 12);
  await page.keyboard.up('Alt');
  await expect(page.getByTestId('binding-box-select-0')).toContainText('Alt+Left drag');
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

test('removing the left-drag pan binding returns the plain cursor', async ({ page }) => {
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toHaveClass(/draggable/);

  await openBindings(page);
  await page.getByTestId('remove-pan-0').click();
  // The middle-drag binding shifts into the first slot, and a slot opens.
  await expect(page.getByTestId('binding-pan-0')).toContainText('Middle drag');
  await expect(page.getByTestId('add-binding-pan')).toBeVisible();
  await page.getByTestId('close-preferences').click();

  await expect(pane).not.toHaveClass(/draggable/);
});

test('pan can move to the right button', async ({ page }) => {
  await openBindings(page);
  await page.getByTestId('binding-pan-1').click();
  await expect(page.getByTestId('binding-pan-1')).toContainText('Press a button');
  const panel = (await page.getByTestId('preferences').boundingBox())!;
  await page.mouse.click(panel.x + panel.width / 2, panel.y + 12, { button: 'right' });
  await expect(page.getByTestId('binding-pan-1')).toContainText('Right drag');
  await page.getByTestId('close-preferences').click();

  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.getAttribute('style');
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(pane.x + pane.width / 2 + 120, pane.y + pane.height / 2 + 60, {
    steps: 6,
  });
  await page.mouse.up({ button: 'right' });

  await expect.poll(() => viewport.getAttribute('style')).not.toBe(before);
});

test('box select can take the bare left drag', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await fit(page);

  await openBindings(page);
  // Left drag stops panning so the bare drag reads as one gesture.
  await page.getByTestId('remove-pan-0').click();
  await page.getByTestId('binding-box-select-0').click();
  // A bare left press outside the panel's own controls is the binding.
  await page.mouse.click(8, 8);
  await expect(page.getByTestId('binding-box-select-0')).toContainText('Left drag');
  // The captured press did not dismiss the dialog.
  await expect(page.getByTestId('preferences')).toBeVisible();
  await page.getByTestId('close-preferences').click();

  const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
  await page.mouse.move(gateway.x - 25, gateway.y - 25);
  await page.mouse.down();
  await page.mouse.move(gateway.x + gateway.width + 25, gateway.y + gateway.height + 25, {
    steps: 8,
  });
  await page.mouse.up();

  await expect
    .poll(() => selection(page))
    .toEqual([IDS.gateway, IDS.authorise, IDS.post].sort());
});

test('the bare left click binds from anywhere, the panel included', async ({ page }) => {
  await openBindings(page);

  // The reported gesture: remove the left-drag pan, then bind it back with
  // a plain click inside the panel.
  await page.getByTestId('remove-pan-0').click();
  await page.getByTestId('add-binding-pan').click();
  await expect(page.getByTestId('add-binding-pan')).toContainText('Press a button');
  await page.getByTestId('add-binding-pan').click();
  await expect(page.getByTestId('binding-pan-1')).toContainText('Left drag');

  // The same press binds box select, landing on any panel control.
  await page.getByTestId('binding-box-select-0').click();
  await page.getByTestId('reset-keybindings').click();
  await expect(page.getByTestId('binding-box-select-0')).toContainText('Left drag');
  // The swallowed press did not also reset: pan still holds the rebinding.
  await expect(page.getByTestId('binding-pan-1')).toContainText('Left drag');
});

test('a held key drives duplicate: press, move, release', async ({ page }) => {
  await dispatch(page, [createEntity()]);
  await fit(page);

  await openBindings(page);
  await page.getByTestId('binding-duplicate-0').click();
  await expect(page.getByTestId('binding-duplicate-0')).toContainText('Press a key or button');
  await page.keyboard.press('d');
  await expect(page.getByTestId('binding-duplicate-0')).toContainText('Hold D');
  await page.getByTestId('close-preferences').click();

  const node = (await page.locator(`.react-flow__node[data-id="${ENTITY}"]`).boundingBox())!;
  await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2);
  await page.keyboard.down('d');
  await page.mouse.move(node.x + node.width / 2 + 200, node.y + node.height / 2 + 100, {
    steps: 6,
  });
  await page.keyboard.up('d');

  await expect.poll(() => elementCount(page)).toBe(2);
});

test('a held key drives box select: press, move, release', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await fit(page);

  await openBindings(page);
  await page.getByTestId('binding-box-select-0').click();
  await page.keyboard.press('b');
  await expect(page.getByTestId('binding-box-select-0')).toContainText('Hold B');
  await page.getByTestId('close-preferences').click();

  const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
  await page.mouse.move(gateway.x - 25, gateway.y - 25);
  await page.keyboard.down('b');
  await page.mouse.move(gateway.x + gateway.width + 25, gateway.y + gateway.height + 25, {
    steps: 6,
  });
  await expect(page.getByTestId('box-select-preview')).toBeVisible();
  await page.keyboard.up('b');

  await expect(page.getByTestId('box-select-preview')).toHaveCount(0);
  await expect
    .poll(() => selection(page))
    .toEqual([IDS.gateway, IDS.authorise, IDS.post].sort());
});

test('a bare-left box replaces the selection, and shift on top adds', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await fit(page);

  await openBindings(page);
  await page.getByTestId('remove-pan-0').click();
  await page.getByTestId('binding-box-select-0').click();
  await page.mouse.click(8, 8);
  await expect(page.getByTestId('binding-box-select-0')).toContainText('Left drag');
  await page.getByTestId('close-preferences').click();

  await page.locator(`.react-flow__node[data-id="${IDS.ui}"]`).click();
  await expect.poll(() => selection(page)).toEqual([IDS.ui]);

  // The bare drag replaces: the prior selection goes.
  const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
  await page.mouse.move(gateway.x - 25, gateway.y - 25);
  await page.mouse.down();
  await page.mouse.move(gateway.x + gateway.width + 25, gateway.y + gateway.height + 25, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(() => selection(page))
    .toEqual([IDS.gateway, IDS.authorise, IDS.post].sort());

  // Shift on top of the binding adds instead.
  const ledger = (await page.getByTestId(`entity-${IDS.ledger}`).boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(ledger.x - 25, ledger.y - 25);
  await page.mouse.down();
  await page.mouse.move(ledger.x + ledger.width + 25, ledger.y + ledger.height + 25, {
    steps: 8,
  });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect
    .poll(() => selection(page))
    .toEqual([IDS.gateway, IDS.ledger, IDS.authorise, IDS.post].sort());
});

test('cancel clears the selection, and a click on the empty pane does too', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await fit(page);

  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await selection(page)).length).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toEqual([]);

  await page.locator(`.react-flow__node[data-id="${IDS.ui}"]`).click();
  await expect.poll(() => selection(page)).toEqual([IDS.ui]);
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.click(pane.x + 15, pane.y + pane.height - 15);
  await expect.poll(() => selection(page)).toEqual([]);
});

test('two actions on one combo are flagged in the panel', async ({ page }) => {
  await openBindings(page);
  await expect(page.locator('[data-duplicate]')).toHaveCount(0);

  await page.getByTestId('binding-undo-0').click();
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('binding-undo-0')).toHaveAttribute('data-duplicate', 'true');
  await expect(page.getByTestId('binding-redo-0')).toHaveAttribute('data-duplicate', 'true');
  await expect(page.getByTestId('binding-redo-1')).not.toHaveAttribute('data-duplicate', 'true');

  await page.getByTestId('reset-keybindings').click();
  await expect(page.locator('[data-duplicate]')).toHaveCount(0);
});

test('a drag released outside the panel keeps it open; a click begun outside closes it', async ({
  page,
}) => {
  await openBindings(page);
  const panel = (await page.getByTestId('preferences').boundingBox())!;

  await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2);
  await page.mouse.down();
  await page.mouse.move(8, 8, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('preferences')).toBeVisible();

  await page.mouse.click(8, 8);
  await expect(page.getByTestId('preferences')).toBeHidden();
});

test('begin+end box select runs between two presses of its key', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await fit(page);

  await openBindings(page);
  await page.getByTestId('mode-box-select-begin-end').click();
  await page.getByTestId('binding-box-select-0').click();
  await expect(page.getByTestId('binding-box-select-0')).toContainText('Press a key or button');
  await page.keyboard.press('b');
  await expect(page.getByTestId('binding-box-select-0')).toContainText('B');
  await page.getByTestId('close-preferences').click();

  const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
  const ledger = (await page.getByTestId(`entity-${IDS.ledger}`).boundingBox())!;
  await page.mouse.move(gateway.x - 25, gateway.y - 25);
  await page.keyboard.press('b');
  await page.mouse.move(ledger.x + ledger.width + 25, ledger.y + ledger.height + 25, {
    steps: 6,
  });
  await expect(page.getByTestId('box-select-preview')).toBeVisible();
  await page.keyboard.press('b');

  await expect(page.getByTestId('box-select-preview')).toHaveCount(0);
  await expect
    .poll(() => selection(page))
    .toEqual([IDS.gateway, IDS.ledger, IDS.authorise, IDS.post].sort());
});

test('begin+end duplicate drops the copy where the run ends', async ({ page }) => {
  await dispatch(page, [createEntity()]);
  await fit(page);

  await openBindings(page);
  await page.getByTestId('mode-duplicate-begin-end').click();
  await page.getByTestId('binding-duplicate-0').click();
  await page.keyboard.press('d');
  await expect(page.getByTestId('binding-duplicate-0')).toContainText('D');
  await page.getByTestId('close-preferences').click();

  const node = (await page.locator(`.react-flow__node[data-id="${ENTITY}"]`).boundingBox())!;
  await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2);
  await page.keyboard.press('d');
  await page.mouse.move(node.x + node.width / 2 + 200, node.y + node.height / 2 + 100, {
    steps: 6,
  });
  await page.keyboard.press('d');

  await expect.poll(() => elementCount(page)).toBe(2);
});

test('the cancel binding is rebindable, and abandons a run in flight', async ({ page }) => {
  await dispatch(page, sampleDomain());
  await fit(page);

  await openBindings(page);
  await page.getByTestId('mode-box-select-begin-end').click();
  await page.getByTestId('binding-box-select-0').click();
  await page.keyboard.press('b');
  await page.getByTestId('binding-cancel-0').click();
  await page.keyboard.press('q');
  await expect(page.getByTestId('binding-cancel-0')).toContainText('Q');
  await page.getByTestId('close-preferences').click();

  const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
  await page.mouse.move(gateway.x - 25, gateway.y - 25);
  await page.keyboard.press('b');
  await page.mouse.move(gateway.x + gateway.width + 25, gateway.y + gateway.height + 25, {
    steps: 4,
  });
  await expect(page.getByTestId('box-select-preview')).toBeVisible();

  await page.keyboard.press('q');
  await expect(page.getByTestId('box-select-preview')).toHaveCount(0);
  await expect.poll(() => selection(page)).toEqual([]);
});

test('the search binding follows the reader, and never reaches the document or the trace', async ({
  page,
}) => {
  await openBindings(page);
  await page.getByTestId('binding-search-0').click();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('binding-search-0')).toContainText('Ctrl+K');
  await page.getByTestId('close-preferences').click();

  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('search-input')).toBeVisible();

  expect((await getTrace(page)).length).toBe(0);
  expect(await page.evaluate(() => window.__modl.serialize())).not.toContain('binding');
});
