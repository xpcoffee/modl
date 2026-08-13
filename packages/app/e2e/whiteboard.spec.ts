import { expect, test } from '@playwright/test';
import {
  dispatch,
  fit,
  getDocument,
  getTrace,
  IDS,
  open,
  openSearch,
  queueOpenFile,
  sampleDomain,
  savedFile,
  savePrompts,
  serialize,
  setFilter,
  setNextSaveName,
} from './support.js';

test.beforeEach(async ({ page }) => {
  await open(page);
});

test.describe('rendering', () => {
  test('draws one node per entity and one edge per connection', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  });

  test('shows entity titles from the document', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await expect(page.getByTestId(`entity-${IDS.ui}`)).toContainText('Checkout UI');
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toContainText('Payment gateway');
  });

  test('positions nodes where the layout says', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const document = await getDocument(page);

    expect(document.layout[IDS.gateway]).toMatchObject({ x: 280, y: 0 });
  });
});

test.describe('direct manipulation', () => {
  test('the toolbar places an entity', async ({ page }) => {
    await page.getByTestId('add-element').click();
    await page.getByTestId('add-type-component').click();
    await page.locator('.react-flow__pane').click({ position: { x: 200, y: 200 } });

    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    const trace = await getTrace(page);
    expect(trace.filter((entry) => entry.command.type === 'create-entity')).toHaveLength(1);
  });

  test('dragging a node records exactly one move-element, on drop', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const node = page.getByTestId(`entity-${IDS.ui}`);

    await node.hover();
    await page.mouse.down();
    await page.mouse.move(400, 400, { steps: 10 });
    await page.mouse.up();

    const moves = (await getTrace(page)).filter((entry) => entry.command.type === 'move-element');
    expect(moves).toHaveLength(1);
  });

  test('a node follows the pointer during a drag', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const node = page.locator(`.react-flow__node[data-id="${IDS.ui}"]`);
    const before = await node.boundingBox();

    await node.hover();
    await page.mouse.down();
    await page.mouse.move(500, 450, { steps: 10 });

    // Still mid-drag: the node has moved on screen before any command fires.
    const during = await node.boundingBox();
    expect(during?.x).not.toBe(before?.x);
    const trace = await getTrace(page);
    expect(trace.filter((entry) => entry.command.type === 'move-element')).toHaveLength(0);

    await page.mouse.up();
    const after = await getTrace(page);
    expect(after.filter((entry) => entry.command.type === 'move-element')).toHaveLength(1);
  });

  test('dragging a multi-selection moves every selected node', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.locator(`.react-flow__node[data-id="${IDS.ui}"]`).click();
    await page.locator(`.react-flow__node[data-id="${IDS.gateway}"]`).click({
      modifiers: ['ControlOrMeta'],
    });
    await expect
      .poll(() => page.evaluate(() => window.__modl.getState().selection.length))
      .toBe(2);

    const before = await getDocument(page);
    await page.locator(`.react-flow__node[data-id="${IDS.ui}"]`).hover();
    await page.mouse.down();
    await page.mouse.move(420, 520, { steps: 10 });
    await page.mouse.up();

    const after = await getDocument(page);
    for (const id of [IDS.ui, IDS.gateway]) {
      expect(after.layout[id]).not.toEqual(before.layout[id]);
    }
  });

  test('a new connection takes the paradigm of its target', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-element-type', id: IDS.ledger, elementType: 'state' },
    ]);

    await page.evaluate(
      ([from, to]) =>
        window.__modl.dispatch({
          type: 'create-connection',
          id: '66666666-6666-4666-8666-666666666666',
          connectionType: 'transition',
          from: [from!],
          to: [to!],
          title: '',
        }),
      [IDS.ui, IDS.ledger],
    );

    const document = await getDocument(page);
    expect(document.model.elements['66666666-6666-4666-8666-666666666666']).toMatchObject({
      type: 'transition',
    });
  });

  test('deleting a selected node cascades to its connections', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId('delete-selected').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]).toBeUndefined();
    // The authorise connection lost its only source, so it went too.
    expect(document.model.elements[IDS.authorise]).toBeUndefined();
    expect(document.model.elements[IDS.post]).toBeDefined();
  });
});

test.describe('double click', () => {
  test('on empty canvas creates a component', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.locator('.react-flow__pane').dblclick({ position: { x: 120, y: 560 } });

    const document = await getDocument(page);
    expect(Object.values(document.model.elements).filter((e) => e.kind === 'entity')).toHaveLength(4);
  });

  test('on empty canvas does not zoom', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = await page.evaluate(() => window.__modl.getState().document.view.zoom);

    await page.locator('.react-flow__pane').dblclick({ position: { x: 120, y: 560 } });

    const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
    expect(viewport).toContain('scale(' + String(before));
  });

  test('on a component renames it instead of creating another', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`entity-${IDS.ui}`).dblclick();

    const rename = page.getByTestId(`rename-${IDS.ui}`);
    await expect(rename).toBeVisible();
    await rename.fill('Renamed inline');
    await rename.press('Enter');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.title).toBe('Renamed inline');
    expect(Object.values(document.model.elements).filter((e) => e.kind === 'entity')).toHaveLength(3);
  });

  test('on a connection renames it', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`connection-${IDS.authorise}`).dblclick();

    const rename = page.getByTestId(`rename-${IDS.authorise}`);
    await expect(rename).toBeVisible();
    await rename.fill('captures funds');
    await rename.press('Enter');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.authorise]?.title).toBe('captures funds');
  });

  test('Escape discards a rename', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`entity-${IDS.ui}`).dblclick();
    await page.getByTestId(`rename-${IDS.ui}`).fill('Discarded');
    await page.getByTestId(`rename-${IDS.ui}`).press('Escape');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.title).toBe('Checkout UI');
  });
});

test.describe('delete keys', () => {
  for (const key of ['Delete', 'Backspace']) {
    test(`${key} removes the selected element`, async ({ page }) => {
      await dispatch(page, sampleDomain());
      await fit(page);
      await page.getByTestId(`entity-${IDS.ledger}`).click();

      await page.keyboard.press(key);

      const document = await getDocument(page);
      expect(document.model.elements[IDS.ledger]).toBeUndefined();
    });
  }
});

test.describe('hover', () => {
  test('shows the description rather than the readable name', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-metadata', id: IDS.ui, description: 'Browser-side checkout flow.' },
    ]);

    const node = page.getByTestId(`entity-${IDS.ui}`);
    await node.hover();

    await expect(node.getByTestId('hover-description')).toContainText('Browser-side checkout flow.');
  });

  test('leaves out the description line when there is none', async ({ page }) => {
    await dispatch(page, sampleDomain());

    const node = page.getByTestId(`entity-${IDS.gateway}`);
    await node.hover();

    // Scoped to this element: every node carries its own hover card.
    await expect(node.getByTestId('hover-type')).toBeVisible();
    await expect(node.getByTestId('hover-description')).toHaveCount(0);
  });

  test('shows a permanent type icon on an entity', async ({ page }) => {
    await dispatch(page, sampleDomain());

    // Permanently visible, so no hover first.
    const icon = page.locator(`[data-testid="entity-${IDS.ui}"] svg[data-icon]`);
    await expect(icon).toHaveAttribute('data-icon', 'component');
  });

  test('shows a permanent type icon on a connection', async ({ page }) => {
    await dispatch(page, sampleDomain());

    const icon = page.locator(`[data-testid="connection-${IDS.authorise}"] svg[data-icon]`);
    await expect(icon).toHaveAttribute('data-icon', 'interaction');
  });

  test('the icon follows the type', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-element-type', id: IDS.ui, elementType: 'step' },
    ]);

    const icon = page.locator(`[data-testid="entity-${IDS.ui}"] svg[data-icon]`);
    await expect(icon).toHaveAttribute('data-icon', 'step');
  });
});

test.describe('groups', () => {
  const GROUP = '77777777-7777-4777-8777-777777777777';

  async function groupPaymentsSide(page: import('@playwright/test').Page) {
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'group-elements',
        id: GROUP,
        title: 'Payments',
        memberIds: [IDS.gateway, IDS.ledger],
        position: { x: 280, y: 0 },
      },
    ]);
    await fit(page);
  }

  test('a collapsed group hides its members and shows a count', async ({ page }) => {
    await groupPaymentsSide(page);

    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toHaveCount(0);
    await expect(page.getByTestId(`entity-${GROUP}`)).toBeVisible();
    await expect(page.getByTestId(`expand-${GROUP}`)).toContainText('2');
  });

  test('a connection into a collapsed group re-points at the group', async ({ page }) => {
    await groupPaymentsSide(page);

    // authorise ran UI -> gateway, and gateway is now hidden inside the group.
    const edge = page.locator(`.react-flow__edge[data-testid="rf__edge-${IDS.authorise}:${IDS.ui}:${GROUP}"]`);
    await expect(edge).toHaveCount(1);
  });

  test('a connection wholly inside a collapsed group is not drawn', async ({ page }) => {
    await groupPaymentsSide(page);

    // post entry ran gateway -> ledger, both inside the group now.
    await expect(page.getByTestId(`connection-${IDS.post}`)).toHaveCount(0);
  });

  test('expanding shows the members inside a container', async ({ page }) => {
    await groupPaymentsSide(page);

    await page.getByTestId(`expand-${GROUP}`).click();

    await expect(page.getByTestId(`group-${GROUP}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toBeVisible();
    await expect(page.getByTestId(`connection-${IDS.post}`)).toBeVisible();
  });

  test('collapsing puts the members away again', async ({ page }) => {
    await groupPaymentsSide(page);
    await page.getByTestId(`expand-${GROUP}`).click();

    await page.getByTestId(`collapse-${GROUP}`).click();

    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toHaveCount(0);
    await expect(page.getByTestId(`entity-${GROUP}`)).toBeVisible();
  });

  test('the toolbar groups a selection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId(`entity-${IDS.ledger}`).click({ modifiers: ['ControlOrMeta'] });

    await page.getByTestId('group-selected').click();

    const document = await getDocument(page);
    const group = Object.values(document.model.elements).find((e) => e.title === 'New group');
    expect(group).toBeDefined();
    expect(document.model.elements[IDS.gateway]?.groupId).toBe(group?.id);
  });

  test('ungrouping lifts the members out', async ({ page }) => {
    await groupPaymentsSide(page);
    await page.getByTestId(`entity-${GROUP}`).click();

    await page.getByTestId('ungroup-selected').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.gateway]?.groupId).toBeNull();
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toBeVisible();
  });

  test('dragging a selected expanded group carries its members', async ({ page }) => {
    await groupPaymentsSide(page);
    await page.getByTestId(`expand-${GROUP}`).click();
    await fit(page);
    const before = await getDocument(page);

    // Grab the group header, away from any member inside it.
    await page.getByTestId(`collapse-${GROUP}`).hover();
    await page.mouse.move(0, 0);
    const header = await page.getByTestId(`group-${GROUP}`).boundingBox();
    const grab = { x: header!.x + header!.width - 30, y: header!.y + 12 };

    // A group only moves once selected, so click it first.
    await page.mouse.click(grab.x, grab.y);
    await expect
      .poll(() => page.evaluate(() => window.__modl.getState().selection))
      .toContain(GROUP);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 120, grab.y + 90, { steps: 12 });
    await page.mouse.up();

    const after = await getDocument(page);
    // Members moved with the container, so the group did not spring back.
    for (const id of [IDS.gateway, IDS.ledger]) {
      expect(after.layout[id]).not.toEqual(before.layout[id]);
    }
  });

  test('dragging an unselected expanded group pans the board instead of moving it', async ({
    page,
  }) => {
    await groupPaymentsSide(page);
    await page.getByTestId(`expand-${GROUP}`).click();
    // The expand click also selected the group; clear that so the drag under
    // test starts with nothing selected.
    await dispatch(page, [{ type: 'set-selection', ids: [] }]);
    await fit(page);
    const before = await getDocument(page);
    const boxBefore = await page.getByTestId(`group-${GROUP}`).boundingBox();

    // Same header grab as the move test, but with nothing selected.
    const header = await page.getByTestId(`group-${GROUP}`).boundingBox();
    await page.mouse.move(header!.x + header!.width - 30, header!.y + 12);
    await page.mouse.down();
    await page.mouse.move(header!.x + header!.width - 30 + 120, header!.y + 12 + 90, { steps: 12 });
    await page.mouse.up();

    // The document did not change: the drag was a pan.
    const after = await getDocument(page);
    expect(after.layout[GROUP]).toEqual(before.layout[GROUP]);
    const moves = (await getTrace(page)).filter((entry) => entry.command.type === 'move-element');
    expect(moves).toHaveLength(0);

    // The camera moved, so the group sits elsewhere on screen.
    const boxAfter = await page.getByTestId(`group-${GROUP}`).boundingBox();
    expect(boxAfter!.x).not.toBe(boxBefore!.x);

    // The pan gesture also did not select the group on release.
    const selection = await page.evaluate(() => window.__modl.getState().selection);
    expect(selection).toEqual([]);
  });

  test('clicking a group whose boundary is off screen leaves it unselected', async ({ page }) => {
    // A small window and a large container, so max zoom puts the whole view
    // inside the group.
    await page.setViewportSize({ width: 480, height: 360 });
    await groupPaymentsSide(page);
    // Grouping selected the group, whose box overflows this small window, so
    // its editor docks over the expand button. Deselect before clicking it.
    await dispatch(page, [{ type: 'set-selection', ids: [] }]);
    await page.getByTestId(`expand-${GROUP}`).click();
    await dispatch(page, [
      { type: 'resize-element', id: GROUP, width: 900, height: 700 },
      // The expand click also selected the group; the guard under test only
      // applies to an unselected one.
      { type: 'set-selection', ids: [] },
    ]);
    await fit(page);

    // Zoom towards the group's centre until its edges leave the view.
    const box = await page.getByTestId(`group-${GROUP}`).boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, -240);
    }
    await expect
      .poll(async () => {
        const zoomed = await page.getByTestId(`group-${GROUP}`).boundingBox();
        return (
          zoomed!.x < 0 &&
          zoomed!.y < 0 &&
          zoomed!.x + zoomed!.width > 480 &&
          zoomed!.y + zoomed!.height > 360
        );
      })
      .toBe(true);

    // The window centre now shows the group's background, with the members
    // off screen near its top-left corner.
    const hit = await page.evaluate(
      () =>
        document
          .elementFromPoint(240, 180)
          ?.closest<HTMLElement>('.react-flow__node')?.dataset['id'],
    );
    expect(hit).toBe(GROUP);

    await page.mouse.click(240, 180);

    const selection = await page.evaluate(() => window.__modl.getState().selection);
    expect(selection).toEqual([]);
  });

  test('dropping an element inside a container makes it a member', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId('group-selected').click();
    await fit(page);

    const group = Object.keys((await getDocument(page)).model.elements).find(
      (id) => ![IDS.ui, IDS.gateway, IDS.ledger, IDS.authorise, IDS.post].includes(id as never),
    );
    expect(group).toBeDefined();

    const box = await page.getByTestId(`group-${group}`).boundingBox();
    const node = page.locator(`.react-flow__node[data-id="${IDS.ui}"]`);
    await node.hover();
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.groupId).toBe(group);
  });

  test('dragging a member out of a container removes it', async ({ page }) => {
    await groupPaymentsSide(page);
    await page.getByTestId(`expand-${GROUP}`).click();
    await fit(page);

    const node = page.locator(`.react-flow__node[data-id="${IDS.ledger}"]`);
    await node.hover();
    await page.mouse.down();
    await page.mouse.move(120, 660, { steps: 14 });
    await page.mouse.up();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ledger]?.groupId).toBeNull();
  });

  test('grouping a single element gives a container to drop into', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.getByTestId('group-selected').click();

    const document = await getDocument(page);
    const group = Object.values(document.model.elements).find((e) => e.title === 'New group');
    expect(group).toBeDefined();
    expect(document.model.elements[IDS.gateway]?.groupId).toBe(group?.id);
    // Opens expanded, so there is a box on screen.
    await expect(page.getByTestId(`group-${group?.id}`)).toBeVisible();
  });

  test('an empty container stays an ordinary entity once collapsed', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId('canvas').click({ position: { x: 40, y: 600 } });

    await page.getByTestId('group-selected').click();
    const group = Object.values((await getDocument(page)).model.elements).find(
      (e) => e.title === 'New group',
    );
    expect(group).toBeDefined();

    await page.getByTestId(`collapse-${group?.id}`).click();

    // No members joined it, so it draws as a plain entity with no expand badge.
    await expect(page.getByTestId(`entity-${group?.id}`)).toBeVisible();
    await expect(page.getByTestId(`expand-${group?.id}`)).toHaveCount(0);
  });

  test('a grouped document round trips through save and load', async ({ page }) => {
    await groupPaymentsSide(page);
    const saved = await serialize(page);

    await page.getByTestId('file-input').setInputFiles({
      name: 'grouped.modl.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });

    await expect(page.getByTestId('toolbar-message')).toContainText('Loaded');
    expect(await serialize(page)).toBe(saved);
  });
});

test.describe('in-situ editor', () => {
  test('appears on the element when it is selected', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await expect(page.getByTestId(`editor-${IDS.ui}`)).toHaveCount(0);
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await expect(page.getByTestId(`editor-${IDS.ui}`)).toBeVisible();
  });

  test('edits the description in place', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId(`editor-description-${IDS.ui}`).fill('Browser-side flow.');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.description).toBe('Browser-side flow.');
  });

  test('changes the type by clicking the icon', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId(`editor-type-${IDS.ui}`).click();
    await page.getByTestId(`editor-type-${IDS.ui}-state`).click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]).toMatchObject({ type: 'state' });
  });

  test('offers connection types on a connection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await page.getByTestId(`editor-type-${IDS.authorise}`).click();

    await expect(page.getByTestId(`editor-type-${IDS.authorise}-transition`)).toBeVisible();
    await expect(page.getByTestId(`editor-type-${IDS.authorise}-component`)).toHaveCount(0);
  });

  test('adds a tag from the chip row', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId(`editor-add-tag-${IDS.ui}`).click();
    await page.getByTestId(`editor-new-tag-${IDS.ui}`).fill('tier');
    await page.getByTestId(`editor-new-tag-${IDS.ui}`).press('Enter');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags).toMatchObject({ tier: [] });
  });

  test('typing a new tag keeps focus through the key, the tab, and the value', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId(`editor-add-tag-${IDS.ui}`).click();

    const key = page.getByTestId(`editor-new-tag-${IDS.ui}`);
    await key.pressSequentially('tier');
    await expect(key).toBeFocused();

    await key.press('Tab');
    const value = page.getByTestId(`editor-new-tag-value-${IDS.ui}`);
    await expect(value).toBeFocused();
    await value.pressSequentially('gold, silver');
    await expect(value).toBeFocused();
    await value.press('Enter');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags['tier']).toEqual(['gold', 'silver']);
  });

  test('renaming a key and tabbing into the value keeps focus in the row', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    const key = page.getByLabel('Tag key team');
    await key.fill('squad');
    await key.press('Tab');

    const value = page.getByLabel('Tag value for team');
    await expect(value).toBeFocused();
    await value.press('End');
    await value.pressSequentially(', platform');
    await expect(value).toBeFocused();
    // The rename holds until the reader finishes with the whole chip.
    await page.getByTestId(`editor-description-${IDS.ui}`).click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags).toEqual({ squad: ['web', 'platform'] });
  });

  test('typing a comma-separated value into an existing tag is not interrupted', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    const value = page.getByLabel('Tag value for team');
    await value.click();
    await value.press('End');
    await value.pressSequentially(', platform');

    await expect(value).toBeFocused();
    await expect(value).toHaveValue('web, platform');
    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags['team']).toEqual(['web', 'platform']);
  });

  test('edits a tag value in place', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByLabel('Tag value for team').fill('platform');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags['team']).toEqual(['platform']);
  });

  test('renames a tag key as one command', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByLabel('Tag key team').fill('squad');
    await page.getByTestId(`editor-description-${IDS.ui}`).click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags).toEqual({ squad: ['web'] });

    const renames = (await getTrace(page)).filter((e) => e.command.type === 'rename-tag');
    expect(renames).toHaveLength(1);
  });

  test('removes a tag', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByLabel('Remove tag team').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags['team']).toBeUndefined();
  });
});

test.describe('filtering', () => {
  test('dims elements that do not match', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await setFilter(page, 'team=payments');

    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId('element-count')).toContainText('2 of 5');
  });

  test('removing the filter restores every element', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setFilter(page, 'team=web');

    await openSearch(page);
    await page.getByTestId('filter-remove-0').click();

    await expect(page.getByTestId('element-count')).toContainText('5 elements');
  });

  test('a collapsed group holding a match stays readable and counts it', async ({ page }) => {
    const GROUP = '88888888-8888-4888-8888-888888888888';
    // Built with set-group rather than group-elements, which selects the new
    // group and would hand emphasis to the selection highlight.
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'create-entity',
        id: GROUP,
        entityType: 'component',
        title: 'Backoffice',
        position: { x: 560, y: 220 },
      },
      { type: 'set-group', id: IDS.ledger, groupId: GROUP },
    ]);

    await setFilter(page, 'team=payments');

    // The filter opened the group to show the match (issue #77); collapse it
    // by hand, which the filter respects until its next commit.
    await page.getByTestId(`collapse-${GROUP}`).click();
    // The click also selected the group; drop the selection so the filter
    // keeps deciding emphasis.
    await dispatch(page, [{ type: 'set-selection', ids: [] }]);

    // The ledger matches inside the collapsed group: the group stays readable
    // and shows the count, while the unrelated UI mutes.
    await expect(page.getByTestId(`entity-${GROUP}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`match-count-${GROUP}`)).toHaveText('1');
    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveClass(/is-dimmed/);

    await page.getByTestId(`expand-${GROUP}`).click();
    await dispatch(page, [{ type: 'set-selection', ids: [] }]);

    await expect(page.getByTestId(`entity-${IDS.ledger}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`match-count-${GROUP}`)).toHaveCount(0);
  });

  test('focus mode removes non-matches from the board and the minimap', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const saved = await serialize(page);
    await setFilter(page, 'team=payments');

    await page.getByTestId('focus-toggle').click();

    await expect(page.getByTestId('focus-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveCount(0);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toBeVisible();
    // The line into the removed UI goes with it; the one between the two
    // matches stays drawn.
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(page.locator('.react-flow__minimap-node')).toHaveCount(2);
    // A transient view: the saved document is untouched.
    expect(await serialize(page)).toBe(saved);

    await page.getByTestId('focus-toggle').click();

    await expect(page.getByTestId(`entity-${IDS.ui}`)).toBeVisible();
    await expect(page.locator('.react-flow__minimap-node')).toHaveCount(3);
    expect(await serialize(page)).toBe(saved);
  });

  test('clearing the filter in focus mode brings everything back', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setFilter(page, 'team=payments');
    await page.getByTestId('focus-toggle').click();
    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveCount(0);

    await setFilter(page, '');

    // The mode stays on and keeps the board compacted, ready for the next
    // filter.
    await expect(page.getByTestId(`entity-${IDS.ui}`)).toBeVisible();
    await expect(page.getByTestId('focus-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
  });

  test('focus mode compacts the visible elements and puts them back exactly', async ({ page }) => {
    await dispatch(page, sampleDomain());
    // Spread the two matches far apart, so the compaction is measurable.
    await dispatch(page, [
      { type: 'move-element', id: IDS.ledger, position: { x: 1200, y: 400 } },
    ]);
    const saved = await serialize(page);

    /** Where a node is drawn, read from its transform. */
    const drawn = (id: string) =>
      page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((node) => {
        const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(
          (node as HTMLElement).style.transform,
        );
        return { x: Number(match?.[1]), y: Number(match?.[2]) };
      });

    await setFilter(page, 'team=payments');
    await page.getByTestId('focus-toggle').click();

    await expect(page.getByTestId('canvas')).toHaveAttribute('data-focus-overlaid', 'true');
    // The two matches close up over the space the hidden UI left: they sat
    // just over 1000 flow pixels apart.
    await expect
      .poll(async () => {
        const gateway = await drawn(IDS.gateway);
        const ledger = await drawn(IDS.ledger);
        return Math.hypot(ledger.x - gateway.x, ledger.y - gateway.y);
      })
      .toBeLessThan(500);
    // The gateway read first before the compaction, and still reads first.
    const gateway = await drawn(IDS.gateway);
    const ledger = await drawn(IDS.ledger);
    expect(ledger.y > gateway.y || (ledger.y === gateway.y && ledger.x > gateway.x)).toBe(true);
    // A transient view: the saved geometry is untouched.
    expect(await serialize(page)).toBe(saved);

    await page.getByTestId('focus-toggle').click();

    await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-focus-overlaid');
    await expect.poll(() => drawn(IDS.ledger)).toEqual({ x: 1200, y: 400 });
    await expect.poll(() => drawn(IDS.gateway)).toEqual({ x: 280, y: 0 });
    expect(await serialize(page)).toBe(saved);

    // The toggles added nothing to the history: one undo reaches straight
    // past them to the move that spread the ledger out.
    await dispatch(page, [{ type: 'undo' }]);
    const document = await getDocument(page);
    expect(document.layout[IDS.ledger]).toMatchObject({ x: 560, y: 0 });
  });

  test('collapsing a group in focus mode closes the space, and expanding opens it again', async ({ page }) => {
    const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ARCHIVE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'create-entity', id: GROUP, entityType: 'component', title: 'Backoffice', position: { x: 900, y: 0 } },
      { type: 'set-group', id: IDS.ledger, groupId: GROUP },
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'create-entity', id: ARCHIVE, entityType: 'component', title: 'Archive', position: { x: 2400, y: 0 } },
    ]);
    const saved = await serialize(page);

    /** Where a node is drawn, read from its transform. */
    const drawn = (id: string) =>
      page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((node) => {
        const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(
          (node as HTMLElement).style.transform,
        );
        return { x: Number(match?.[1]), y: Number(match?.[2]) };
      });
    const gap = async () => {
      const group = await drawn(GROUP);
      const archive = await drawn(ARCHIVE);
      return Math.hypot(archive.x - group.x, archive.y - group.y);
    };

    await page.getByTestId('focus-toggle').click();
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-focus-overlaid', 'true');
    const openGap = await gap();
    const openArchive = await drawn(ARCHIVE);

    await dispatch(page, [{ type: 'set-expanded', id: GROUP, expanded: false }]);

    // The archive moves into the space the group's open footprint held.
    await expect.poll(gap).toBeLessThan(openGap);
    // A transient view: the saved geometry is untouched.
    expect(await serialize(page)).toBe(saved);

    await dispatch(page, [{ type: 'set-expanded', id: GROUP, expanded: true }]);

    await expect.poll(() => drawn(ARCHIVE)).toEqual(openArchive);

    await page.getByTestId('focus-toggle').click();

    await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-focus-overlaid');
    await expect.poll(() => drawn(ARCHIVE)).toEqual({ x: 2400, y: 0 });
    expect(await serialize(page)).toBe(saved);
  });

  test('a filter opens the groups above a match, and clearing folds them back', async ({ page }) => {
    const INNER = '88888888-8888-4888-8888-888888888888';
    const OUTER = '99999999-9999-4999-8999-999999999999';
    // Built with set-group rather than group-elements, which selects the new
    // group and would hand emphasis to the selection highlight.
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'create-entity', id: INNER, entityType: 'component', title: 'Vault', position: { x: 560, y: 220 } },
      { type: 'create-entity', id: OUTER, entityType: 'component', title: 'Backoffice', position: { x: 560, y: 440 } },
      { type: 'set-group', id: IDS.ledger, groupId: INNER },
      { type: 'set-group', id: INNER, groupId: OUTER },
    ]);
    await fit(page);

    // The ledger sits two collapsed levels deep, so it starts off the board.
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveCount(0);

    await setFilter(page, '"Ledger"');
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toBeVisible();

    await setFilter(page, '');
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveCount(0);
    await expect(page.getByTestId(`entity-${OUTER}`)).toBeVisible();
  });
});

test.describe('search menu', () => {
  test('Ctrl+F opens the bar and Escape closes it', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await expect(page.getByTestId('search-open')).toBeVisible();
    await openSearch(page);
    await expect(page.getByTestId('search-open')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-bar')).toHaveCount(0);
    await expect(page.getByTestId('search-open')).toBeVisible();
  });

  test('the button opens the bar too', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId('search-open').click();

    await expect(page.getByTestId('search-input')).toBeVisible();
  });

  test('clicking off the menu closes it', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.locator('.react-flow__pane').click({ position: { x: 40, y: 300 } });

    await expect(page.getByTestId('search-bar')).toHaveCount(0);
  });

  test('typing narrows the board without committing a filter', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.getByTestId('search-input').fill('ent');

    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);
    // The preview is not the filter: nothing has been applied yet.
    expect(await page.evaluate(() => window.__modl.getState().filter)).toBe('');
  });

  test('closing the menu drops the preview', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);
    await page.getByTestId('search-input').fill('ent');
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);

    await page.keyboard.press('Escape');

    await expect(page.getByTestId(`entity-${IDS.ledger}`)).not.toHaveClass(/is-dimmed/);
  });

  test('the first option makes the narrowing permanent', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);
    await page.getByTestId('search-input').fill('ent');

    const options = page.getByTestId('search-options').getByRole('button');
    await expect(options.first()).toHaveAttribute('data-testid', 'search-text-ent');

    await options.first().click();

    expect(await page.evaluate(() => window.__modl.getState().filter)).toBe('"ent"');
    await expect(page.getByTestId('filter-chip-0')).toContainText('"ent"');
    await expect(page.getByTestId('element-count')).toContainText('2 of 5');
  });

  test('Enter takes the active option', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.getByTestId('search-input').fill('ent');
    await page.keyboard.press('Enter');

    expect(await page.evaluate(() => window.__modl.getState().filter)).toBe('"ent"');
  });

  test('the arrow keys cycle the options', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);
    await page.getByTestId('search-input').fill('ent');

    const options = page.getByTestId('search-options').getByRole('button');
    await expect(options.first()).toHaveClass(/is-active/);

    await page.keyboard.press('ArrowDown');

    await expect(options.first()).not.toHaveClass(/is-active/);
    await expect(options.nth(1)).toHaveClass(/is-active/);
  });

  test('one match leaves only the element to go to', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.getByTestId('search-input').fill('ledger');

    const options = page.getByTestId('search-options').getByRole('button');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAttribute(
      'data-testid',
      `search-element-${IDS.ledger}`,
    );
  });

  test('choosing an element selects it and moves the camera', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);
    await page.getByTestId('search-input').fill('ledger');

    await page.getByTestId(`search-element-${IDS.ledger}`).click();

    await expect
      .poll(() => page.evaluate(() => window.__modl.getState().selection))
      .toEqual([IDS.ledger]);
    const trace = await getTrace(page);
    expect(trace.some((entry) => entry.command.type === 'set-view')).toBe(true);
    // Going somewhere is the end of the search.
    await expect(page.getByTestId('search-bar')).toHaveCount(0);
  });

  test('finds an element by scattered characters', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.getByTestId('search-input').fill('chkui');

    await expect(page.getByTestId(`search-element-${IDS.ui}`)).toBeVisible();
  });

  test('offers the tag filters as well as the text one', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.getByTestId('search-input').fill('team');

    await expect(page.getByTestId('search-tag-team-payments')).toBeVisible();
  });

  test('the closed button counts the active filters', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setFilter(page, 'team=web "ent"');

    await expect(page.getByTestId('filter-count')).toContainText('2');
  });

  test('a chip edits its filter, and the change lands at once', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setFilter(page, 'team=web');
    await openSearch(page);

    await page.getByTestId('filter-chip-0').click();
    await page.getByTestId('search-input').fill('team=pay');
    await page.getByTestId('search-tag-team-payments').click();

    expect(await page.evaluate(() => window.__modl.getState().filter)).toBe('team=payments');
    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveClass(/is-dimmed/);
  });

  test('the editor offers filters and never elements', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setFilter(page, 'team=web');
    await openSearch(page);

    await page.getByTestId('filter-chip-0').click();
    await page.getByTestId('search-input').fill('ledger');

    await expect(page.getByTestId(`search-element-${IDS.ledger}`)).toHaveCount(0);
  });

  test('emptying a filter removes it', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setFilter(page, 'team=web');
    await openSearch(page);

    await page.getByTestId('filter-chip-0').click();
    await page.getByTestId('search-input').fill('');

    expect(await page.evaluate(() => window.__modl.getState().filter)).toBe('');
    await expect(page.getByTestId('active-filters')).toHaveCount(0);
  });

  test('several filters stack up, and each one is its own chip', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.getByTestId('search-input').fill('ent');
    await page.keyboard.press('Enter');
    await page.getByTestId('search-input').fill('team');
    await page.getByTestId('search-tag-team').click();

    expect(await page.evaluate(() => window.__modl.getState().filter)).toBe('"ent" team');
    await expect(page.getByTestId('filter-chip-0')).toContainText('"ent"');
    await expect(page.getByTestId('filter-chip-1')).toContainText('team');
  });

  test('five filters is the limit', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setFilter(page, 'one two three four five');
    await openSearch(page);

    await page.getByTestId('search-input').fill('ent');

    await expect(page.getByTestId('filter-cap')).toBeVisible();
    // Only the elements are left to choose from.
    await expect(page.getByTestId('search-text-ent')).toHaveCount(0);
    await expect(page.getByTestId(`search-element-${IDS.gateway}`)).toBeVisible();
  });

  test('the filter travels through the command bus', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.getByTestId('search-input').fill('ent');
    await page.keyboard.press('Enter');

    const trace = await getTrace(page);
    expect(
      trace.some(
        (entry) => entry.command.type === 'set-filter' && entry.command.expression === '"ent"',
      ),
    ).toBe(true);
  });

  test('a preview leaves nothing in the trace', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await openSearch(page);

    await page.getByTestId('search-input').fill('ent');
    await page.keyboard.press('Escape');

    const trace = await getTrace(page);
    expect(trace.some((entry) => entry.command.type === 'set-filter')).toBe(false);
  });
});

test.describe('save and load', () => {
  test('saves the document the store holds', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId('save').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved');

    expect(await savedFile(page, 'Untitled domain.modl.json')).toBe(await serialize(page));
  });

  test('saving again writes to the same file with no second dialog', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId('save').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved');

    await dispatch(page, [{ type: 'set-metadata', id: IDS.ui, title: 'Checkout web' }]);
    await page.getByTestId('save').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved');

    expect(await savePrompts(page)).toBe(1);
    expect(await savedFile(page, 'Untitled domain.modl.json')).toBe(await serialize(page));
  });

  test('save-as asks again and moves the remembered file', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setNextSaveName(page, 'first.modl.json');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved first.modl.json');

    await setNextSaveName(page, 'second.modl.json');
    await page.getByTestId('save-as').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved second.modl.json');

    await page.getByTestId('save').click();
    expect(await savePrompts(page)).toBe(2);
    expect(await savedFile(page, 'second.modl.json')).toBe(await serialize(page));
  });

  test('loading through the picker remembers the file for save', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const saved = await serialize(page);
    await queueOpenFile(page, 'payments.modl.json', saved);

    await page.getByTestId('load').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Loaded payments.modl.json');

    await dispatch(page, [{ type: 'set-metadata', id: IDS.ui, title: 'Checkout web' }]);
    await page.getByTestId('save').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved payments.modl.json');

    expect(await savePrompts(page)).toBe(0);
    expect(await savedFile(page, 'payments.modl.json')).toBe(await serialize(page));
  });

  test('the toolbar and the tab carry the file name', async ({ page }) => {
    await expect(page).toHaveTitle('modl');
    await expect(page.getByTestId('file-name')).toHaveCount(0);

    await dispatch(page, sampleDomain());
    await setNextSaveName(page, 'payments.modl.json');
    await page.getByTestId('save').click();

    await expect(page.getByTestId('file-name')).toHaveText('payments');
    await expect(page.getByTestId('file-name')).toHaveAttribute('title', 'payments.modl.json');
    await expect(page).toHaveTitle('modl - payments');
  });

  test('ctrl+s saves and ctrl+shift+s asks for a new file', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await setNextSaveName(page, 'shortcut.modl.json');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved shortcut.modl.json');

    await setNextSaveName(page, 'renamed.modl.json');
    await page.keyboard.press('Control+Shift+s');
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved renamed.modl.json');

    expect(await savePrompts(page)).toBe(2);
    expect(await savedFile(page, 'renamed.modl.json')).toBe(await serialize(page));
  });

  test('the save buttons show pending, then a checkmark, then rest', async ({ page }) => {
    await dispatch(page, sampleDomain());

    // Each phase holds 300ms, short enough to slip between assertion polls,
    // so an observer records the sequence and the test reads it afterwards.
    const recorded = () =>
      page.evaluate(() => (window as unknown as { __phases?: string[] }).__phases ?? []);
    await page.evaluate(() => {
      const record: string[] = [];
      (window as unknown as { __phases: string[] }).__phases = record;
      const observer = new MutationObserver(() => {
        const phase = document
          .querySelector('[data-testid="save-feedback"]')
          ?.getAttribute('data-phase');
        if (phase && record[record.length - 1] !== phase) record.push(phase);
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-phase'],
      });
    });

    await page.getByTestId('save').click();
    await expect(page.getByTestId('save').getByTestId('save-feedback')).toHaveCount(1);
    await expect(page.getByTestId('save-feedback')).toHaveCount(0);
    expect(await recorded()).toEqual(['saving', 'saved']);

    await page.evaluate(() => {
      (window as unknown as { __phases: string[] }).__phases.length = 0;
    });
    await page.keyboard.press('Control+Shift+s');
    await expect(page.getByTestId('save-as').getByTestId('save-feedback')).toHaveCount(1);
    await expect(page.getByTestId('save-feedback')).toHaveCount(0);
    expect(await recorded()).toEqual(['saving', 'saved']);
  });

  test('without the pickers, save falls back to a download and remembers the name', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.evaluate(() => {
      delete window.showSaveFilePicker;
      delete window.showOpenFilePicker;
    });

    const [first] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('save').click(),
    ]);
    expect(first.suggestedFilename()).toBe('Untitled domain.modl.json');
    await expect(page).toHaveTitle('modl - Untitled domain');

    const stream = await first.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe(await serialize(page));

    const [second] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('save').click(),
    ]);
    expect(second.suggestedFilename()).toBe('Untitled domain.modl.json');
  });

  test('a canceled save dialog leaves the remembered file alone', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.evaluate(() => {
      window.showSaveFilePicker = async () => {
        throw new DOMException('canceled', 'AbortError');
      };
    });
    await page.getByTestId('save').click();

    await expect(page.getByTestId('file-name')).toHaveCount(0);
    await expect(page).toHaveTitle('modl');
  });

  test('loading a malformed file leaves the document alone', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = await serialize(page);

    await page.getByTestId('file-input').setInputFiles({
      name: 'broken.modl.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"formatVersion": 1, "nonsense": true}'),
    });

    await expect(page.getByTestId('toolbar-message')).toContainText('Could not load');
    expect(await serialize(page)).toBe(before);
  });

  test('a saved document loads back to the same bytes', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const saved = await serialize(page);

    await page.getByTestId('file-input').setInputFiles({
      name: 'domain.modl.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });

    await expect(page.getByTestId('toolbar-message')).toContainText('Loaded');
    expect(await serialize(page)).toBe(saved);
  });
});

test.describe('agent harness', () => {
  test('builds a domain through the runtime API and reads it back', async ({ page }) => {
    await dispatch(page, sampleDomain());

    const document = await getDocument(page);
    expect(Object.keys(document.model.elements)).toHaveLength(5);
    expect(document.model.elements[IDS.authorise]).toMatchObject({
      kind: 'connection',
      from: [IDS.ui],
      to: [IDS.gateway],
    });
  });

  test('a session trace replays to an identical document', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const expected = await serialize(page);
    const trace = await getTrace(page);

    // replay() starts from a fresh state itself, keeping the document identity.
    const result = await page.evaluate(
      (entries) => window.__modl.replay(entries),
      trace,
    );

    expect(result.divergences).toBe(0);
    expect(await serialize(page)).toBe(expected);
  });

  test('a rejected command is recorded and replays as a rejection', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'move-element', id: '99999999-9999-4999-8999-999999999999', position: { x: 0, y: 0 } },
    ]);

    const trace = await getTrace(page);
    const last = trace.at(-1);
    expect(last?.outcome).toBe('rejected');
    expect(last?.error?.code).toBe('unknown-element');

    const result = await page.evaluate(
      (entries) => window.__modl.replay(entries),
      trace,
    );
    expect(result.divergences).toBe(0);
  });
});

test.describe('selection actions', () => {
  test('delete sits with the selection rather than in the toolbar', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await expect(page.locator('.toolbar [data-testid="delete-selected"]')).toHaveCount(0);
    await expect(page.getByTestId('delete-selected')).toHaveCount(0);

    await page.getByTestId(`entity-${IDS.ui}`).click();
    await expect(page.getByTestId('delete-selected')).toBeVisible();
  });

  test('delete sits below the editor panel', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    const editor = (await page.getByTestId(`editor-${IDS.ui}`).boundingBox())!;
    const trash = (await page.getByTestId('delete-selected').boundingBox())!;

    // Inside the panel, at the bottom of it.
    expect(trash.y).toBeGreaterThan(editor.y);
    expect(trash.y + trash.height).toBeLessThanOrEqual(editor.y + editor.height + 1);
  });

  test('the multi-selection panel holds the dock through a drag', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId(`entity-${IDS.ledger}`).click({ modifiers: ['ControlOrMeta'] });

    // A multi-selection has no one element to anchor to, so its panel sits
    // at the dock and stays reachable while the elements move.
    const before = (await page.getByTestId('delete-selected').boundingBox())!;
    await page.locator(`.react-flow__node[data-id="${IDS.gateway}"]`).hover();
    await page.mouse.down();
    await page.mouse.move(300, 560, { steps: 12 });

    // Still mid-drag, before any command has fired.
    const during = (await page.getByTestId('delete-selected').boundingBox())!;
    expect(during.x).toBe(before.x);
    expect(during.y).toBe(before.y);
    await page.mouse.up();
  });

  test('deletes a single selection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    await page.getByTestId(`entity-${IDS.ledger}`).click();

    await page.getByTestId('delete-selected').click();

    expect((await getDocument(page)).model.elements[IDS.ledger]).toBeUndefined();
  });

  test('deletes a multi-selection and says how many', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId(`entity-${IDS.ledger}`).click({ modifiers: ['ControlOrMeta'] });

    await expect(page.getByTestId('delete-selected')).toHaveAttribute(
      'aria-label',
      'Delete 2 elements',
    );
    await page.getByTestId('delete-selected').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.gateway]).toBeUndefined();
    expect(document.model.elements[IDS.ledger]).toBeUndefined();
  });

  test('a multi-selection opens no element editor', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await expect(page.getByTestId(`editor-${IDS.gateway}`)).toBeVisible();

    await page.getByTestId(`entity-${IDS.ledger}`).click({ modifiers: ['ControlOrMeta'] });

    await expect(page.getByTestId(`editor-${IDS.gateway}`)).toHaveCount(0);
    await expect(page.getByTestId(`editor-${IDS.ledger}`)).toHaveCount(0);
  });
});

test.describe('creation', () => {
  test('a double-clicked component is centred on the pointer', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = new Set(Object.keys((await getDocument(page)).model.elements));

    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    const click = { x: 160, y: box.height - 90 };
    await pane.dblclick({ position: click });

    const created = Object.keys((await getDocument(page)).model.elements).find(
      (id) => !before.has(id),
    )!;

    // Compare on screen: the node's centre should be where the pointer was.
    const node = await page.locator(`.react-flow__node[data-id="${created}"]`).boundingBox();
    expect(Math.abs(node!.x + node!.width / 2 - (box.x + click.x))).toBeLessThan(2);
    expect(Math.abs(node!.y + node!.height / 2 - (box.y + click.y))).toBeLessThan(2);
  });
});

test.describe('connections', () => {
  test('reads forward by default, with a head at the target', async ({ page }) => {
    await dispatch(page, sampleDomain());

    expect((await getDocument(page)).model.elements[IDS.authorise]).toMatchObject({
      direction: 'forward',
    });
    await expect(
      page.locator(`.react-flow__edge[data-id^="${IDS.authorise}"] .react-flow__edge-path`),
    ).toHaveAttribute('marker-end', 'url(#modl-arrow-end)');
  });

  test('a two-way connection carries a head at each end', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await page.getByTestId(`editor-arrow-start-${IDS.authorise}`).click();

    expect((await getDocument(page)).model.elements[IDS.authorise]).toMatchObject({
      direction: 'both',
    });
    const path = page.locator(`.react-flow__edge[data-id^="${IDS.authorise}"] .react-flow__edge-path`);
    await expect(path).toHaveAttribute('marker-start', 'url(#modl-arrow-start)');
    await expect(path).toHaveAttribute('marker-end', 'url(#modl-arrow-end)');
  });

  test('an undirected connection carries no head at all', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await page.getByTestId(`editor-arrow-end-${IDS.authorise}`).click();

    const path = page.locator(`.react-flow__edge[data-id^="${IDS.authorise}"] .react-flow__edge-path`);
    await expect(path).not.toHaveAttribute('marker-end', 'url(#modl-arrow-end)');
  });

  test('a routed line keeps its curve', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-waypoints', id: IDS.authorise, waypoints: [{ x: 200, y: 120 }] },
    ]);

    const path = await page
      .locator(`.react-flow__edge[data-id^="${IDS.authorise}"] .react-flow__edge-path`)
      .getAttribute('d');

    // Cubic segments, so adding a bend does not turn the line into a polyline.
    expect(path).toContain('C');
    expect(path).not.toContain('L');
  });

  test('a waypoint reroutes the line', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await page.getByTestId(`waypoint-add-${IDS.authorise}-0`).click();

    const document = await getDocument(page);
    expect((document.layout[IDS.authorise] as { waypoints: unknown[] }).waypoints).toHaveLength(1);
    await expect(page.getByTestId(`waypoint-${IDS.authorise}-0`)).toBeVisible();
  });

  test('double-clicking a waypoint removes it', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-waypoints', id: IDS.authorise, waypoints: [{ x: 200, y: 120 }] },
    ]);
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await page.getByTestId(`waypoint-${IDS.authorise}-0`).dblclick();

    const document = await getDocument(page);
    expect((document.layout[IDS.authorise] as { waypoints: unknown[] }).waypoints).toHaveLength(0);
  });

  test('waypoints and direction survive save and load', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-waypoints', id: IDS.authorise, waypoints: [{ x: 200, y: 120 }] },
      { type: 'set-arrowheads', id: IDS.authorise, start: true, end: true },
    ]);
    const saved = await serialize(page);

    await page.getByTestId('file-input').setInputFiles({
      name: 'routed.modl.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });

    await expect(page.getByTestId('toolbar-message')).toContainText('Loaded');
    expect(await serialize(page)).toBe(saved);
  });
});

test.describe('entity sizing and creation type', () => {
  test('a long title stays clear of the top row', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'set-metadata',
        id: IDS.ui,
        title: 'A checkout component with a very long name indeed that wraps',
      },
    ]);

    const icon = (await page
      .locator(`[data-testid="entity-${IDS.ui}"] .entity-node__icon`)
      .boundingBox())!;
    const title = (await page
      .locator(`[data-testid="entity-${IDS.ui}"] .entity-node__title`)
      .boundingBox())!;

    // The title starts below the icon rather than running under it.
    expect(title.y).toBeGreaterThanOrEqual(icon.y + icon.height - 1);
  });

  test('an entity can be resized', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    await page.getByTestId(`entity-${IDS.ledger}`).click();

    const before = (await getDocument(page)).layout[IDS.ledger] as { width: number };
    const handle = page.locator(
      `.react-flow__node[data-id="${IDS.ledger}"] .react-flow__resize-control.bottom.right.handle`,
    );
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 60, { steps: 10 });
    await page.mouse.up();

    const after = (await getDocument(page)).layout[IDS.ledger] as { width: number };
    expect(after.width).toBeGreaterThan(before.width);
  });

  test('the picker places the type it was armed with', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = new Set(Object.keys((await getDocument(page)).model.elements));

    await page.getByTestId('add-element').click();
    await page.getByTestId('add-type-step').click();
    await expect(page.getByTestId('placement-hint')).toBeVisible();
    await page.locator('.react-flow__pane').click({ position: { x: 140, y: 500 } });

    const document = await getDocument(page);
    const created = Object.keys(document.model.elements).find((id) => !before.has(id))!;
    expect(document.model.elements[created]).toMatchObject({ type: 'step' });

    // Placing disarms the picker, so the next click does not put down another.
    await expect(page.getByTestId('placement-hint')).toHaveCount(0);
  });
});

test.describe('moving a collapsed group', () => {
  const GROUP = '88888888-8888-4888-8888-888888888888';

  test('carries its members, so expanding shows them in place', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'group-elements',
        id: GROUP,
        title: 'Payments',
        memberIds: [IDS.gateway, IDS.ledger],
        position: { x: 280, y: 0 },
      },
    ]);

    const before = await getDocument(page);
    const groupBefore = before.layout[GROUP] as { x: number; y: number };
    const memberBefore = before.layout[IDS.gateway] as { x: number; y: number };
    const offset = { x: memberBefore.x - groupBefore.x, y: memberBefore.y - groupBefore.y };

    // Collapsed: only the group is on the board.
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toHaveCount(0);
    await fit(page);
    await page.locator(`.react-flow__node[data-id="${GROUP}"]`).hover();
    await page.mouse.down();
    await page.mouse.move(260, 520, { steps: 12 });
    await page.mouse.up();

    const after = await getDocument(page);
    const groupAfter = after.layout[GROUP] as { x: number; y: number };
    const memberAfter = after.layout[IDS.gateway] as { x: number; y: number };

    expect(groupAfter.x).not.toBe(groupBefore.x);
    // The member kept its place inside the group rather than staying behind.
    expect(memberAfter.x - groupAfter.x).toBeCloseTo(offset.x, 5);
    expect(memberAfter.y - groupAfter.y).toBeCloseTo(offset.y, 5);
  });
});

test.describe('collapsed and expanded sizes', () => {
  const GROUP = '99999999-9999-4999-8999-999999999999';

  async function grouped(page: import('@playwright/test').Page) {
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'group-elements',
        id: GROUP,
        title: 'Payments',
        memberIds: [IDS.gateway, IDS.ledger],
        position: { x: 280, y: 0 },
      },
    ]);
    await fit(page);
  }

  test('a new group collapses to a node, not to its container box', async ({ page }) => {
    await grouped(page);

    const layout = (await getDocument(page)).layout[GROUP] as {
      width: number;
      expanded: { width: number };
    };
    expect(layout.width).toBe(180);
    expect(layout.expanded.width).toBeGreaterThan(400);

    // On screen it is node-sized while collapsed.
    const node = (await page.locator(`.react-flow__node[data-id="${GROUP}"]`).boundingBox())!;
    const other = (await page.locator(`.react-flow__node[data-id="${IDS.ui}"]`).boundingBox())!;
    expect(Math.abs(node.width - other.width)).toBeLessThan(2);
  });

  test('resizing the container leaves the collapsed node alone', async ({ page }) => {
    await grouped(page);
    await page.getByTestId(`expand-${GROUP}`).click();
    await fit(page);
    // group-elements already left it selected, so the resizer is showing.

    const handle = page.locator(
      `.react-flow__node[data-id="${GROUP}"] .react-flow__resize-control.bottom.right.handle`,
    );
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 70, { steps: 10 });
    await page.mouse.up();

    const layout = (await getDocument(page)).layout[GROUP] as {
      width: number;
      height: number;
      expanded: { width: number };
    };
    expect(layout.expanded.width).toBeGreaterThan(400);
    expect(layout.width).toBe(180);
    expect(layout.height).toBe(72);
  });

  test('resizing the collapsed node leaves the container alone', async ({ page }) => {
    await grouped(page);
    const before = (await getDocument(page)).layout[GROUP] as { expanded: { width: number } };

    await page.getByTestId(`entity-${GROUP}`).click();
    const handle = page.locator(
      `.react-flow__node[data-id="${GROUP}"] .react-flow__resize-control.bottom.right.handle`,
    );
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 50, { steps: 10 });
    await page.mouse.up();

    const after = (await getDocument(page)).layout[GROUP] as {
      width: number;
      expanded: { width: number };
    };
    expect(after.width).toBeGreaterThan(180);
    expect(after.expanded.width).toBe(before.expanded.width);
  });
});

test.describe('first element', () => {
  test('appears under the pointer without reframing the board', async ({ page }) => {
    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    const viewportBefore = await page.locator('.react-flow__viewport').getAttribute('style');

    // The very first double-click, on an empty board.
    const click = { x: 300, y: 200 };
    await pane.dblclick({ position: click });

    const viewportAfter = await page.locator('.react-flow__viewport').getAttribute('style');
    expect(viewportAfter).toBe(viewportBefore);

    const created = Object.keys((await getDocument(page)).model.elements)[0]!;
    const node = (await page.locator(`.react-flow__node[data-id="${created}"]`).boundingBox())!;
    expect(Math.abs(node.x + node.width / 2 - (box.x + click.x))).toBeLessThan(2);
    expect(Math.abs(node.y + node.height / 2 - (box.y + click.y))).toBeLessThan(2);
  });
});

test.describe('crowded connections', () => {
  const GROUP_A = 'group-web';
  const GROUP_B = 'group-payments';
  const EXTRA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  test('parallel connections between one pair fan apart', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'create-connection',
        id: EXTRA,
        connectionType: 'interaction',
        from: [IDS.ui],
        to: [IDS.gateway],
        title: 'refund',
      },
    ]);
    await fit(page);

    // Two connections join the same pair, so neither runs straight across.
    const first = (await page.getByTestId(`connection-${IDS.authorise}`).boundingBox())!;
    const second = (await page.getByTestId(`connection-${EXTRA}`).boundingBox())!;
    expect(Math.abs(first.y - second.y)).toBeGreaterThan(10);
  });

  test('connections into a collapsed group roll up into one labelled edge', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'create-connection',
        id: EXTRA,
        connectionType: 'interaction',
        from: [IDS.ui],
        to: [IDS.gateway],
        title: 'refund',
      },
      { type: 'group-elements', id: GROUP_A, title: 'Web', memberIds: [IDS.ui], position: { x: 0, y: 0 } },
      {
        type: 'group-elements',
        id: GROUP_B,
        title: 'Payments',
        memberIds: [IDS.gateway, IDS.ledger],
        position: { x: 280, y: 0 },
      },
      { type: 'set-selection', ids: [] },
    ]);
    await fit(page);

    // Both underlying connections now run between the same pair of groups.
    await expect(page.getByTestId(`connection-${IDS.authorise}`)).toHaveCount(0);
    const rollup = page.locator('.edge-label__rollup');
    await expect(rollup).toHaveCount(1);
    await expect(rollup).toContainText('2 connections');
  });

  test('expanding a group restores the individual connections', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'group-elements', id: GROUP_B, title: 'Payments', memberIds: [IDS.gateway], position: { x: 280, y: 0 } },
      { type: 'set-selection', ids: [] },
    ]);
    await fit(page);
    await expect(page.locator('.edge-label__rollup')).toHaveCount(0);

    await page.getByTestId(`expand-${GROUP_B}`).click();
    await fit(page);

    await expect(page.getByTestId(`connection-${IDS.authorise}`)).toBeVisible();
  });
});

test.describe('readable ids and multi-valued tags', () => {
  test('accepts a document written with readable ids', async ({ page }) => {
    const document = {
      formatVersion: 2,
      id: 'checkout-domain',
      title: 'Checkout',
      model: {
        elements: {
          'checkout-ui': {
            id: 'checkout-ui', kind: 'entity', type: 'component', title: 'Checkout UI',
            description: '', tags: { flow: ['checkout', 'refund'] }, sources: [], groupId: null,
          },
          gateway: {
            id: 'gateway', kind: 'entity', type: 'component', title: 'Gateway',
            description: '', tags: {}, sources: [], groupId: null,
          },
          authorise: {
            id: 'authorise', kind: 'connection', type: 'interaction',
            from: ['checkout-ui'], to: ['gateway'],
            title: 'authorise', description: '', tags: {}, sources: [], groupId: null,
          },
        },
      },
      layout: {},
      view: { pan: { x: 0, y: 0 }, zoom: 1 },
    };

    const result = await page.evaluate(
      (doc) => window.__modl.dispatch({ type: 'load-document', document: doc as never }),
      document,
    );
    expect(result.ok).toBe(true);
    await expect(page.getByTestId('entity-checkout-ui')).toBeVisible();
  });

  test('filters on any value of a multi-valued tag', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-tag', id: IDS.ui, key: 'flow', values: ['checkout', 'refund'] },
    ]);

    await setFilter(page, 'flow=refund');

    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toHaveClass(/is-dimmed/);
  });

  test('an unknown command is rejected rather than crashing the dispatcher', async ({ page }) => {
    const results = await page.evaluate(() =>
      window.__modl.dispatchAll([
        { type: 'expand-group', id: 'nope' } as never,
        {
          type: 'create-entity',
          id: 'after-the-bad-one',
          entityType: 'component',
          title: 'Still ran',
          position: { x: 0, y: 0 },
        } as never,
      ]),
    );

    expect(results[0]).toMatchObject({ ok: false });
    // The batch kept going, which is the point.
    expect(results[1]).toMatchObject({ ok: true });
    await expect(page.getByTestId('entity-after-the-bad-one')).toBeVisible();
  });
});

test.describe('framing on load', () => {
  /** A document placed far from the origin, where the camera starts. */
  function farAway() {
    return {
      formatVersion: 2,
      id: 'far-doc',
      title: 'Far',
      model: {
        elements: {
          'a': { id:'a', kind:'entity', type:'component', title:'Far A',
                 description:'', tags:{}, sources:[], groupId:null },
          'b': { id:'b', kind:'entity', type:'component', title:'Far B',
                 description:'', tags:{}, sources:[], groupId:null },
          'ab': { id:'ab', kind:'connection', type:'interaction', from:['a'], to:['b'],
                  title:'x', description:'', tags:{}, sources:[], groupId:null },
        },
      },
      layout: {
        a: { x: 4000, y: 3000, width: 180, height: 72 },
        b: { x: 4400, y: 3000, width: 180, height: 72 },
      },
      view: { pan: { x: 0, y: 0 }, zoom: 1 },
    };
  }

  test('a loaded document is brought into view', async ({ page }) => {
    await page.evaluate(
      (doc) => window.__modl.dispatch({ type: 'load-document', document: doc as never }),
      farAway(),
    );

    // Placed at 4000,3000, far outside a camera sitting at the origin.
    await expect(page.getByTestId('entity-a')).toBeInViewport();
    await expect(page.getByTestId('entity-b')).toBeInViewport();
  });

  test('creating an element still leaves the camera alone', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = await page.locator('.react-flow__viewport').getAttribute('style');

    await page.locator('.react-flow__pane').dblclick({ position: { x: 200, y: 300 } });
    await page.waitForTimeout(200);

    expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(before);
  });

  test('loading through the file picker frames it too', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles({
      name: 'far.modl.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(farAway())),
    });

    await expect(page.getByTestId('toolbar-message')).toContainText('Loaded');
    await expect(page.getByTestId('entity-a')).toBeInViewport();
  });
});

test.describe('connection nodes as junctions', () => {
  const FORK = 'in-stock';

  async function decision(page: import('@playwright/test').Page) {
    await dispatch(page, [
      { type: 'create-entity', id: 'submit', entityType: 'step', title: 'Submit', position: { x: 0, y: 120 } },
      { type: 'create-connection-node', id: FORK, shape: 'diamond', title: 'in stock?', position: { x: 300, y: 144 } },
      { type: 'create-entity', id: 'ship', entityType: 'step', title: 'Ship', position: { x: 480, y: 20 } },
      { type: 'create-entity', id: 'back', entityType: 'step', title: 'Backorder', position: { x: 480, y: 240 } },
      { type: 'create-connection', id: 'in', connectionType: 'relation', from: ['submit'], to: [FORK], title: '' },
      { type: 'create-connection', id: 'yes', connectionType: 'relation', from: [FORK], to: ['ship'], title: 'yes' },
      { type: 'create-connection', id: 'no', connectionType: 'relation', from: [FORK], to: ['back'], title: 'no' },
    ]);
    await fit(page);
  }

  test('draws a junction that connections reach on both sides', async ({ page }) => {
    await decision(page);

    await expect(page.getByTestId(`node-${FORK}`)).toBeVisible();
    await expect(page.getByTestId(`connection-yes`)).toContainText('yes');
    await expect(page.getByTestId(`connection-no`)).toContainText('no');
  });

  test('switches between a diamond and a circle', async ({ page }) => {
    await decision(page);
    await page.getByTestId(`node-${FORK}`).click();

    await expect(page.getByTestId(`node-${FORK}`)).toHaveAttribute('data-shape', 'diamond');
    await page.getByTestId(`node-shape-${FORK}`).click();

    await expect(page.getByTestId(`node-${FORK}`)).toHaveAttribute('data-shape', 'circle');
    expect((await getDocument(page)).model.elements[FORK]).toMatchObject({ shape: 'circle' });
  });

  test('renames in place like anything else', async ({ page }) => {
    await decision(page);

    await page.getByTestId(`node-${FORK}`).dblclick();
    const rename = page.getByTestId(`rename-${FORK}`);
    await expect(rename).toBeVisible();
    await rename.fill('has stock?');
    await rename.press('Enter');

    expect((await getDocument(page)).model.elements[FORK]?.title).toBe('has stock?');
  });

  test('the toolbar places one', async ({ page }) => {
    await page.getByTestId('add-element').click();
    await page.getByTestId('add-type-decision').click();
    await page.locator('.react-flow__pane').click({ position: { x: 200, y: 200 } });

    const junctions = Object.values((await getDocument(page)).model.elements).filter(
      (element) => element.kind === 'connection-node',
    );
    expect(junctions).toHaveLength(1);
    expect(junctions[0]).toMatchObject({ shape: 'diamond' });
  });

  test('survives save and load', async ({ page }) => {
    await decision(page);
    const saved = await serialize(page);

    await page.getByTestId('file-input').setInputFiles({
      name: 'decision.modl.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });

    await expect(page.getByTestId('toolbar-message')).toContainText('Loaded');
    expect(await serialize(page)).toBe(saved);
    await expect(page.getByTestId(`node-${FORK}`)).toBeVisible();
  });
});

test.describe('artifacts', () => {
  test('draws with its own icon and takes no paradigm', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-element-type', id: IDS.ledger, elementType: 'artifact' },
    ]);

    const icon = page.locator(`[data-testid="entity-${IDS.ledger}"] svg[data-icon]`);
    await expect(icon).toHaveAttribute('data-icon', 'artifact');

    // A connection into an artifact keeps the paradigm it came from.
    await page.evaluate(() =>
      window.__modl.dispatch({
        type: 'create-connection',
        id: 'writes',
        connectionType: 'transition',
        from: ['11111111-1111-4111-8111-111111111111'],
        to: ['33333333-3333-4333-8333-333333333333'],
        title: 'writes',
      } as never),
    );
    expect((await getDocument(page)).model.elements['writes']).toMatchObject({ type: 'transition' });
  });

  test('is offered in the inspector type list', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId(`editor-type-${IDS.ui}`).click();
    await expect(page.getByTestId(`editor-type-${IDS.ui}-artifact`)).toBeVisible();
  });
});

test.describe('attachment sides', () => {
  /** First and last point of an edge path, in board coordinates. */
  function ends(d: string): { start: { x: number; y: number }; end: { x: number; y: number } } {
    const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    return {
      start: { x: numbers[0]!, y: numbers[1]! },
      end: { x: numbers[numbers.length - 2]!, y: numbers[numbers.length - 1]! },
    };
  }

  test('a line running leftwards leaves the left side', async ({ page }) => {
    // The target sits to the LEFT of the source. With handles fixed to the
    // right and left edges, the line had to loop around both boxes.
    await dispatch(page, [
      { type: 'create-entity', id: 'right', entityType: 'component', title: 'Right', position: { x: 600, y: 0 } },
      { type: 'create-entity', id: 'left', entityType: 'component', title: 'Left', position: { x: 0, y: 0 } },
      { type: 'create-connection', id: 'back', connectionType: 'interaction', from: ['right'], to: ['left'], title: '' },
    ]);
    await fit(page);

    const d = (await page
      .locator('.react-flow__edge[data-id^="back"] .react-flow__edge-path')
      .getAttribute('d'))!;
    const { start, end } = ends(d);

    // Leaves at the source's left edge and arrives at the target's right.
    expect(start.x).toBeLessThan(610);
    expect(end.x).toBeGreaterThan(170);
    expect(start.x).toBeGreaterThan(end.x);
  });

  test('boxes stacked vertically join bottom to top', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'top', entityType: 'component', title: 'Top', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'bottom', entityType: 'component', title: 'Bottom', position: { x: 0, y: 400 } },
      { type: 'create-connection', id: 'down', connectionType: 'interaction', from: ['top'], to: ['bottom'], title: '' },
    ]);
    await fit(page);

    const d = (await page
      .locator('.react-flow__edge[data-id^="down"] .react-flow__edge-path')
      .getAttribute('d'))!;
    const { start, end } = ends(d);

    // Leaves the bottom edge of the upper box, not its right edge.
    expect(start.y).toBeGreaterThan(60);
    expect(end.y).toBeLessThan(410);
    expect(end.y).toBeGreaterThan(start.y);
  });
});

test.describe('bundled connection overlay', () => {
  test('names what each bundled line joins', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'client', entityType: 'component', title: 'client', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'api', entityType: 'component', title: 'api', position: { x: 400, y: 0 } },
      { type: 'create-connection', id: 'c1', connectionType: 'interaction', from: ['client'], to: ['api'], title: 'fetch' },
      { type: 'create-connection', id: 'c2', connectionType: 'interaction', from: ['client'], to: ['api'], title: '' },
      { type: 'group-elements', id: 'g-client', title: 'Web', memberIds: ['client'], position: { x: 0, y: 0 } },
      { type: 'group-elements', id: 'g-api', title: 'Services', memberIds: ['api'], position: { x: 400, y: 0 } },
      { type: 'set-selection', ids: [] },
    ]);
    await fit(page);

    const rollup = page.locator('.edge-label__rollup');
    await expect(rollup).toHaveCount(1);

    // Titles a reader recognises, not ids.
    const overlay = await rollup.getAttribute('title');
    expect(overlay).toContain('client → api');
    expect(overlay).toContain('fetch: client → api');
    expect(overlay).not.toMatch(/interaction [0-9a-f]{8}/);
  });
});

test.describe('chosen connection points', () => {
  test('a line stays on the point it was dragged onto', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 400, y: 0 } },
      { type: 'create-connection', id: 'link', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
      // Deliberately not the sides the renderer would pick for boxes side by side.
      { type: 'set-connection-sides', id: 'link', source: 'top', target: 'bottom' },
    ]);
    await fit(page);

    const edge = page.locator('.react-flow__edge[data-id^="link"]');
    const d = (await edge.locator('.react-flow__edge-path').getAttribute('d'))!;
    const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

    // Leaves above the source box and arrives below the target box.
    expect(numbers[1]!).toBeLessThan(5);
    expect(numbers[numbers.length - 1]!).toBeGreaterThan(65);
  });

  test('the chosen points survive save and load', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-connection-sides', id: IDS.authorise, source: 'top', target: 'bottom' },
    ]);
    const saved = await serialize(page);
    expect(saved).toContain('"sourceSide": "top"');

    await page.getByTestId('file-input').setInputFiles({
      name: 'sides.modl.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });
    await expect(page.getByTestId('toolbar-message')).toContainText('Loaded');
    expect(await serialize(page)).toBe(saved);
  });
});

test.describe('arrowhead toggles', () => {
  test('turning on the start alone flips the connection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    // Currently forward: start off, end on. Turning the end off leaves the
    // start on alone, which reads as backwards.
    await page.getByTestId(`editor-arrow-start-${IDS.authorise}`).click();
    await page.getByTestId(`editor-arrow-end-${IDS.authorise}`).click();

    const connection = (await getDocument(page)).model.elements[IDS.authorise];
    expect(connection).toMatchObject({
      from: [IDS.gateway],
      to: [IDS.ui],
      direction: 'forward',
    });
  });

  test('every combination is reachable from two buttons', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();
    const direction = async () =>
      (await getDocument(page)).model.elements[IDS.authorise] as unknown as { direction: string };

    expect((await direction()).direction).toBe('forward');
    await page.getByTestId(`editor-arrow-start-${IDS.authorise}`).click();
    expect((await direction()).direction).toBe('both');
    await page.getByTestId(`editor-arrow-start-${IDS.authorise}`).click();
    expect((await direction()).direction).toBe('forward');
    await page.getByTestId(`editor-arrow-end-${IDS.authorise}`).click();
    expect((await direction()).direction).toBe('none');
  });

  test('no stray label sits before the buttons', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await expect(page.getByTestId(`editor-arrows-${IDS.authorise}`)).not.toContainText('Reads');
  });
});

test.describe('connection nodes', () => {
  test('the picker calls it a connection node', async ({ page }) => {
    await page.getByTestId('add-element').click();
    await expect(page.getByTestId('add-type-connection-node')).toHaveText('connection node');
    await expect(page.getByTestId('add-type-decision')).toHaveText('decision');
  });

  test('a diamond is a decision, a circle a connection node', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-connection-node', id: 'junction', shape: 'diamond', title: 'ready?', position: { x: 0, y: 0 } },
    ]);
    await page.getByTestId('node-junction').click();

    await expect(page.getByTestId('editor-junction')).toContainText('decision');
    await page.getByTestId('node-shape-junction').click();
    await expect(page.getByTestId('editor-junction')).toContainText('connection node');
  });

  test('a connection point resizes', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-connection-node', id: 'junction', shape: 'diamond', title: '', position: { x: 0, y: 0 } },
    ]);
    await fit(page);
    await page.getByTestId('node-junction').click();

    const before = (await getDocument(page)).layout['junction'] as { width: number };
    const handle = page.locator(
      '.react-flow__node[data-id="junction"] .react-flow__resize-control.bottom.right.handle',
    );
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 80, { steps: 10 });
    await page.mouse.up();

    const after = (await getDocument(page)).layout['junction'] as { width: number };
    expect(after.width).toBeGreaterThan(before.width);
  });

  test('a junction offers a contact point at each of its four vertices', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-connection-node', id: 'junction', shape: 'circle', title: '', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'target', entityType: 'component', title: 'T', position: { x: 400, y: 0 } },
      { type: 'create-connection', id: 'out', connectionType: 'interaction', from: ['junction'], to: ['target'], title: '' },
    ]);
    await fit(page);

    // Four contact points, one per vertex, so branches leave from their own
    // point rather than piling up on a single anchor at the middle.
    const node = page.locator('.react-flow__node[data-id="junction"]');
    await expect(node.locator('.handle--vertex')).toHaveCount(4);

    const centres = await node.locator('.handle--vertex').evaluateAll((handles) =>
      handles.map((handle) => {
        const box = handle.getBoundingClientRect();
        return `${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height / 2)}`;
      }),
    );
    expect(new Set(centres).size).toBe(4);

    // The line leaves from the vertex facing where it is going, not the middle.
    const box = (await page.evaluate(
      () => window.__modl.getDocument().layout['junction'],
    )) as { x: number; y: number; width: number; height: number };
    const d = (await page
      .locator('.react-flow__edge[data-id^="out"] .react-flow__edge-path')
      .getAttribute('d'))!;
    const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    expect(Math.abs(numbers[0]! - (box.x + box.width))).toBeLessThan(8);
    expect(Math.abs(numbers[1]! - (box.y + box.height / 2))).toBeLessThan(8);
  });

  test('a connection can be dragged from a round node', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-connection-node', id: 'junction', shape: 'circle', title: '', position: { x: 0, y: 100 } },
      { type: 'create-entity', id: 'target', entityType: 'component', title: 'T', position: { x: 320, y: 100 } },
    ]);
    await fit(page);

    const from = (await page
      .locator('.react-flow__node[data-id="junction"] .react-flow__handle.react-flow__handle-right')
      .boundingBox())!;
    const to = (await page
      .locator('.react-flow__node[data-id="target"] .react-flow__handle.react-flow__handle-left')
      .boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();

    const connections = Object.values((await getDocument(page)).model.elements).filter(
      (element) => element.kind === 'connection',
    );
    expect(connections).toHaveLength(1);
  });
});

test.describe('moving a connector end', () => {
  test('drags an endpoint onto another component', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 400, y: 0 } },
      { type: 'create-entity', id: 'c', entityType: 'component', title: 'C', position: { x: 400, y: 260 } },
      { type: 'create-connection', id: 'link', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
    ]);
    await fit(page);

    // A connection offers its ends only while it is selected.
    await page.getByTestId('connection-link').click();

    const d = (await page
      .locator('.react-flow__edge[data-id^="link"] .react-flow__edge-path')
      .getAttribute('d'))!;
    const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const endFlow = { x: numbers[numbers.length - 2]!, y: numbers[numbers.length - 1]! };

    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const transform = await page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
      const m = new DOMMatrix(getComputedStyle(viewport).transform);
      return { a: m.a, d: m.d, e: m.e, f: m.f };
    });
    const screen = (p: { x: number; y: number }) => ({
      x: pane.x + transform.a * p.x + transform.e,
      y: pane.y + transform.d * p.y + transform.f,
    });

    const start = screen(endFlow);
    const drop = (await page
      .locator('.react-flow__node[data-id="c"] .react-flow__handle.react-flow__handle-left')
      .boundingBox())!;

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 14 });
    await page.mouse.up();

    expect((await getDocument(page)).model.elements['link']).toMatchObject({
      from: ['a'],
      to: ['c'],
    });
  });
});

test.describe('adding a parallel connector', () => {
  test('leaves the existing line where it was', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 400, y: 0 } },
      { type: 'create-connection', id: 'first', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
    ]);
    await fit(page);

    const pathOf = (id: string) =>
      page.locator(`.react-flow__edge[data-id^="${id}"] .react-flow__edge-path`).getAttribute('d');
    const before = await pathOf('first');

    await dispatch(page, [
      { type: 'create-connection', id: 'second', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
    ]);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);

    // The first line does not move when a second joins the same pair.
    expect(await pathOf('first')).toBe(before);
  });

  test('still keeps the two apart', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 400, y: 0 } },
      { type: 'create-connection', id: 'first', connectionType: 'interaction', from: ['a'], to: ['b'], title: 'one' },
      { type: 'create-connection', id: 'second', connectionType: 'interaction', from: ['a'], to: ['b'], title: 'two' },
    ]);
    await fit(page);

    const one = (await page.getByTestId('connection-first').boundingBox())!;
    const two = (await page.getByTestId('connection-second').boundingBox())!;
    expect(Math.abs(one.y - two.y)).toBeGreaterThan(10);
  });
});

test.describe('junction anchoring', () => {
  test('a line leaves a junction facing where it is going', async ({ page }) => {
    // Two nodes on a diagonal: the case where a fixed anchor direction made
    // the line loop back on itself before heading off.
    await dispatch(page, [
      { type: 'create-connection-node', id: 'n1', shape: 'circle', title: '', position: { x: 60, y: 60 } },
      { type: 'create-connection-node', id: 'n2', shape: 'circle', title: '', position: { x: 400, y: 340 } },
      { type: 'create-connection', id: 'c', connectionType: 'interaction', from: ['n1'], to: ['n2'], title: '' },
    ]);
    await fit(page);

    const d = (await page
      .locator('.react-flow__edge[data-id^="c"] .react-flow__edge-path')
      .getAttribute('d'))!;
    const n = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const start = { x: n[0]!, y: n[1]! };
    const end = { x: n[n.length - 2]!, y: n[n.length - 1]! };

    // The whole path stays inside the box the two ends describe: it never
    // sets off in the wrong direction and doubles back.
    const xs = n.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(Math.min(start.x, end.x) - 1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(Math.max(start.x, end.x) + 1);
  });

  test('switching shape keeps the connections drawn', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 60 } },
      { type: 'create-connection-node', id: 'n', shape: 'diamond', title: '', position: { x: 340, y: 76 } },
      { type: 'create-connection', id: 'c', connectionType: 'interaction', from: ['a'], to: ['n'], title: '' },
    ]);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    // Both shapes anchor at the centre, so an edge never points at a handle
    // the current shape does not render.
    await page.evaluate(() =>
      window.__modl.dispatch({ type: 'set-node-shape', id: 'n', shape: 'circle' } as never),
    );
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await page.evaluate(() =>
      window.__modl.dispatch({ type: 'set-node-shape', id: 'n', shape: 'diamond' } as never),
    );
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });
});

test.describe('placing by drag', () => {
  test('a drag sizes the element it puts down', async ({ page }) => {
    await page.getByTestId('add-element').click();
    await page.getByTestId('add-type-component').click();

    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.move(pane.x + 150, pane.y + 120);
    await page.mouse.down();
    await page.mouse.move(pane.x + 450, pane.y + 320, { steps: 12 });
    await expect(page.getByTestId('placement-preview')).toBeVisible();
    await page.mouse.up();

    const document = await getDocument(page);
    const id = Object.keys(document.model.elements)[0]!;
    const layout = document.layout[id] as { width: number; height: number };
    expect(layout.width).toBeGreaterThan(250);
    expect(layout.height).toBeGreaterThan(150);
  });

  test('a click puts one down at its natural size', async ({ page }) => {
    await page.getByTestId('add-element').click();
    await page.getByTestId('add-type-component').click();
    await page.locator('.react-flow__pane').click({ position: { x: 200, y: 200 } });

    const document = await getDocument(page);
    const id = Object.keys(document.model.elements)[0]!;
    expect(document.layout[id]).toMatchObject({ width: 180, height: 72 });
  });
});

test.describe('converting an element', () => {
  test('a component becomes a decision and back', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'Check', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 400, y: 0 } },
      { type: 'create-connection', id: 'c', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
    ]);
    await page.getByTestId('entity-a').click();

    await page.getByTestId('editor-type-a').click();
    await page.getByTestId('editor-type-a-decision').click();

    let document = await getDocument(page);
    expect(document.model.elements['a']).toMatchObject({
      kind: 'connection-node',
      shape: 'diamond',
      title: 'Check',
    });
    // The connection still reaches it: the id never changed.
    expect(document.model.elements['c']).toMatchObject({ from: ['a'], to: ['b'] });
    await expect(page.getByTestId('node-a')).toBeVisible();

    await page.getByTestId('node-a').click();
    await page.getByTestId('editor-type-a').click();
    await page.getByTestId('editor-type-a-component').click();

    document = await getDocument(page);
    expect(document.model.elements['a']).toMatchObject({ kind: 'entity', type: 'component' });
    await expect(page.getByTestId('entity-a')).toBeVisible();
  });
});

test.describe('lines clearing their element', () => {
  test('a line leaving a side that faces away still clears the box', async ({ page }) => {
    // The reported case: the target is up and to the right, but the line was
    // dropped on the bottom edge. Turning straight for the target from there
    // drags the curve back through the element it just left.
    await dispatch(page, [
      { type: 'create-entity', id: 'box', entityType: 'component', title: '', position: { x: 0, y: 140 } },
      { type: 'create-connection-node', id: 'j', shape: 'circle', title: '', position: { x: 330, y: 20 } },
      { type: 'create-connection', id: 'c', connectionType: 'interaction', from: ['box'], to: ['j'], title: '' },
      { type: 'set-connection-sides', id: 'c', source: 'bottom', target: null },
    ]);
    await fit(page);

    const box = (await page.evaluate(
      () => window.__modl.getDocument().layout['box'],
    )) as { x: number; y: number; width: number; height: number };

    const insideCount = await page.evaluate((rect) => {
      const path = document.querySelector('.react-flow__edge-path') as SVGPathElement;
      const length = path.getTotalLength();
      let count = 0;
      for (let at = 0; at <= length; at += length / 200) {
        const point = path.getPointAtLength(at);
        if (
          point.x > rect.x + 2 &&
          point.x < rect.x + rect.width - 2 &&
          point.y > rect.y + 2 &&
          point.y < rect.y + rect.height - 2
        ) {
          count += 1;
        }
      }
      return count;
    }, box);

    expect(insideCount).toBe(0);
  });

  test('moving an element a little moves its line a little', async ({ page }) => {
    // The reported case: two boards laid out almost identically, one drawn
    // with a plain curve and the other with a detour, because the exit angle
    // fell either side of a cutoff. Nothing about the line may jump.
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 620, y: 40 } },
      { type: 'create-connection', id: 'c', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
      // Pinned to the top at both ends, so the line has to set off further
      // and further away from where it is going as the target drops.
      { type: 'set-connection-sides', id: 'c', source: 'top', target: 'top' },
    ]);

    const rises: number[] = [];
    for (let dy = 40; dy <= 400; dy += 20) {
      await dispatch(page, [{ type: 'move-element', id: 'b', position: { x: 620, y: dy } }]);

      rises.push(
        await page.locator('.react-flow__edge-path').evaluate((element) => {
          const path = element as SVGPathElement;
          const length = path.getTotalLength();
          const start = path.getPointAtLength(0);
          let top = start.y;
          for (let i = 0; i <= 100; i += 1) {
            top = Math.min(top, path.getPointAtLength((length * i) / 100).y);
          }
          return start.y - top;
        }),
      );
    }

    // Each 20px step of the target changes how far the line reaches by less
    // than the step itself. A cutoff shows up here as one huge jump.
    const steps = rises.slice(1).map((rise, i) => Math.abs(rise - rises[i]!));
    expect(Math.max(...steps)).toBeLessThan(20);
  });

  test('a distant element does not make the detour any wider', async ({ page }) => {
    // What a line is getting around is its own element, which is the same size
    // however far off the other end is. A long line was arcing out three times
    // as far as a short one for no more reason than the distance.
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 330, y: 500 } },
      { type: 'create-connection', id: 'c', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
      { type: 'set-connection-sides', id: 'c', source: 'top', target: 'top' },
    ]);

    const reach = async () =>
      page.locator('.react-flow__edge-path').evaluate((element) => {
        const path = element as SVGPathElement;
        const length = path.getTotalLength();
        const start = path.getPointAtLength(0);
        let top = start.y;
        for (let i = 0; i <= 200; i += 1) {
          top = Math.min(top, path.getPointAtLength((length * i) / 200).y);
        }
        return start.y - top;
      });

    const near = await reach();
    await dispatch(page, [{ type: 'move-element', id: 'b', position: { x: 330, y: 2000 } }]);
    const far = await reach();

    // Four times the distance, and the line reaches out no further.
    expect(far).toBeLessThan(near + 10);
    // It is still detouring, rather than the cap having flattened it away.
    expect(far).toBeGreaterThan(60);
  });

  test('a line leaves perpendicular to the side it starts on', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 500, y: 300 } },
      { type: 'create-connection', id: 'c', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
    ]);
    await fit(page);

    const heading = await page.evaluate(() => {
      const path = document.querySelector('.react-flow__edge-path') as SVGPathElement;
      const start = path.getPointAtLength(0);
      const just = path.getPointAtLength(12);
      return { dx: just.x - start.x, dy: just.y - start.y };
    });

    // Leaves the right-hand side heading right, not diagonally at the target.
    expect(heading.dx).toBeGreaterThan(0);
    expect(Math.abs(heading.dy)).toBeLessThan(Math.abs(heading.dx) / 2);
  });
});

test.describe('junction icons', () => {
  test('the picker shows an icon for each junction shape', async ({ page }) => {
    await page.getByTestId('add-element').click();

    await expect(
      page.locator('[data-testid="add-type-connection-node"] svg[data-icon]'),
    ).toHaveAttribute('data-icon', 'connection node');
    await expect(
      page.locator('[data-testid="add-type-decision"] svg[data-icon]'),
    ).toHaveAttribute('data-icon', 'decision');
  });

  test('the editor type list shows them too', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
    ]);
    await page.getByTestId('entity-a').click();
    await page.getByTestId('editor-type-a').click();

    await expect(
      page.locator('[data-testid="editor-type-a-decision"] svg[data-icon]'),
    ).toHaveAttribute('data-icon', 'decision');
  });
});

test.describe('lines stay on their anchors', () => {
  test('every end of every parallel line sits on a handle', async ({ page }) => {
    // Three connections between one pair: the case where separating them by
    // nudging their ends left the lines floating beside the elements.
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 220 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 620, y: 40 } },
      { type: 'create-connection', id: 'c1', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
      { type: 'create-connection', id: 'c2', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
      { type: 'create-connection', id: 'c3', connectionType: 'interaction', from: ['a'], to: ['b'], title: '' },
    ]);
    await fit(page);

    const gaps = await page.evaluate(() => {
      const handles = [...document.querySelectorAll('.react-flow__handle')].map((handle) => {
        const box = handle.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });

      const worst: number[] = [];
      for (const path of [...document.querySelectorAll('.react-flow__edge-path')] as SVGPathElement[]) {
        const owner = path.ownerSVGElement!;
        const matrix = path.getScreenCTM()!;
        const length = path.getTotalLength();
        for (const at of [0, length]) {
          const local = path.getPointAtLength(at);
          const point = owner.createSVGPoint();
          point.x = local.x;
          point.y = local.y;
          const screen = point.matrixTransform(matrix);
          worst.push(Math.min(...handles.map((h) => Math.hypot(h.x - screen.x, h.y - screen.y))));
        }
      }
      return worst;
    });

    expect(gaps).toHaveLength(6);
    // Every end within a handle's own radius of a handle centre.
    for (const gap of gaps) expect(gap).toBeLessThan(10);
  });

  test('parallel lines share their handles and part in the middle', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-entity', id: 'a', entityType: 'component', title: 'A', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'b', entityType: 'component', title: 'B', position: { x: 400, y: 0 } },
      { type: 'create-connection', id: 'c1', connectionType: 'interaction', from: ['a'], to: ['b'], title: 'one' },
      { type: 'create-connection', id: 'c2', connectionType: 'interaction', from: ['a'], to: ['b'], title: 'two' },
    ]);
    await fit(page);

    // Twenty-one points along each line, so the two can be compared all the
    // way rather than only at their ends.
    const [one, two] = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__edge-path')].map((element) => {
        const path = element as SVGPathElement;
        const length = path.getTotalLength();
        return Array.from({ length: 21 }, (_, i) => {
          const point = path.getPointAtLength((length * i) / 20);
          return { x: point.x, y: point.y };
        });
      }),
    );

    const apart = one!.map((point, i) => Math.hypot(point.x - two![i]!.x, point.y - two![i]!.y));

    // Both keep the same pair of handles, so they meet at either end.
    expect(apart[0]!).toBeLessThan(1);
    expect(apart[apart.length - 1]!).toBeLessThan(1);

    // In between, the second is far enough off the first to read as its own
    // line, and gently enough that it is no wider than a small element.
    expect(Math.max(...apart)).toBeGreaterThan(12);
    expect(Math.max(...apart)).toBeLessThan(40);

    // The gap opens and closes once, without the two ever crossing back over
    // each other: separation ramps in rather than switching on.
    const peak = apart.indexOf(Math.max(...apart));
    const rising = apart.slice(0, peak + 1);
    const falling = apart.slice(peak);
    expect(rising.every((gap, i) => i === 0 || gap >= rising[i - 1]! - 0.01)).toBe(true);
    expect(falling.every((gap, i) => i === 0 || gap <= falling[i - 1]! + 0.01)).toBe(true);
  });
});

test.describe('hiding elements', () => {
  test('hiding a component mutes it, deselects it, and takes its connections off the board', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId(`editor-hide-${IDS.gateway}`).click();

    // Hiding deselects, so the hidden element is the dim one and the rest of
    // the board stays readable. A selection surviving its own hide muted
    // everything else instead.
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([]);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).not.toHaveClass(/is-dimmed/);
    // Both connections touch the gateway, so neither is drawn.
    await expect(page.getByTestId(`connection-${IDS.authorise}`)).toHaveCount(0);
    await expect(page.getByTestId(`connection-${IDS.post}`)).toHaveCount(0);
  });

  test('hiding is session state: the saved document does not change', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = await serialize(page);

    await dispatch(page, [{ type: 'set-hidden', id: IDS.gateway, hidden: true }]);

    expect(await serialize(page)).toBe(before);
  });

  test('the filter bar lists hidden elements and brings one back', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await dispatch(page, [{ type: 'set-hidden', id: IDS.gateway, hidden: true }]);
    await expect(page.getByTestId('hidden-list')).toContainText('Payment gateway');

    await page.getByTestId(`unhide-${IDS.gateway}`).click();

    await expect(page.getByTestId('hidden-list')).toHaveCount(0);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`connection-${IDS.authorise}`)).toBeVisible();
  });

  test('re-selecting a hidden element offers Show in its editor', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId(`editor-hide-${IDS.gateway}`).click();

    // Hiding deselected it; a hidden element stays clickable to bring back.
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await expect(page.getByTestId(`editor-hide-${IDS.gateway}`)).toHaveText('Show');

    await page.getByTestId(`editor-hide-${IDS.gateway}`).click();

    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`connection-${IDS.post}`)).toBeVisible();
  });

  test('a connection editor offers no hide toggle', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await expect(page.getByTestId(`editor-${IDS.authorise}`)).toBeVisible();
    // A hidden connection would leave no remnant to find it by, so it only
    // leaves the board with its endpoints.
    await expect(page.getByTestId(`editor-hide-${IDS.authorise}`)).toHaveCount(0);
  });

  test('a multi-selection hides in one go and deselects what it hid', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId(`entity-${IDS.gateway}`).click({ modifiers: ['ControlOrMeta'] });

    await expect(page.getByTestId('hide-selected')).toHaveText('Hide 2');
    await page.getByTestId('hide-selected').click();

    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([]);
    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`connection-${IDS.authorise}`)).toHaveCount(0);
  });

  test('a mixed selection offers Hide for the visible and Show for the hidden', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await dispatch(page, [{ type: 'set-hidden', id: IDS.ui, hidden: true }]);
    await fit(page);

    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId(`entity-${IDS.gateway}`).click({ modifiers: ['ControlOrMeta'] });

    await expect(page.getByTestId('hide-selected')).toHaveText('Hide 1');
    await expect(page.getByTestId('show-selected')).toHaveText('Show 1');

    await page.getByTestId('show-selected').click();

    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`connection-${IDS.authorise}`)).toBeVisible();
  });

  test('hide arrives as a command, so the trace replays it', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId(`editor-hide-${IDS.gateway}`).click();

    const trace = await getTrace(page);
    expect(trace.some((entry) => entry.command.type === 'set-hidden')).toBe(true);

    const result = await page.evaluate((entries) => window.__modl.replay(entries), trace);
    expect(result.divergences).toBe(0);
  });
});

test.describe('selection highlight', () => {
  test('a selection keeps its neighbourhood readable and mutes the rest', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`entity-${IDS.ui}`).click();

    // UI connects to the gateway alone, so the ledger and its connection fade.
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`connection-${IDS.authorise}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`connection-${IDS.post}`)).toHaveClass(/is-dimmed/);
  });

  test('a multi-selection unions the neighbourhoods', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId(`entity-${IDS.ledger}`).click({ modifiers: ['ControlOrMeta'] });

    // Everything touches one of the two selected components.
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`connection-${IDS.post}`)).not.toHaveClass(/is-dimmed/);
  });

  test('a selected connection highlights its endpoints', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);
  });

  test('clearing the selection restores the board', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);

    await page.locator('.react-flow__pane').click();

    await expect(page.getByTestId(`entity-${IDS.ledger}`)).not.toHaveClass(/is-dimmed/);
  });

  test('the board-settings toggle turns the highlight off and on', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId('highlight-toggle').click();
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).not.toHaveClass(/is-dimmed/);

    await page.getByTestId('highlight-toggle').click();
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);
  });

  test('the toggle sits with the other board controls', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await expect(
      page.locator('.react-flow__controls').getByTestId('highlight-toggle'),
    ).toBeVisible();
  });

  test('the preference travels through the command bus', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId('highlight-toggle').click();

    const trace = await getTrace(page);
    expect(
      trace.some(
        (entry) =>
          entry.command.type === 'set-selection-highlight' && entry.command.enabled === false,
      ),
    ).toBe(true);
  });

  test('selecting an expanded group keeps its members readable', async ({ page }) => {
    const GROUP = '77777777-7777-4777-8777-777777777777';
    const REPORT = '88888888-8888-4888-8888-888888888888';
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'create-entity', id: REPORT, entityType: 'component', title: 'Reporting', position: { x: 840, y: 0 } },
      {
        type: 'group-elements',
        id: GROUP,
        title: 'Payments',
        memberIds: [IDS.gateway, IDS.ledger],
        position: { x: 280, y: 0 },
      },
      { type: 'set-expanded', id: GROUP, expanded: true },
    ]);
    await fit(page);

    // Select by the group header, away from the collapse button and members.
    const header = await page.getByTestId(`group-${GROUP}`).boundingBox();
    await page.mouse.click(header!.x + header!.width - 30, header!.y + 12);

    // The members and their connection light up with the group; the
    // unconnected report is the one that fades.
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`connection-${IDS.post}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${REPORT}`)).toHaveClass(/is-dimmed/);
  });
});

test.describe('relations menu', () => {
  // The roller-geometry spec races overlay layout when local workers share
  // the machine: it failed once under a full parallel run and passed 3/3
  // alone (#49).
  test.describe.configure({ retries: 1 });

  test('a selected connected component offers its relations', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`entity-${IDS.gateway}`).click();

    // The gateway touches both connections.
    await expect(page.getByTestId('relations-menu-toggle')).toContainText('2');

    await page.getByTestId('relations-menu-toggle').click();
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toBeVisible();
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toBeVisible();
  });

  test('an unconnected element offers nothing', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'create-entity',
        id: '66666666-6666-4666-8666-666666666666',
        entityType: 'component',
        title: 'Loose end',
        position: { x: 0, y: 300 },
      },
    ]);

    await page.getByTestId('entity-66666666-6666-4666-8666-666666666666').click();

    await expect(page.getByTestId('relations-menu')).toHaveCount(0);
  });

  test('the roller opens clear of its own element and in front of its neighbours', async ({ page }) => {
    // The gateway sits right where the UI's roller expands, so the option
    // pill overlaps the neighbour.
    await dispatch(page, sampleDomain());
    await dispatch(page, [{ type: 'move-element', id: IDS.gateway, position: { x: 230, y: 0 } }]);

    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId('relations-menu-toggle').click();

    const option = (await page.getByTestId(`relation-${IDS.gateway}`).boundingBox())!;
    const y = option.y + option.height / 2;

    // The pills hang off the menu's left edge, which sits past the selected
    // element, so they never cover the thing they belong to.
    const own = (await page.getByTestId(`entity-${IDS.ui}`).boundingBox())!;
    expect(option.x).toBeGreaterThanOrEqual(own.x + own.width);

    // Over the neighbour they draw in front: React Flow lifts a selected node
    // by another 1000, which used to bury the roller behind the board.
    const behind = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
    const x = Math.max(option.x, behind.x) + 4;
    expect(x).toBeLessThan(Math.min(option.x + option.width, behind.x + behind.width));
    expect(
      await page.evaluate(
        ([atX, atY]: (number | undefined)[]) =>
          document.elementFromPoint(atX!, atY!)?.closest('.roller-menu__option') !== null,
        [x, y],
      ),
      'roller behind the gateway',
    ).toBe(true);
  });

  test('choosing a relation selects the component it pans to', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId('relations-menu-toggle').click();
    await page.getByTestId(`relation-${IDS.gateway}`).click();

    // Focus moved with the camera: the destination is selected, the highlight
    // follows it, and its own roller arrives open so the walk can continue
    // (decision 025 revised decision 009's closed arrival).
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).toHaveClass(/is-selected/);
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);
  });

  test('choosing a relation pans the camera to the peer', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    const before = await page.locator('.react-flow__viewport').getAttribute('style');

    await page.getByTestId('relations-menu-toggle').click();
    await page.getByTestId(`relation-${IDS.gateway}`).click();

    // The pan travels through the command bus, so the trace carries it and
    // the camera follows.
    await expect(async () => {
      expect(await page.locator('.react-flow__viewport').getAttribute('style')).not.toBe(before);
    }).toPass();
    const trace = await getTrace(page);
    expect(trace.some((entry) => entry.command.type === 'set-view')).toBe(true);

    // The gateway box sits centred in the pane, give or take the animation.
    await page.waitForTimeout(400);
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const target = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
    expect(Math.abs(target.x + target.width / 2 - (pane.x + pane.width / 2))).toBeLessThan(10);
    expect(Math.abs(target.y + target.height / 2 - (pane.y + pane.height / 2))).toBeLessThan(10);
  });

  test('the middle option emphasises its connection on the board', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.getByTestId('relations-menu-toggle').click();

    // The roller opens on its first option; turning it moves the emphasis.
    await expect(page.getByTestId(`connection-${IDS.authorise}`)).toHaveClass(/is-highlighted/);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`connection-${IDS.post}`)).toHaveClass(/is-highlighted/);
    await expect(page.getByTestId(`connection-${IDS.authorise}`)).not.toHaveClass(/is-highlighted/);
  });

  test('arrow keys turn the roller, wrapping at the ends', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId('relations-menu-toggle').click();

    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);
    // Two entries: down, down again wraps back to the first.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toHaveClass(/is-active/);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toHaveClass(/is-active/);
  });

  test('the mouse wheel turns the roller, one notch per turn', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    // The click leaves the pointer over the menu, where the wheel lands.
    await page.getByTestId('relations-menu-toggle').click();
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toBeVisible();

    await page.mouse.wheel(0, 120);
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toHaveClass(/is-active/);
    await page.mouse.wheel(0, -120);
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);
  });

  test('a trackpad swipe pools its small deltas into whole turns', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId('relations-menu-toggle').click();
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);

    // Two-thirds of a turn's worth: the roller holds still.
    await page.mouse.wheel(0, 40);
    await page.mouse.wheel(0, 26);
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);

    // The stream keeps coming; crossing the threshold spends one turn.
    await page.mouse.wheel(0, 40);
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toHaveClass(/is-active/);
  });

  test('hovering the pill no longer opens the roller', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.getByTestId('relations-menu-toggle').hover();
    await page.waitForTimeout(300);

    await expect(page.getByTestId('relations-menu-list')).toHaveCount(0);
  });

  test('a click away from the roller closes it', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId('relations-menu-toggle').click();
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toBeVisible();

    // On the selected element itself: the selection holds, the list shuts.
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await expect(page.getByTestId('relations-menu-list')).toHaveCount(0);
    await expect(page.getByTestId('relations-menu-toggle')).toBeVisible();
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);
  });

  test('clicking a faded option turns the roller to it instead of acting', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    const before = await page.locator('.react-flow__viewport').getAttribute('style');

    await page.getByTestId('relations-menu-toggle').click();
    await page.getByTestId(`relation-${IDS.ledger}`).click();

    // The click chose a slot, so the camera holds still until the middle
    // option is clicked.
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toHaveClass(/is-active/);
    expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(before);

    await page.getByTestId(`relation-${IDS.ledger}`).click();
    await expect(async () => {
      expect(await page.locator('.react-flow__viewport').getAttribute('style')).not.toBe(before);
    }).toPass();
  });

  const HUB = 'hub';
  const PEERS = ['peer-1', 'peer-2', 'peer-3', 'peer-4', 'peer-5'];

  /** A hub with five peers, so a hold has room to walk before wrapping. */
  function spokeDomain(): import('@modl/core').Command[] {
    return [
      { type: 'create-entity', id: HUB, entityType: 'component', title: 'Hub', position: { x: 0, y: 240 } },
      ...PEERS.flatMap((peer, index): import('@modl/core').Command[] => [
        { type: 'create-entity', id: peer, entityType: 'component', title: `Peer ${index + 1}`, position: { x: 360, y: index * 120 } },
        { type: 'create-connection', id: `line-${index + 1}`, connectionType: 'interaction', from: [HUB], to: [peer], title: `line ${index + 1}` },
      ]),
      { type: 'set-selection', ids: [HUB] },
    ];
  }

  /** A point inside the down zone but clear of the faded pills over it. */
  async function downZonePoint(page: import('@playwright/test').Page): Promise<{ x: number; y: number }> {
    const zone = (await page.getByTestId('relations-menu-down').boundingBox())!;
    return { x: zone.x + zone.width - 8, y: zone.y + zone.height - 8 };
  }

  test('holding the zone below the middle turns slowly, then fast', async ({ page }) => {
    await dispatch(page, spokeDomain());
    await fit(page);
    await page.clock.install();

    await page.getByTestId('relations-menu-toggle').click();
    await expect(page.getByTestId('relation-peer-1')).toHaveClass(/is-active/);

    const at = await downZonePoint(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    // The press itself turns once.
    await expect(page.getByTestId('relation-peer-2')).toHaveClass(/is-active/);

    // A turn every half-second while the hold is young: two more by 1.1s.
    await page.clock.fastForward(1100);
    await expect(page.getByTestId('relation-peer-4')).toHaveClass(/is-active/);

    // Four more slow turns carry it to the three-second mark, wrapping.
    await page.clock.fastForward(1900);
    await expect(page.getByTestId('relation-peer-3')).toHaveClass(/is-active/);

    // Past three seconds the hold runs at three turns per second.
    await page.clock.fastForward(1050);
    await expect(page.getByTestId('relation-peer-1')).toHaveClass(/is-active/);

    // Release ends the hold; time alone turns nothing further.
    await page.mouse.up();
    await page.clock.fastForward(2000);
    await expect(page.getByTestId('relation-peer-1')).toHaveClass(/is-active/);
  });

  test('two fast presses in the zone turn twice without creating a component', async ({ page }) => {
    await dispatch(page, spokeDomain());
    await fit(page);
    const count = async () =>
      page.evaluate(() => Object.keys(window.__modl.getDocument().model.elements).length);
    const before = await count();

    await page.getByTestId('relations-menu-toggle').click();
    const at = await downZonePoint(page);
    // Reads as a double-click, which drops a component on the bare board.
    await page.mouse.dblclick(at.x, at.y);

    await expect(page.getByTestId('relation-peer-3')).toHaveClass(/is-active/);
    expect(await count()).toBe(before);
  });

  test('a click in the zone turns one step, not more', async ({ page }) => {
    await dispatch(page, spokeDomain());
    await fit(page);

    await page.getByTestId('relations-menu-toggle').click();
    const at = await downZonePoint(page);
    await page.mouse.click(at.x, at.y);

    await expect(page.getByTestId('relation-peer-2')).toHaveClass(/is-active/);
    await page.waitForTimeout(1100);
    await expect(page.getByTestId('relation-peer-2')).toHaveClass(/is-active/);
  });

  test('a held arrow key turns on the same two-speed clock, and stops on release', async ({ page }) => {
    await dispatch(page, spokeDomain());
    await fit(page);
    await page.clock.install();

    await page.getByTestId('relations-menu-toggle').click();
    await expect(page.getByTestId('relation-peer-1')).toHaveClass(/is-active/);

    await page.keyboard.down('ArrowDown');
    await expect(page.getByTestId('relation-peer-2')).toHaveClass(/is-active/);

    await page.clock.fastForward(1100);
    await expect(page.getByTestId('relation-peer-4')).toHaveClass(/is-active/);

    await page.keyboard.up('ArrowDown');
    await page.clock.fastForward(3000);
    await expect(page.getByTestId('relation-peer-4')).toHaveClass(/is-active/);
  });
});

test.describe('expansion tooling', () => {
  const OUTER = 'g-outer';
  const INNER_A = 'g-inner-a';
  const INNER_B = 'g-inner-b';
  const DEEP = 'g-deep';
  const LEAF_A = 'leaf-a';
  const LEAF_B = 'leaf-b';

  /** outer > inner-a > deep > leaf-a, and outer > inner-b > leaf-b. */
  function nestedDomain(): import('@modl/core').Command[] {
    return [
      { type: 'create-entity', id: LEAF_A, entityType: 'component', title: 'Leaf A', position: { x: 40, y: 40 } },
      { type: 'create-entity', id: LEAF_B, entityType: 'component', title: 'Leaf B', position: { x: 360, y: 40 } },
      { type: 'group-elements', id: DEEP, title: 'Deep', memberIds: [LEAF_A], position: { x: 20, y: 20 } },
      { type: 'group-elements', id: INNER_A, title: 'Inner A', memberIds: [DEEP], position: { x: 0, y: 0 } },
      { type: 'group-elements', id: INNER_B, title: 'Inner B', memberIds: [LEAF_B], position: { x: 340, y: 0 } },
      { type: 'group-elements', id: OUTER, title: 'Outer', memberIds: [INNER_A, INNER_B], position: { x: 0, y: 0 } },
    ];
  }

  test('a collapsed group defaults to expand, with expand all behind it', async ({ page }) => {
    await dispatch(page, [...nestedDomain(), { type: 'set-selection', ids: [OUTER] }]);
    await fit(page);

    await page.getByTestId('expansion-menu-toggle').click();

    await expect(page.getByTestId('expansion-expand')).toHaveClass(/is-active/);
    await expect(page.getByTestId('expansion-expand-all')).toBeVisible();
    // Collapsing a collapsed group would change nothing, so no such option.
    await expect(page.getByTestId('expansion-collapse')).toHaveCount(0);

    await page.getByTestId('expansion-expand').click();
    await expect(page.getByTestId(`group-${OUTER}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${INNER_A}`)).toBeVisible();
  });

  test('an open group with collapsed items defaults to collapse and hides the no-ops', async ({ page }) => {
    await dispatch(page, [
      ...nestedDomain(),
      { type: 'set-expanded', id: OUTER, expanded: true },
      { type: 'set-selection', ids: [OUTER] },
    ]);
    await fit(page);

    await page.getByTestId('expansion-menu-toggle').click();

    await expect(page.getByTestId('expansion-collapse')).toHaveClass(/is-active/);
    await expect(page.getByTestId('expansion-expand-next')).toBeVisible();
    await expect(page.getByTestId('expansion-expand-all')).toBeVisible();
    // Nothing below the group is expanded, so the two collapse sweeps hide.
    await expect(page.getByTestId('expansion-collapse-next')).toHaveCount(0);
    await expect(page.getByTestId('expansion-collapse-all')).toHaveCount(0);
  });

  test('expand next level opens one more level everywhere, and no further', async ({ page }) => {
    await dispatch(page, [
      ...nestedDomain(),
      { type: 'set-expanded', id: OUTER, expanded: true },
      { type: 'set-selection', ids: [OUTER] },
    ]);
    await fit(page);

    await page.getByTestId('expansion-menu-toggle').click();
    // The first click turns the roller to the option, the second acts.
    await page.getByTestId('expansion-expand-next').click();
    await page.getByTestId('expansion-expand-next').click();

    await expect(page.getByTestId(`group-${INNER_A}`)).toBeVisible();
    await expect(page.getByTestId(`group-${INNER_B}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${LEAF_B}`)).toBeVisible();
    // Deep sits one level further down and stays collapsed.
    await expect(page.getByTestId(`entity-${DEEP}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${LEAF_A}`)).toHaveCount(0);
  });

  test('collapse all sweeps root items first and leaves the group itself open', async ({ page }) => {
    await dispatch(page, [
      ...nestedDomain(),
      { type: 'set-expanded', id: OUTER, expanded: true },
      { type: 'set-expanded', id: INNER_A, expanded: true },
      { type: 'set-expanded', id: INNER_B, expanded: true },
      { type: 'set-expanded', id: DEEP, expanded: true },
      { type: 'set-selection', ids: [OUTER] },
    ]);
    await fit(page);

    await page.getByTestId('expansion-menu-toggle').click();
    // Everything is already expanded, so the expand sweeps hide as no-ops.
    await expect(page.getByTestId('expansion-expand-next')).toHaveCount(0);
    await page.getByTestId('expansion-collapse-all').click();
    await page.getByTestId('expansion-collapse-all').click();

    // The group itself stays open; everything inside it is put away.
    await expect(page.getByTestId(`group-${OUTER}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${INNER_A}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${LEAF_A}`)).toHaveCount(0);

    // The trace carries one command per group, root items before what they
    // contain.
    const trace = await getTrace(page);
    const swept = trace.flatMap((entry) =>
      entry.command.type === 'set-expanded' && entry.command.expanded === false
        ? [entry.command.id]
        : [],
    );
    expect(swept).toEqual([INNER_A, INNER_B, DEEP]);
  });

  test('a multi-selection expands as one group', async ({ page }) => {
    await dispatch(page, [
      ...nestedDomain(),
      { type: 'set-expanded', id: OUTER, expanded: true },
      { type: 'set-selection', ids: [INNER_A, INNER_B] },
    ]);
    await fit(page);

    await page.getByTestId('expansion-menu-toggle').click();
    // Collapsed items in the selection make expand next level the default,
    // and there is no "collapse this item": the selection is not an element.
    await expect(page.getByTestId('expansion-expand-next')).toHaveClass(/is-active/);
    await expect(page.getByTestId('expansion-collapse')).toHaveCount(0);

    await page.getByTestId('expansion-expand-next').click();

    await expect(page.getByTestId(`group-${INNER_A}`)).toBeVisible();
    await expect(page.getByTestId(`group-${INNER_B}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${DEEP}`)).toBeVisible();
  });

  test('the expansion roller and the relations menu stand apart on one group', async ({ page }) => {
    await dispatch(page, [
      ...nestedDomain(),
      { type: 'create-entity', id: 'client', entityType: 'component', title: 'Client', position: { x: -320, y: 0 } },
      { type: 'create-connection', id: 'calls', connectionType: 'interaction', from: ['client'], to: [OUTER], title: 'calls' },
      { type: 'set-selection', ids: [OUTER] },
    ]);
    await fit(page);

    const expansion = (await page.getByTestId('expansion-menu-toggle').boundingBox())!;
    const pan = (await page.getByTestId('relations-menu-toggle').boundingBox())!;
    const node = (await page.getByTestId(`entity-${OUTER}`).boundingBox())!;

    // Expansion holds the left corner and the relations menu the right, with
    // the selected group between them.
    expect(expansion.x + expansion.width).toBeLessThanOrEqual(node.x);
    expect(pan.x).toBeGreaterThanOrEqual(node.x + node.width);
  });
});

test.describe('menu docking', () => {
  /** Pans the camera through the bus and waits out the 300ms camera settle. */
  async function panTo(page: import('@playwright/test').Page, x: number, y: number): Promise<void> {
    await dispatch(page, [{ type: 'set-view', pan: { x, y }, zoom: 1 }]);
    await page.waitForTimeout(500);
  }

  test('a multi-selection docks its menus at the bottom centre', async ({ page }) => {
    const MEMBER_A = 'dock-member-a';
    const MEMBER_B = 'dock-member-b';
    const GROUP_A = 'dock-group-a';
    const GROUP_B = 'dock-group-b';
    await dispatch(page, [
      { type: 'create-entity', id: MEMBER_A, entityType: 'component', title: 'A', position: { x: 40, y: 40 } },
      { type: 'create-entity', id: MEMBER_B, entityType: 'component', title: 'B', position: { x: 340, y: 40 } },
      { type: 'group-elements', id: GROUP_A, title: 'Group A', memberIds: [MEMBER_A], position: { x: 20, y: 20 } },
      { type: 'group-elements', id: GROUP_B, title: 'Group B', memberIds: [MEMBER_B], position: { x: 320, y: 20 } },
    ]);
    await fit(page);

    await page.getByTestId(`entity-${GROUP_A}`).click();
    await page.getByTestId(`entity-${GROUP_B}`).click({ modifiers: ['ControlOrMeta'] });

    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const panel = (await page.getByTestId('selection-actions').boundingBox())!;
    expect(Math.abs(panel.x + panel.width / 2 - (pane.x + pane.width / 2))).toBeLessThan(2);
    expect(panel.y + panel.height).toBeLessThanOrEqual(pane.y + pane.height);
    expect(panel.y + panel.height).toBeGreaterThan(pane.y + pane.height - 40);

    // The expansion roller docks beside the panel, on its left.
    const expansion = (await page.getByTestId('expansion-menu-toggle').boundingBox())!;
    expect(expansion.x + expansion.width).toBeLessThanOrEqual(panel.x);
    expect(expansion.y).toBeGreaterThan(pane.y + pane.height / 2);
  });

  test('a single element panned offscreen docks its menus, and panning back re-attaches them', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    // On screen, the editor sits on the element itself.
    await expect(page.getByTestId(`editor-${IDS.gateway}`)).toBeVisible();
    await expect(page.getByTestId('docked-editor')).toHaveCount(0);

    await panTo(page, -4000, 0);

    // The element is out of reach; the same editor now sits at the dock,
    // bottom centre, fully on screen.
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const docked = (await page.getByTestId('docked-editor').boundingBox())!;
    await expect(page.getByTestId(`editor-${IDS.gateway}`)).toBeVisible();
    expect(Math.abs(docked.x + docked.width / 2 - (pane.x + pane.width / 2))).toBeLessThan(2);
    expect(docked.y).toBeGreaterThanOrEqual(pane.y);
    expect(docked.y + docked.height).toBeLessThanOrEqual(pane.y + pane.height);

    // The relations roller docks to the panel's right, on screen too.
    const toggle = (await page.getByTestId('relations-menu-toggle').boundingBox())!;
    expect(toggle.x).toBeGreaterThanOrEqual(docked.x + docked.width);
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(pane.x + pane.width);

    await panTo(page, 0, 0);

    // Back in view, the editor re-attaches under the element.
    await expect(page.getByTestId('docked-editor')).toHaveCount(0);
    const element = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
    const editor = (await page.getByTestId(`editor-${IDS.gateway}`).boundingBox())!;
    expect(Math.abs(editor.x - element.x)).toBeLessThan(5);
    expect(editor.y).toBeGreaterThan(element.y + element.height);
  });

  test('the docked roller still turns and chooses', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await panTo(page, -4000, 0);

    await page.getByTestId('relations-menu-toggle').click();
    const active = page.locator('.relations-menu .roller-menu__option.is-active');
    const first = await active.textContent();

    // A press in the step zone turns the roller one option.
    const zone = (await page.getByTestId('relations-menu-down').boundingBox())!;
    await page.mouse.click(zone.x + zone.width - 8, zone.y + zone.height - 8);
    await expect(active).not.toHaveText(first ?? '');

    // Choosing still pans: the camera centres the peer, which selects it.
    await active.click();
    await expect(async () => {
      const selection = await page.evaluate(() => window.__modl.getState().selection);
      expect(selection).toHaveLength(1);
      expect(selection[0]).not.toBe(IDS.gateway);
    }).toPass();
  });

  test('a dock flip waits while the editor holds a draft', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.getByTestId(`editor-add-tag-${IDS.gateway}`).click();
    const draft = page.getByTestId(`editor-new-tag-${IDS.gateway}`);
    await draft.pressSequentially('owner');

    await panTo(page, -4000, 0);

    // Re-homing the editor to the dock would remount it and destroy the
    // draft, so while focus sits in the editor the flip waits: the editor
    // stays on the element, mid-word, with focus intact.
    await expect(page.getByTestId('docked-editor')).toHaveCount(0);
    await expect(draft).toHaveValue('owner');
    await expect(draft).toBeFocused();

    // Typing continues, and committing the tag releases focus; the deferred
    // flip then lands with the tag on the element.
    await draft.pressSequentially('-team');
    await draft.press('Enter');
    await expect(page.getByTestId('docked-editor')).toBeVisible();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.gateway]?.tags).toMatchObject({ 'owner-team': [] });
  });

  test('the docked editor still edits: a style applies from the dock', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await panTo(page, -4000, 0);

    await page.getByTestId('docked-editor').getByTestId('style-fill-blue').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.gateway]).toMatchObject({ style: { fill: '#5b8def' } });
  });
});

test.describe('menu docking travel', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('the menus travel to the dock rather than jumping', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await dispatch(page, [{ type: 'set-view', pan: { x: -4000, y: 0 }, zoom: 1 }]);

    // The flip plays as a transition on the menu itself, then settles.
    await expect(page.locator('.relations-menu')).toHaveClass(/is-travelling/);
    await expect(page.locator('.relations-menu')).not.toHaveClass(/is-travelling/);

    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const toggle = (await page.getByTestId('relations-menu-toggle').boundingBox())!;
    expect(toggle.x).toBeGreaterThan(pane.x + pane.width / 2);
    expect(toggle.y).toBeGreaterThan(pane.y + pane.height / 2);
  });
});

test.describe('menu focus', () => {
  const CLUSTER = 'focus-cluster';
  const LEAF = 'focus-leaf';
  const PEER = 'focus-peer';

  /** A collapsed group with a relation, so one selection carries all three menus. */
  function threeMenuDomain(): import('@modl/core').Command[] {
    return [
      { type: 'create-entity', id: LEAF, entityType: 'component', title: 'Leaf', position: { x: 40, y: 40 } },
      { type: 'create-entity', id: PEER, entityType: 'component', title: 'Peer', position: { x: 520, y: 20 } },
      { type: 'group-elements', id: CLUSTER, title: 'Cluster', memberIds: [LEAF], position: { x: 20, y: 20 } },
      { type: 'create-connection', id: 'focus-line', connectionType: 'interaction', from: [CLUSTER], to: [PEER], title: 'talks to' },
    ];
  }

  test('tab cycles the selection menus and wraps', async ({ page }) => {
    await dispatch(page, threeMenuDomain());

    await page.getByTestId(`entity-${CLUSTER}`).click();

    // Left roller, bottom panel, right roller, then around again.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('expansion-menu-toggle')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(`editor-${CLUSTER}`)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('relations-menu-toggle')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('expansion-menu-toggle')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('relations-menu-toggle')).toBeFocused();
  });

  test('enter opens the focused roller and the scroll bindings turn it', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('relations-menu-toggle')).toBeFocused();

    // Enter is the entrance button's own click, so it opens like one.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);

    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toHaveClass(/is-active/);

    // Enter chooses the active option: the pan selects the peer.
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.ledger]);
  });

  test('enter moves into the panel and tab cycles its controls', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.keyboard.press('Tab');
    await expect(page.getByTestId(`editor-${IDS.gateway}`)).toBeFocused();

    // Enter steps inside: the first control is the type chip.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`editor-type-${IDS.gateway}`)).toBeFocused();

    // Tab now walks the panel's own controls and stays inside the panel.
    const editor = page.getByTestId(`editor-${IDS.gateway}`);
    for (let presses = 0; presses < 12; presses += 1) {
      await page.keyboard.press('Tab');
      expect(
        await editor.evaluate((panel) => panel.contains(document.activeElement)),
        'focus left the panel',
      ).toBe(true);
    }

    // The cancel binding steps back out to the panel's slot on the ring.
    await page.keyboard.press('Escape');
    await expect(editor).toBeFocused();
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);
  });

  test('escape steps out one level at a time and finally deselects', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toBeVisible();

    // First press: the roller closes, focus returns to its entrance, and the
    // selection holds.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('relations-menu-list')).toHaveCount(0);
    await expect(page.getByTestId('relations-menu-toggle')).toBeFocused();
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);

    // Second press reaches the cancel handler at the top level: deselect.
    await page.keyboard.press('Escape');
    await expect(async () => {
      expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([]);
    }).toPass();
  });

  test('tab with nothing selected soft-focuses elements in reading order, and enter selects', async ({ page }) => {
    await dispatch(page, sampleDomain());

    // The walk is a soft focus: visible, but never a selection.
    await page.keyboard.press('Tab');
    await expect(page.locator(`.react-flow__node[data-id="${IDS.ui}"]`)).toBeFocused();
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([]);

    await page.keyboard.press('Tab');
    await expect(page.locator(`.react-flow__node[data-id="${IDS.gateway}"]`)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator(`.react-flow__node[data-id="${IDS.ui}"]`)).toBeFocused();
    await page.keyboard.press('Tab');

    // Enter turns the soft focus into the selection, through the bus.
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);
    const trace = await getTrace(page);
    expect(trace.some((entry) => entry.command.type === 'set-selection')).toBe(true);
  });

  test('choosing through the relations roller arrives ready to keep walking', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId('relations-menu-toggle').click();

    await page.getByTestId(`relation-${IDS.gateway}`).click();

    // The destination's roller is already open and holds the keys: the next
    // stop is one turn and one Enter away, no clicks in between.
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toHaveClass(/is-active/);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.ledger]);
  });

  test('the ring works the same while the menus are docked', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    // Pan the selection out of reach, so the menus sit at the dock.
    await dispatch(page, [{ type: 'set-view', pan: { x: -4000, y: 0 }, zoom: 1 }]);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('docked-editor')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByTestId(`editor-${IDS.gateway}`)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('relations-menu-toggle')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(`editor-${IDS.gateway}`)).toBeFocused();

    // The docked roller opens and turns under the same keys.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`relation-${IDS.ledger}`)).toHaveClass(/is-active/);
  });

  test('escape disarms an armed placement without touching the selection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.getByTestId('add-element').click();
    await page.getByTestId('add-type-component').click();
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-placing', 'component');

    // Focus back on the board, then onto the ring: the press arrives from
    // inside the canvas, where a duplicate handler used to disarm and
    // deselect on the same press.
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('relations-menu-toggle')).toBeFocused();

    // One press, one level: the placement disarms, the selection holds.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-placing');
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);

    // The next press takes the next level: deselect.
    await page.keyboard.press('Escape');
    await expect(async () => {
      expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([]);
    }).toPass();
  });

  test('a tag draft escape steps out one level at a time', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();

    await page.getByTestId(`editor-add-tag-${IDS.gateway}`).click();
    await page.getByTestId(`editor-new-tag-${IDS.gateway}`).fill('tier');

    // First press abandons the draft only; focus re-seats inside the panel,
    // on the add-tag button now standing where the draft row was.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`editor-new-tag-${IDS.gateway}`)).toHaveCount(0);
    await expect(page.getByTestId(`editor-add-tag-${IDS.gateway}`)).toBeFocused();
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);
    expect((await getDocument(page)).model.elements[IDS.gateway]?.tags).not.toHaveProperty('tier');

    // Second press leaves the panel for its slot on the ring.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`editor-${IDS.gateway}`)).toBeFocused();
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([IDS.gateway]);

    // Third press deselects.
    await page.keyboard.press('Escape');
    await expect(async () => {
      expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([]);
    }).toPass();
  });
});

test.describe('styles', () => {
  test('a fill colour lands in the document and draws mostly transparent', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId('style-fill-blue').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]).toMatchObject({ style: { fill: '#5b8def' } });
    // Mostly transparent: the chosen hue at a low alpha, not a solid coat.
    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveCSS(
      'background-color',
      'rgba(91, 141, 239, 0.16)',
    );
  });

  test('stroke colour and a dashed line on a connection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await page.getByTestId('style-stroke-green').click();
    await page.getByTestId('style-line-dashed').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.authorise]).toMatchObject({
      style: { stroke: '#46a758', strokeStyle: 'dashed' },
    });

    const path = page.locator(
      `.react-flow__edge[data-id^="${IDS.authorise}"] .react-flow__edge-path`,
    );
    await expect(path).toHaveCSS('stroke', 'rgb(70, 167, 88)');
    await expect(path).toHaveCSS('stroke-dasharray', '7px, 5px');
  });

  test('a connection has no fill control, an entity no arrowhead control', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId(`connection-${IDS.authorise}`).click();
    await expect(page.getByTestId('style-stroke')).toBeVisible();
    await expect(page.getByTestId('style-fill')).toHaveCount(0);
    await expect(page.getByTestId('style-arrowhead')).toBeVisible();

    await page.getByTestId(`entity-${IDS.ui}`).click();
    await expect(page.getByTestId('style-fill')).toBeVisible();
    await expect(page.getByTestId('style-arrowhead')).toHaveCount(0);
  });

  test('an arrowhead choice swaps the marker, and triangle is the default', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await page.getByTestId('style-arrowhead-open').click();

    expect((await getDocument(page)).model.elements[IDS.authorise]).toMatchObject({
      style: { arrowhead: 'open' },
    });
    const path = page.locator(
      `.react-flow__edge[data-id^="${IDS.authorise}"] .react-flow__edge-path`,
    );
    await expect(path).toHaveAttribute('marker-end', 'url(#modl-arrow-open-default)');

    // Back to the default: the style field goes, and the shared marker returns.
    await page.getByTestId('style-arrowhead-triangle').click();
    expect((await getDocument(page)).model.elements[IDS.authorise]).not.toHaveProperty('style');
    await expect(path).toHaveAttribute('marker-end', 'url(#modl-arrow-end)');
  });

  test('the default swatch clears a colour', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId('style-fill-red').click();
    await page.getByTestId('style-fill-default').click();

    expect((await getDocument(page)).model.elements[IDS.ui]).not.toHaveProperty('style');
  });

  test('the last chosen style follows onto the next element', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId('style-fill-red').click();
    await page.getByTestId('style-stroke-red').click();

    const before = new Set(Object.keys((await getDocument(page)).model.elements));
    await page.locator('.react-flow__pane').dblclick({ position: { x: 160, y: 420 } });

    const document = await getDocument(page);
    const created = Object.keys(document.model.elements).find((id) => !before.has(id))!;
    expect(document.model.elements[created]).toMatchObject({
      style: { fill: '#e5484d', stroke: '#e5484d' },
    });
    // Explicit on the create command, so a trace replays without the session.
    const creates = (await getTrace(page)).filter(
      (entry) => entry.command.type === 'create-entity' && entry.command.id === created,
    );
    expect(creates[0]?.command).toMatchObject({ style: { fill: '#e5484d', stroke: '#e5484d' } });
  });

  test('the last chosen stroke follows onto the next connection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();
    await page.getByTestId('style-stroke-purple').click();
    await page.getByTestId('style-arrowhead-diamond').click();

    // Draw ui -> ledger by dragging between their handles.
    await page.locator('.react-flow__pane').click({ position: { x: 60, y: 500 } });
    const before = new Set(Object.keys((await getDocument(page)).model.elements));
    const from = (await page
      .locator(`.react-flow__node[data-id="${IDS.ui}"] .react-flow__handle[data-handleid="bottom"]`)
      .boundingBox())!;
    const to = (await page
      .locator(`.react-flow__node[data-id="${IDS.ledger}"] .react-flow__handle[data-handleid="bottom"]`)
      .boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();

    const document = await getDocument(page);
    const created = Object.keys(document.model.elements).find((id) => !before.has(id))!;
    expect(document.model.elements[created]).toMatchObject({
      kind: 'connection',
      style: { stroke: '#8e4ec6', arrowhead: 'diamond' },
    });
  });

  test('a multi-selection edits what each element can wear', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await page.getByTestId(`entity-${IDS.gateway}`).click({ modifiers: ['ControlOrMeta'] });
    await page
      .getByTestId(`connection-${IDS.authorise}`)
      .click({ modifiers: ['ControlOrMeta'] });

    // Fill is offered because at least one component is selected, and the
    // arrowhead because at least one connection is.
    const panel = page.getByTestId('selection-actions');
    await expect(panel.getByTestId('style-fill')).toBeVisible();
    await expect(panel.getByTestId('style-arrowhead')).toBeVisible();

    await panel.getByTestId('style-stroke-yellow').click();
    await panel.getByTestId('style-fill-yellow').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.style).toEqual({
      fill: '#e79d13',
      stroke: '#e79d13',
    });
    expect(document.model.elements[IDS.gateway]?.style).toEqual({
      fill: '#e79d13',
      stroke: '#e79d13',
    });
    // The connection took the stroke, and the fill passed it by.
    expect(document.model.elements[IDS.authorise]?.style).toEqual({ stroke: '#e79d13' });
  });

  test('styles survive save and load', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-style', id: IDS.ui, style: { fill: '#46a758', strokeStyle: 'dotted' } },
      { type: 'set-style', id: IDS.authorise, style: { stroke: '#e5484d', arrowhead: 'open' } },
    ]);

    const saved = await serialize(page);
    await page.evaluate(() => window.__modl.reset());
    await page.evaluate(
      (text) => window.__modl.dispatch({ type: 'load-document', document: JSON.parse(text) }),
      saved,
    );

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.style).toEqual({
      fill: '#46a758',
      strokeStyle: 'dotted',
    });
    expect(document.model.elements[IDS.authorise]?.style).toEqual({
      stroke: '#e5484d',
      arrowhead: 'open',
    });
  });
});

test.describe('undo and redo', () => {
  test('Ctrl+Z removes the last change and Ctrl+Y brings it back', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await expect(page.locator('.react-flow__node')).toHaveCount(3);

    await page.keyboard.press('Control+z');
    // The last document change was a set-tag, so undo it and two creations.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.post]).toBeUndefined();

    await page.keyboard.press('Control+y');
    expect((await getDocument(page)).model.elements[IDS.post]).toBeDefined();
  });

  test('Ctrl+Shift+Z also redoes', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = await serialize(page);

    await page.keyboard.press('Control+z');
    expect(await serialize(page)).not.toBe(before);

    await page.keyboard.press('Control+Shift+z');
    expect(await serialize(page)).toBe(before);
  });

  test('the board controls carry undo and redo buttons that follow the history', async ({ page }) => {
    // They live in the control cluster with the zoom buttons.
    const controls = page.locator('.react-flow__controls');
    await expect(controls.getByTestId('board-undo')).toBeVisible();
    await expect(controls.getByTestId('board-redo')).toBeVisible();

    // An empty history disables both.
    await expect(page.getByTestId('board-undo')).toBeDisabled();
    await expect(page.getByTestId('board-redo')).toBeDisabled();

    await dispatch(page, sampleDomain());
    await expect(page.getByTestId('board-undo')).toBeEnabled();
    await expect(page.getByTestId('board-redo')).toBeDisabled();

    await page.getByTestId('board-undo').click();
    await expect(page.getByTestId('board-redo')).toBeEnabled();
    // sampleDomain ends with a set-tag on the ledger, so that came off first.
    expect((await getDocument(page)).model.elements[IDS.ledger]?.tags['team']).toBeUndefined();

    await page.getByTestId('board-redo').click();
    expect((await getDocument(page)).model.elements[IDS.ledger]?.tags['team']).toEqual(['payments']);
    await expect(page.getByTestId('board-redo')).toBeDisabled();
  });

  test('selection does not enter the history, and does not kill redo', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.keyboard.press('Control+z');
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await expect(page.getByTestId('board-redo')).toBeEnabled();
    await page.keyboard.press('Control+y');
    expect((await getDocument(page)).model.elements[IDS.ledger]?.tags['team']).toEqual(['payments']);
  });

  test('Ctrl+Z inside a text field leaves the document alone', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = await serialize(page);

    await openSearch(page);
    await page.keyboard.press('Control+z');

    expect(await serialize(page)).toBe(before);
  });

  test('undo works through the runtime API', async ({ page }) => {
    await dispatch(page, sampleDomain());

    const result = await page.evaluate(() => window.__modl.undo());
    expect(result).toMatchObject({ ok: true });

    const rejected = await page.evaluate(() => {
      for (let i = 0; i < 20; i++) window.__modl.undo();
      return window.__modl.undo();
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'nothing-to-undo' } });
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(0);
  });

  test('a replayed trace can be undone and redone through the whole session', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const finished = await serialize(page);
    const trace = await getTrace(page);

    // replay() starts from a fresh state itself, keeping the document identity.
    await page.evaluate((entries) => window.__modl.replay(entries), trace);
    expect(await serialize(page)).toBe(finished);

    await page.evaluate(() => {
      while (window.__modl.getState().undo.cursor > 0) window.__modl.undo();
    });
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(0);

    await page.evaluate(() => {
      const undo = window.__modl.getState().undo;
      for (let i = undo.cursor; i < undo.history.length; i++) window.__modl.redo();
    });
    expect(await serialize(page)).toBe(finished);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
  });

  test('undoing a load restores the document that was open', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = await serialize(page);
    // An empty document with the same format, loaded over the session.
    await page.evaluate((text) => {
      const doc = JSON.parse(text) as { id: string; title: string; model: object; layout: object };
      doc.id = 'other-doc';
      doc.title = 'Other';
      doc.model = { elements: {} };
      doc.layout = {};
      window.__modl.dispatch({ type: 'load-document', document: doc as never });
    }, before);
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(0);

    await page.keyboard.press('Control+z');
    expect(await serialize(page)).toBe(before);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
  });
});

test.describe('control cluster click guard', () => {
  test('spam-clicking a disabled undo button neither creates nor clears redo', async ({ page }) => {
    await dispatch(page, sampleDomain());
    // Walk the whole history back so undo disables under the pointer.
    await page.evaluate(() => {
      while (window.__modl.getState().undo.cursor > 0) window.__modl.undo();
    });
    await expect(page.getByTestId('board-undo')).toBeDisabled();

    const box = (await page.getByTestId('board-undo').boundingBox())!;
    for (let i = 0; i < 3; i++) {
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    }

    // Nothing appeared under the button.
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(0);

    // And the redo stack survived the spam.
    await expect(page.getByTestId('board-redo')).toBeEnabled();
    await page.evaluate(() => {
      const undo = window.__modl.getState().undo;
      for (let i = undo.cursor; i < undo.history.length; i++) window.__modl.redo();
    });
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(5);
  });

  test('a double-click beside the controls, inside the guard margin, creates nothing', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = Object.keys((await getDocument(page)).model.elements).length;
    const rect = (await page.locator('.react-flow__controls').boundingBox())!;

    // A few pixels off the cluster: inside the guard, outside the buttons.
    await page.mouse.dblclick(rect.x + rect.width + 8, rect.y - 8);
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(before);

    // Well clear of the guard the double-click still creates.
    await page.mouse.dblclick(rect.x + rect.width + 300, rect.y + rect.height / 2);
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(before + 1);
  });

  test('double-clicking an enabled zoom button creates nothing', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = Object.keys((await getDocument(page)).model.elements).length;

    // The click bubbles up to the create handler; the guard turns it away.
    const box = (await page.locator('.react-flow__controls-zoomin').boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(before);
  });

  test('an armed placement click near the controls places nothing', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = Object.keys((await getDocument(page)).model.elements).length;
    await page.getByTestId('add-element').click();
    await page.getByTestId('add-type-component').click();

    const rect = (await page.locator('.react-flow__controls').boundingBox())!;
    await page.mouse.click(rect.x + rect.width + 8, rect.y - 8);

    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(before);
  });
});

test.describe('selection gestures', () => {
  const GROUP = 'pay-group';
  const SHADOW = 'shadow-1';

  /** Count of selection commands, so a test can pin one dispatch per gesture. */
  async function selectionDispatches(page: import('@playwright/test').Page): Promise<number> {
    const trace = await getTrace(page);
    return trace.filter((entry) => entry.command.type === 'set-selection').length;
  }

  async function selection(page: import('@playwright/test').Page): Promise<string[]> {
    return page.evaluate(() => [...window.__modl.getState().selection].sort());
  }

  /** Drags a selection box between two screen points with modifiers held. */
  async function boxDrag(
    page: import('@playwright/test').Page,
    keys: string[],
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    for (const key of keys) await page.keyboard.down(key);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
  }

  test('shift+drag adds a boxed region to the selection, in one dispatch', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    await page.locator(`.react-flow__node[data-id="${IDS.ui}"]`).click();
    await expect.poll(() => selection(page)).toEqual([IDS.ui]);
    const before = await selectionDispatches(page);

    const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
    const ledger = (await page.getByTestId(`entity-${IDS.ledger}`).boundingBox())!;
    await boxDrag(
      page,
      ['Shift'],
      { x: gateway.x - 25, y: gateway.y - 25 },
      { x: ledger.x + ledger.width + 25, y: ledger.y + ledger.height + 25 },
    );

    // The prior selection survives, and the box brings the two boxed nodes
    // with the connections touching them.
    await expect
      .poll(() => selection(page))
      .toEqual([IDS.ui, IDS.gateway, IDS.ledger, IDS.authorise, IDS.post].sort());
    expect(await selectionDispatches(page)).toBe(before + 1);
  });

  test('ctrl+shift+drag removes a boxed subset, in one dispatch', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-selection', ids: [IDS.ui, IDS.gateway, IDS.ledger, IDS.authorise, IDS.post] },
    ]);
    await fit(page);
    const before = await selectionDispatches(page);

    const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
    await boxDrag(
      page,
      ['Control', 'Shift'],
      { x: gateway.x - 15, y: gateway.y - 15 },
      { x: gateway.x + gateway.width + 15, y: gateway.y + gateway.height + 15 },
    );

    // The boxed node leaves, along with the connections touching it.
    await expect.poll(() => selection(page)).toEqual([IDS.ui, IDS.ledger].sort());
    expect(await selectionDispatches(page)).toBe(before + 1);
  });

  test('ctrl+click toggles an element in and out of the selection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    await page.locator(`.react-flow__node[data-id="${IDS.ui}"]`).click();
    await page.locator(`.react-flow__node[data-id="${IDS.gateway}"]`).click({
      modifiers: ['ControlOrMeta'],
    });
    await expect.poll(() => selection(page)).toEqual([IDS.ui, IDS.gateway].sort());

    const before = await selectionDispatches(page);
    await page.locator(`.react-flow__node[data-id="${IDS.gateway}"]`).click({
      modifiers: ['ControlOrMeta'],
    });
    await expect.poll(() => selection(page)).toEqual([IDS.ui]);
    expect(await selectionDispatches(page)).toBe(before + 1);
  });

  test('ctrl+click on a group toggles its visible members with it', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      // Placed below its members so its header is free of them.
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [IDS.ui, IDS.gateway], position: { x: 0, y: 260 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
      // Creating a group selects it; the toggle needs a clean start.
      { type: 'set-selection', ids: [] },
    ]);
    await fit(page);

    await page.getByTestId(`group-${GROUP}`).click({
      modifiers: ['ControlOrMeta'],
      position: { x: 140, y: 14 },
    });
    await expect.poll(() => selection(page)).toEqual([IDS.ui, IDS.gateway, GROUP].sort());

    await page.getByTestId(`group-${GROUP}`).click({
      modifiers: ['ControlOrMeta'],
      position: { x: 140, y: 14 },
    });
    await expect.poll(() => selection(page)).toEqual([]);
  });

  test('ctrl+a selects what is drawn: no collapsed members, no put-away elements', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [IDS.ui, IDS.gateway], position: { x: 0, y: 260 } },
      { type: 'create-entity', id: SHADOW, entityType: 'component', title: 'Shadow', position: { x: 800, y: 0 } },
      { type: 'set-hidden', id: SHADOW, hidden: true },
    ]);
    const before = await selectionDispatches(page);

    await page.keyboard.press('Control+a');

    // The collapsed group stands in for its members, and their internal
    // connection has nothing drawn to select. The put-away element stays out.
    await expect.poll(() => selection(page)).toEqual([IDS.ledger, IDS.post, GROUP].sort());
    expect(await selectionDispatches(page)).toBe(before + 1);
  });

  test('ctrl+a inside a text field stays with the field', async ({ page }) => {
    await dispatch(page, [...sampleDomain(), { type: 'set-selection', ids: [IDS.ledger] }]);

    await openSearch(page);
    await page.keyboard.press('Control+a');

    expect(await selection(page)).toEqual([IDS.ledger]);
  });

  test('a bare shift draws no border around the board', async ({ page }) => {
    // A click focuses the canvas div, and the browser upgrades that focus to
    // a visible ring on the first keypress, so holding the box-select
    // modifier drew a white border around the whole board (issue #45).
    await page.locator('.react-flow__pane').click({ position: { x: 200, y: 200 } });
    await page.keyboard.down('Shift');

    const outline = await page.evaluate(() => {
      const canvas = document.querySelector('.canvas')!;
      return getComputedStyle(canvas).outlineStyle;
    });
    await page.keyboard.up('Shift');

    expect(outline).toBe('none');
  });
});

test.describe('minimap', () => {
  test('is on the board, clear of the control cluster', async ({ page }) => {
    await dispatch(page, sampleDomain());

    const minimap = (await page.locator('.react-flow__minimap').boundingBox())!;
    const controls = (await page.locator('.react-flow__controls').boundingBox())!;
    expect(minimap.x).toBeGreaterThan(controls.x + controls.width);
  });

  test('a click repositions the viewport and touches nothing else', async ({ page }) => {
    await dispatch(page, sampleDomain());
    const before = await page
      .locator('.react-flow__viewport')
      .evaluate((el) => (el as HTMLElement).style.transform);

    await page.locator('.react-flow__minimap-svg').click({ position: { x: 25, y: 25 } });

    await expect
      .poll(() =>
        page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform),
      )
      .not.toBe(before);

    // The camera moved; the document and the selection did not.
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(5);
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([]);
  });

  /** The minimap rectangle drawn for one element. */
  function miniMapRect(page: import('@playwright/test').Page, id: string) {
    return page.locator(`.react-flow__minimap-node.mm-${id}`);
  }

  test('an element draws with the readable fill and a visible stroke', async ({ page }) => {
    await dispatch(page, sampleDomain());

    const rect = miniMapRect(page, IDS.ui);
    await expect(rect).toHaveCSS('fill', 'rgb(126, 136, 160)'); // #7e88a0
    await expect(rect).toHaveCSS('stroke', 'rgb(174, 183, 201)'); // #aeb7c9
  });

  test('a filtered-out element fades in the minimap and a match keeps full strength', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await setFilter(page, 'team=payments');

    await expect(miniMapRect(page, IDS.ui)).toHaveCSS('fill', 'rgb(69, 76, 92)'); // #454c5c
    await expect(miniMapRect(page, IDS.ui)).toHaveCSS('stroke', 'rgb(90, 98, 117)'); // #5a6275
    await expect(miniMapRect(page, IDS.gateway)).toHaveCSS('fill', 'rgb(126, 136, 160)');
  });

  test('an authored fill keeps its colour in the minimap, dimmed to a fainter mix', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-style', id: IDS.gateway, style: { fill: '#5b8def' } },
    ]);

    await expect(miniMapRect(page, IDS.gateway)).toHaveCSS('fill', 'rgb(91, 141, 239)');

    await setFilter(page, 'team=web');

    // #5b8def mixed at 35% over the minimap background.
    await expect(miniMapRect(page, IDS.gateway)).toHaveCSS('fill', 'rgb(47, 66, 105)');
  });

  test('an expanded container draws as a tint its members show through', async ({ page }) => {
    const GROUP = '77777777-7777-4777-8777-777777777777';
    await dispatch(page, [
      ...sampleDomain(),
      {
        type: 'group-elements',
        id: GROUP,
        title: 'Payments',
        memberIds: [IDS.gateway, IDS.ledger],
        position: { x: 280, y: 0 },
      },
    ]);
    await fit(page);
    await page.getByTestId(`expand-${GROUP}`).click();

    await expect(miniMapRect(page, GROUP)).toHaveCSS('fill', 'rgba(126, 136, 160, 0.15)');
    await expect(miniMapRect(page, GROUP)).toHaveCSS('stroke', 'rgb(174, 183, 201)');
    await expect(miniMapRect(page, IDS.gateway)).toHaveCSS('fill', 'rgb(126, 136, 160)');
  });
});

test.describe('duplication', () => {
  const GROUP = 'pay-group';

  type Point = { x: number; y: number };

  async function elementIds(page: import('@playwright/test').Page): Promise<string[]> {
    return Object.keys((await getDocument(page)).model.elements);
  }

  /** The elements a run added, in the order the document holds them. */
  async function addedSince(
    page: import('@playwright/test').Page,
    before: string[],
  ): Promise<string[]> {
    return (await elementIds(page)).filter((id) => !before.includes(id));
  }

  /** The middle of a node on screen. */
  async function centreOf(
    page: import('@playwright/test').Page,
    testId: string,
  ): Promise<Point> {
    const box = (await page.getByTestId(testId).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Holds alt and drags from one screen point to another. */
  async function altDrag(
    page: import('@playwright/test').Page,
    from: Point,
    to: Point,
  ): Promise<void> {
    await page.keyboard.down('Alt');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
  }

  /** Which node is drawn at a screen point, if any. */
  async function nodeAt(page: import('@playwright/test').Page, at: Point): Promise<string | null> {
    return page.evaluate(
      (point) =>
        (document.elementFromPoint(point.x, point.y) as HTMLElement | null)
          ?.closest<HTMLElement>('.react-flow__node')
          ?.dataset['id'] ?? null,
      at,
    );
  }

  test('alt+drag copies the element and leaves the original where it was', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    const before = await elementIds(page);

    const from = await centreOf(page, `entity-${IDS.ui}`);
    await altDrag(page, from, { x: from.x, y: from.y + 220 });

    const added = await addedSince(page, before);
    expect(added).toHaveLength(1);

    const document = await getDocument(page);
    expect(document.model.elements[added[0]!]).toMatchObject({
      kind: 'entity',
      type: 'component',
      title: 'Checkout UI',
      tags: { team: ['web'] },
    });
    // The original stayed put, and the copy sits below it.
    expect(document.layout[IDS.ui]).toMatchObject({ x: 0, y: 0 });
    expect((document.layout[added[0]!] as { y: number }).y).toBeGreaterThan(0);
    // The copy is what the reader is now holding.
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual(added);
  });

  test('alt+drag settles as one command, undone in one step', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    const from = await centreOf(page, `entity-${IDS.gateway}`);
    await altDrag(page, from, { x: from.x + 60, y: from.y + 200 });

    const trace = await getTrace(page);
    expect(trace.filter((entry) => entry.command.type === 'duplicate-elements')).toHaveLength(1);
    // No move: the original never left, so nothing about it changed.
    expect(trace.filter((entry) => entry.command.type === 'move-element')).toHaveLength(0);

    await page.evaluate(() => window.__modl.undo());
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(5);
  });

  test('alt+drag on a selection copies all of it, with the connections inside it', async ({ page }) => {
    await dispatch(page, [...sampleDomain(), { type: 'set-selection', ids: [IDS.ui, IDS.gateway] }]);
    await fit(page);
    const before = await elementIds(page);

    const from = await centreOf(page, `entity-${IDS.ui}`);
    await altDrag(page, from, { x: from.x, y: from.y + 240 });

    // Both components and the connection between them, which was not itself
    // selected. The line out to the ledger stays out: its far end is not copied.
    const added = await addedSince(page, before);
    expect(added).toHaveLength(3);

    const document = await getDocument(page);
    const copiedLink = added
      .map((id) => document.model.elements[id]!)
      .find((element) => element.kind === 'connection')!;
    expect(copiedLink.title).toBe('authorise');
    expect(added).toContain((copiedLink as { from: string[] }).from[0]);
    expect(added).toContain((copiedLink as { to: string[] }).to[0]);
  });

  test('alt+drag draws the copies where they would land, and moves nothing until released', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    const from = await centreOf(page, `entity-${IDS.ui}`);
    await page.keyboard.down('Alt');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 150, from.y + 150, { steps: 6 });

    await expect(page.getByTestId('duplicate-preview')).toHaveCount(1);
    // Nothing has been created or moved yet.
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(5);
    expect((await getDocument(page)).layout[IDS.ui]).toMatchObject({ x: 0, y: 0 });

    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(page.getByTestId('duplicate-preview')).toHaveCount(0);
  });

  test('alt+click without a drag copies nothing', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    const at = await centreOf(page, `entity-${IDS.ledger}`);
    await altDrag(page, at, at);

    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(5);
  });

  test('a copy dragged out of a group leaves it', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [IDS.ui], position: { x: 0, y: 0 } },
      { type: 'set-expanded', id: GROUP, expanded: true },
      { type: 'set-selection', ids: [] },
    ]);
    await fit(page);
    const before = await elementIds(page);

    const from = await centreOf(page, `entity-${IDS.ui}`);
    await altDrag(page, from, { x: from.x, y: from.y + 320 });

    const added = await addedSince(page, before);
    expect(added).toHaveLength(1);
    // Where a copy lands decides what holds it, the same rule a drop follows.
    expect((await getDocument(page)).model.elements[added[0]!]?.groupId).toBeNull();
  });

  test('alt+drag copies a selection built by a box, the same as one built by clicks', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    const before = await elementIds(page);

    // A box around the gateway and the ledger, rather than a click on each.
    const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
    const ledger = (await page.getByTestId(`entity-${IDS.ledger}`).boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.move(gateway.x - 25, gateway.y - 25);
    await page.mouse.down();
    await page.mouse.move(ledger.x + ledger.width + 25, ledger.y + ledger.height + 25, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    // Both components, plus every connection touching them.
    await expect
      .poll(() => page.evaluate(() => [...window.__modl.getState().selection].sort()))
      .toEqual([IDS.gateway, IDS.ledger, IDS.authorise, IDS.post].sort());

    // React Flow's rectangle over the boxed nodes is gone, so the elements
    // themselves take the press.
    await expect(page.locator('.react-flow__nodesselection')).toHaveCount(0);
    expect(await nodeAt(page, await centreOf(page, `entity-${IDS.gateway}`))).toBe(IDS.gateway);

    const from = await centreOf(page, `entity-${IDS.gateway}`);
    await altDrag(page, from, { x: from.x, y: from.y + 240 });

    // Both components and the connection between them, as clicking each would give.
    expect(await addedSince(page, before)).toHaveLength(3);
  });

  test('a boxed selection drags like any other, moving every element in it', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    const gateway = (await page.getByTestId(`entity-${IDS.gateway}`).boundingBox())!;
    const ledger = (await page.getByTestId(`entity-${IDS.ledger}`).boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.move(gateway.x - 25, gateway.y - 25);
    await page.mouse.down();
    await page.mouse.move(ledger.x + ledger.width + 25, ledger.y + ledger.height + 25, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const from = await centreOf(page, `entity-${IDS.gateway}`);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 200, { steps: 8 });
    await page.mouse.up();

    const document = await getDocument(page);
    expect((document.layout[IDS.gateway] as { y: number }).y).toBeGreaterThan(0);
    expect((document.layout[IDS.ledger] as { y: number }).y).toBeGreaterThan(0);
    // The element outside the box stayed where it was.
    expect(document.layout[IDS.ui]).toMatchObject({ x: 0, y: 0 });
  });

  test('copying a collapsed group brings its members with it', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'group-elements', id: GROUP, title: 'Payments', memberIds: [IDS.ui, IDS.gateway], position: { x: 0, y: 260 } },
    ]);
    await fit(page);
    const before = await elementIds(page);

    const from = await centreOf(page, `entity-${GROUP}`);
    await altDrag(page, from, { x: from.x + 320, y: from.y });

    // The group, both members, and the connection between them. A box copied
    // without its contents would be an empty box.
    const added = await addedSince(page, before);
    expect(added).toHaveLength(4);

    const document = await getDocument(page);
    const copiedGroup = added.find((id) => document.model.elements[id]?.title === 'Payments')!;
    const members = added.filter((id) => document.model.elements[id]?.groupId === copiedGroup);
    expect(members).toHaveLength(2);
  });

  test('ctrl+c then ctrl+v drops a copy on the pointer, and pastes chain', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);
    const before = await elementIds(page);

    await page.getByTestId(`entity-${IDS.ledger}`).click();
    await page.keyboard.press('Control+c');

    const first = { x: 260, y: 420 };
    await page.mouse.move(first.x, first.y);
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await addedSince(page, before)).length).toBe(1);
    // Centred on the cursor, so the copy is the node under it.
    expect(await nodeAt(page, first)).toBe((await addedSince(page, before))[0]);

    const second = { x: 620, y: 420 };
    await page.mouse.move(second.x, second.y);
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await addedSince(page, before)).length).toBe(2);

    // The clipboard still holds the original, so both pastes copied it.
    const document = await getDocument(page);
    for (const id of await addedSince(page, before)) {
      expect(document.model.elements[id]?.title).toBe('Ledger');
    }
  });

  test('ctrl+v with nothing copied does nothing', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    await page.mouse.move(300, 400);
    await page.keyboard.press('Control+v');

    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(5);
  });

  test('ctrl+c inside a text field stays with the field', async ({ page }) => {
    await dispatch(page, [...sampleDomain(), { type: 'set-selection', ids: [IDS.ledger] }]);

    await openSearch(page);
    await page.keyboard.press('Control+c');
    // The board's clipboard never saw it, so there is nothing to paste.
    await page.mouse.move(300, 400);
    await page.keyboard.press('Control+v');

    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(5);
  });
});

test.describe('decision labels', () => {
  const DECISION = 'authorised';
  const SECOND = 'in-stock';
  const PAID = 'paid';
  const REFUSED = 'refused';
  const ASKS = 'asks';
  const YES = 'yes';
  const NO = 'no';

  /** Checkout UI -> a decision that branches to paid and refused. */
  function branchingDomain(): import('@modl/core').Command[] {
    return [
      { type: 'create-entity', id: IDS.ui, entityType: 'component', title: 'Checkout UI', position: { x: 0, y: 120 } },
      { type: 'create-entity', id: PAID, entityType: 'component', title: 'Paid', position: { x: 520, y: 0 } },
      { type: 'create-entity', id: REFUSED, entityType: 'component', title: 'Refused', position: { x: 520, y: 240 } },
      { type: 'create-connection-node', id: DECISION, shape: 'diamond', title: 'authorised?', position: { x: 280, y: 130 } },
      { type: 'create-connection', id: ASKS, connectionType: 'interaction', from: [IDS.ui], to: [DECISION], title: 'authorise' },
      { type: 'create-connection', id: YES, connectionType: 'interaction', from: [DECISION], to: [PAID], title: '' },
      { type: 'create-connection', id: NO, connectionType: 'interaction', from: [DECISION], to: [REFUSED], title: '' },
    ];
  }

  /** Opens the relations roller on a decision that is already selected. */
  async function openMenu(page: import('@playwright/test').Page): Promise<void> {
    await page.getByTestId('relations-menu-toggle').click();
  }

  /**
   * Walks the roller to one branch and chooses it, which opens the actions
   * level. The first click turns the roller to a neighbouring pill, the
   * second chooses it, so both are sent.
   */
  async function chooseBranch(
    page: import('@playwright/test').Page,
    peerId: string,
  ): Promise<void> {
    await openMenu(page);
    await page.getByTestId(`relation-${peerId}`).click();
    await page.getByTestId(`relation-${peerId}`).click();
  }

  test('a decision offers a pill per connection, named for what it reaches', async ({ page }) => {
    await dispatch(page, [...branchingDomain(), { type: 'set-selection', ids: [DECISION] }]);
    await fit(page);

    await expect(page.getByTestId('relations-menu-toggle')).toContainText('3');
    await openMenu(page);

    await expect(page.getByTestId(`relation-${PAID}`)).toContainText('Paid');
    await expect(page.getByTestId(`relation-${REFUSED}`)).toContainText('Refused');
    // The connector's own title reads as the pill's second line.
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toContainText('authorise');
  });

  test('a junction with no connections offers no menu', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-connection-node', id: DECISION, shape: 'diamond', title: 'lonely?', position: { x: 100, y: 100 } },
      { type: 'set-selection', ids: [DECISION] },
    ]);
    await fit(page);

    await expect(page.getByTestId('relations-menu')).toHaveCount(0);
  });

  test('a branch offers going there or labelling it, and a component only pans', async ({ page }) => {
    await dispatch(page, [...branchingDomain(), { type: 'set-selection', ids: [DECISION] }]);
    await fit(page);

    await chooseBranch(page, REFUSED);

    // The roller branched rather than panning: both actions are on offer.
    await expect(page.getByTestId(`relation-go-${REFUSED}`)).toBeVisible();
    await expect(page.getByTestId(`relation-label-${NO}`)).toBeVisible();
  });

  test('a component has no answer to give, so choosing a relation still pans', async ({ page }) => {
    await dispatch(page, [...branchingDomain(), { type: 'set-selection', ids: [PAID] }]);
    await fit(page);

    await openMenu(page);
    await page.getByTestId(`relation-${DECISION}`).click();

    await expect(page.getByTestId('relation-actions')).toHaveCount(0);
    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([DECISION]);
  });

  test('going to the peer from the branch menu pans the camera', async ({ page }) => {
    await dispatch(page, [...branchingDomain(), { type: 'set-selection', ids: [DECISION] }]);
    await fit(page);

    await chooseBranch(page, REFUSED);
    await page.getByTestId(`relation-go-${REFUSED}`).click();

    expect(await page.evaluate(() => window.__modl.getState().selection)).toEqual([REFUSED]);
    const trace = await getTrace(page);
    expect(trace.some((entry) => entry.command.type === 'set-view')).toBe(true);
  });

  test('choosing a pill opens the label editor and the answer lands in the document', async ({ page }) => {
    await dispatch(page, [...branchingDomain(), { type: 'set-selection', ids: [DECISION] }]);
    await fit(page);

    await chooseBranch(page, REFUSED);
    // "go to" leads, so the label action takes a turn of its own.
    await page.getByTestId(`relation-label-${NO}`).click();
    await page.getByTestId(`relation-label-${NO}`).click();

    await page.getByTestId(`connection-label-input-${NO}`).fill('declined');
    await page.keyboard.press('Enter');

    const document = await getDocument(page);
    expect(document.model.elements[DECISION]).toMatchObject({ labels: { [NO]: 'declined' } });
  });

  test('the label travels through the command bus', async ({ page }) => {
    await dispatch(page, [
      ...branchingDomain(),
      { type: 'set-connection-label', id: DECISION, connectionId: YES, label: 'funds held' },
    ]);

    const trace = await getTrace(page);
    expect(
      trace.some(
        (entry) =>
          entry.command.type === 'set-connection-label' && entry.command.label === 'funds held',
      ),
    ).toBe(true);
  });

  test('an emptied label clears the answer', async ({ page }) => {
    await dispatch(page, [
      ...branchingDomain(),
      { type: 'set-connection-label', id: DECISION, connectionId: NO, label: 'declined' },
      { type: 'set-selection', ids: [DECISION] },
    ]);
    await fit(page);

    await chooseBranch(page, REFUSED);
    await page.getByTestId(`relation-label-${NO}`).click();
    await page.getByTestId(`relation-label-${NO}`).click();
    await page.getByTestId(`connection-label-input-${NO}`).fill('');
    await page.keyboard.press('Enter');

    expect((await getDocument(page)).model.elements[DECISION]).toMatchObject({ labels: {} });
  });

  test('a branch shows what it answers without anything being selected', async ({ page }) => {
    await dispatch(page, [
      ...branchingDomain(),
      { type: 'set-connection-label', id: DECISION, connectionId: YES, label: 'funds held' },
      { type: 'set-connection-label', id: DECISION, connectionId: NO, label: 'declined' },
    ]);
    await fit(page);

    // Part of the drawing: an unlabelled branch and a hidden answer would
    // otherwise look the same.
    await expect(page.getByTestId(`decision-label-${DECISION}-${YES}`)).toHaveText('funds held');
    await expect(page.getByTestId(`decision-label-${DECISION}-${NO}`)).toHaveText('declined');
    await expect(page.getByTestId(`decision-label-${DECISION}-${YES}`)).not.toHaveClass(/is-read/);
  });

  test('a branch with no answer written against it draws nothing', async ({ page }) => {
    await dispatch(page, branchingDomain());
    await fit(page);

    await expect(page.getByTestId(`decision-label-${DECISION}-${YES}`)).toHaveCount(0);
  });

  test('selecting the decision brings its answers forward', async ({ page }) => {
    await dispatch(page, [
      ...branchingDomain(),
      { type: 'set-connection-label', id: DECISION, connectionId: YES, label: 'funds held' },
      { type: 'set-selection', ids: [DECISION] },
    ]);
    await fit(page);

    await expect(page.getByTestId(`decision-label-${DECISION}-${YES}`)).toHaveClass(/is-read/);
  });

  test('selecting a line shows the answer from each decision it touches', async ({ page }) => {
    // A second decision on the far end of the "paid" line, so the one line
    // answers to both.
    await dispatch(page, [
      ...branchingDomain(),
      { type: 'create-connection-node', id: SECOND, shape: 'diamond', title: 'in stock?', position: { x: 520, y: 0 } },
      { type: 'set-endpoints', id: YES, from: [DECISION], to: [SECOND] },
      { type: 'set-connection-label', id: DECISION, connectionId: YES, label: 'funds held' },
      { type: 'set-connection-label', id: SECOND, connectionId: YES, label: 'checking stock' },
      { type: 'set-selection', ids: [YES] },
    ]);
    await fit(page);

    await expect(page.getByTestId(`decision-label-${DECISION}-${YES}`)).toHaveClass(/is-read/);
    await expect(page.getByTestId(`decision-label-${SECOND}-${YES}`)).toHaveClass(/is-read/);
    // The decision's other branch has no answer written against it.
    await expect(page.getByTestId(`decision-label-${DECISION}-${NO}`)).toHaveCount(0);
  });

  test('turning the roller emphasises the connector it points at', async ({ page }) => {
    await dispatch(page, [...branchingDomain(), { type: 'set-selection', ids: [DECISION] }]);
    await fit(page);

    await openMenu(page);
    await expect(page.getByTestId(`connection-${ASKS}`)).toHaveClass(/is-highlighted/);

    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`connection-${NO}`)).toHaveClass(/is-highlighted/);
    await expect(page.getByTestId(`connection-${ASKS}`)).not.toHaveClass(/is-highlighted/);
  });

  test('the step zones turn the roller, wrapping at the ends', async ({ page }) => {
    await dispatch(page, [...branchingDomain(), { type: 'set-selection', ids: [DECISION] }]);
    await fit(page);

    await openMenu(page);
    await expect(page.getByTestId(`relation-${IDS.ui}`)).toHaveClass(/is-active/);

    // Clicks land in a zone corner, clear of the faded pills drawn over it.
    await page.getByTestId('relations-menu-down').click({ position: { x: 150, y: 80 } });
    await expect(page.getByTestId(`relation-${REFUSED}`)).toHaveClass(/is-active/);

    await page.getByTestId('relations-menu-up').click({ position: { x: 150, y: 8 } });
    await page.getByTestId('relations-menu-up').click({ position: { x: 150, y: 8 } });
    // Up from the first wraps round to the last.
    await expect(page.getByTestId(`relation-${PAID}`)).toHaveClass(/is-active/);
  });

  test('a label survives a save and a load', async ({ page }) => {
    await dispatch(page, [
      ...branchingDomain(),
      { type: 'set-connection-label', id: DECISION, connectionId: YES, label: 'funds held' },
    ]);

    const saved = await serialize(page);
    expect(JSON.parse(saved).model.elements[DECISION].labels).toEqual({ [YES]: 'funds held' });

    await page.evaluate((text) => {
      const document = JSON.parse(text);
      window.__modl.dispatch({ type: 'load-document', document });
    }, saved);

    expect((await getDocument(page)).model.elements[DECISION]).toMatchObject({
      labels: { [YES]: 'funds held' },
    });
  });
});

test.describe('comments', () => {
  const NOTE = 'is-this-current';
  const NOTE2 = 'second-thought';

  /** The sample domain with one comment discussing the UI and the gateway. */
  function commentedDomain() {
    return [
      ...sampleDomain(),
      {
        type: 'create-comment' as const,
        id: NOTE,
        text: 'Retry on timeout is assumed here',
        targets: [IDS.ui, IDS.gateway],
      },
    ];
  }

  test('a badge marks everything a comment discusses, and only that', async ({ page }) => {
    await dispatch(page, commentedDomain());
    await fit(page);

    await expect(page.getByTestId(`comment-badge-${IDS.ui}`)).toBeVisible();
    await expect(page.getByTestId(`comment-badge-${IDS.gateway}`)).toBeVisible();
    await expect(page.getByTestId(`comment-badge-${IDS.ledger}`)).toHaveCount(0);
  });

  test('the text stays folded until a discussed element is selected', async ({ page }) => {
    await dispatch(page, commentedDomain());
    await fit(page);

    await expect(page.getByTestId(`comment-card-${NOTE}`)).toHaveCount(0);

    // Selecting a target shows the one movable card, in model mode.
    await dispatch(page, [{ type: 'set-selection', ids: [IDS.ui, IDS.gateway] }]);
    const card = page.getByTestId(`comment-card-${NOTE}`);
    await expect(card).toBeVisible();
    // One comment on two elements says so, or it reads as two copies.
    await expect(card.locator('.comment-card__meta')).toHaveText(
      'one comment across 2 elements',
    );
  });

  test('selecting the comment itself shows its text and highlights its targets', async ({ page }) => {
    // The highlight keeps everything one connection away readable, so the
    // element that must dim is one nothing in the selection touches.
    const APART = 'floating-note-pad';
    await dispatch(page, [
      ...commentedDomain(),
      { type: 'create-entity', id: APART, entityType: 'component', title: 'Apart', position: { x: 0, y: 300 } },
    ]);
    await fit(page);

    await dispatch(page, [{ type: 'set-selection', ids: [NOTE] }]);
    await expect(page.getByTestId(`comment-card-${NOTE}`)).toBeVisible();
    await expect(page.getByTestId(`entity-${APART}`)).toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
  });

  test('pressing c with a selection opens the overlay and a card for it', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await fit(page);

    await dispatch(page, [{ type: 'set-selection', ids: [IDS.ui, IDS.gateway] }]);
    await page.keyboard.press('c');
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-comment-overlay', 'true');

    const editor = page.locator('[data-testid^="comment-text-box-"]');
    await editor.fill('this pair is provisional');
    await page.getByTestId('canvas').click({ position: { x: 40, y: 400 } });

    const document = await getDocument(page);
    const written = Object.values(document.comments)[0];
    expect(written).toMatchObject({
      text: 'this pair is provisional',
      targets: [IDS.ui, IDS.gateway],
    });
  });

  test('the comment filter narrows the board to what is discussed', async ({ page }) => {
    await dispatch(page, commentedDomain());
    await fit(page);

    await setFilter(page, 'comment');
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-dimmed/);

    await setFilter(page, 'comment=retry');
    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);
  });

  test('the search menu finds a comment from its words', async ({ page }) => {
    await dispatch(page, [
      ...commentedDomain(),
      {
        type: 'create-comment' as const,
        id: NOTE2,
        text: 'rename the ledger',
        targets: [IDS.ledger],
      },
    ]);
    await fit(page);

    await openSearch(page);
    await page.getByTestId('search-input').fill('retry on timeout');
    // The option says which kind of filter it is, so a comment filter and a
    // tag that happens to read alike tell apart in the list.
    await expect(
      page.getByTestId('search-comment-comment-retry-on-timeout').locator('.search-menu__option-kind'),
    ).toHaveText('filter by comment');
    await page.getByTestId('search-comment-comment-retry-on-timeout').click();

    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).toHaveClass(/is-dimmed/);
  });

  test('a tag named "comment" shows in search beside the comment filter', async ({ page }) => {
    await dispatch(page, [
      ...commentedDomain(),
      { type: 'set-tag', id: IDS.ledger, key: 'comment', values: ['todo'] },
    ]);
    await fit(page);

    await openSearch(page);
    await page.getByTestId('search-input').fill('comment');

    // Both filters are offered: the tag through its quoted key, the comment
    // filter through the reserved word, each marked with its kind.
    await expect(page.getByTestId('search-tag-comment-todo')).toBeVisible();
    await expect(page.getByTestId('search-comment-comment')).toBeVisible();
    await expect(
      page.getByTestId('search-tag-comment-todo').locator('.search-menu__option-kind'),
    ).toHaveText('filter by tag');

    // Choosing the tag narrows to the tagged element, so the reserved word
    // did not swallow the tag filter.
    await page.getByTestId('search-tag-comment-todo').click();
    await expect(page.getByTestId(`entity-${IDS.ledger}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveClass(/is-dimmed/);
  });

  test('a comment survives a save and a load', async ({ page }) => {
    await dispatch(page, commentedDomain());

    const saved = await serialize(page);
    expect(JSON.parse(saved).comments[NOTE].targets).toEqual([IDS.ui, IDS.gateway].sort());

    await page.evaluate((text) => {
      const document = JSON.parse(text);
      window.__modl.dispatch({ type: 'load-document', document });
    }, saved);

    expect((await getDocument(page)).comments[NOTE]).toMatchObject({
      text: 'Retry on timeout is assumed here',
    });
  });

  test('deleting the last discussed element takes the comment with it', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'create-comment' as const, id: NOTE, text: 'only about the ledger', targets: [IDS.ledger] },
      { type: 'delete-element', id: IDS.ledger },
    ]);

    expect(Object.keys((await getDocument(page)).comments)).toHaveLength(0);
  });
});

test.describe('discussion overlay', () => {
  const FIRST = 'first-remark';
  const SECOND = 'second-remark';
  const GENERAL = 'board-remark';

  /** The sample domain with two attached comments and one general remark. */
  function discussedDomain() {
    return [
      ...sampleDomain(),
      {
        type: 'create-comment' as const,
        id: FIRST,
        text: 'retry on timeout is assumed here',
        targets: [IDS.ui, IDS.gateway],
        createdAt: '2026-08-10T09:00:00Z',
      },
      {
        type: 'create-comment' as const,
        id: SECOND,
        text: 'rename the ledger',
        targets: [IDS.ledger],
        createdAt: '2026-08-10T10:00:00Z',
      },
      {
        type: 'create-comment' as const,
        id: GENERAL,
        text: 'should this board split in two?',
        targets: [],
        createdAt: '2026-08-10T11:00:00Z',
      },
    ];
  }

  async function state(page: import('@playwright/test').Page) {
    return page.evaluate(() => window.__modl.getState());
  }

  test('c opens the overlay, escape with nothing selected closes it', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);

    await page.keyboard.press('c');
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-comment-overlay', 'true');
    await expect(page.getByTestId(`comment-card-${FIRST}`)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-comment-overlay', 'true');
    await expect(page.getByTestId(`comment-card-${FIRST}`)).toHaveCount(0);
  });

  test('the mode toggle is the other way in and out', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);

    await page.getByTestId('overlay-discussion').click();
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-comment-overlay', 'true');
    await page.getByTestId('overlay-model').click();
    await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-comment-overlay', 'true');
  });

  test('a general remark is a card on the board like any other', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);
    await page.keyboard.press('c');

    // Unpinned (as from a file), it draws beside the content, and dragging
    // pins it like any other card. Its timeline entry pans the camera to it
    // first, since "beside the content" sits outside the fitted framing.
    await page.getByTestId(`timeline-entry-${GENERAL}`).click();
    await page.waitForTimeout(400);
    const card = page.getByTestId(`comment-card-${GENERAL}`);
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 8);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + 60, { steps: 4 });
    await page.mouse.up();
    expect((await getDocument(page)).layout[GENERAL]).toBeDefined();
  });

  test('a general remark stays visible in model mode, dimmed until read', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);

    // No overlay: the remark is still on the board, quiet.
    const card = page.getByTestId(`comment-card-${GENERAL}`);
    await expect(card).toHaveClass(/is-ambient/);

    await dispatch(page, [{ type: 'set-selection', ids: [GENERAL] }]);
    await expect(card).not.toHaveClass(/is-ambient/);
  });

  test('the timeline walks the discussion in writing order', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);
    await page.keyboard.press('c');

    // Entries carry the writing time and the words, not an abstract mark.
    const entry = page.getByTestId(`timeline-entry-${FIRST}`);
    await expect(entry.locator('.comment-timeline__snippet')).toContainText('retry on timeout');
    await expect(entry.locator('.comment-timeline__time')).not.toBeEmpty();

    await entry.click();
    expect((await state(page)).selection).toEqual([FIRST]);

    await page.keyboard.press('ArrowDown');
    expect((await state(page)).selection).toEqual([SECOND]);
    await page.keyboard.press('ArrowUp');
    expect((await state(page)).selection).toEqual([FIRST]);
  });

  test('escape deselects before it leaves the overlay', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);
    await page.keyboard.press('c');

    await page.getByTestId(`timeline-entry-${FIRST}`).click();
    expect((await state(page)).selection).toEqual([FIRST]);

    await page.keyboard.press('Escape');
    expect((await state(page)).selection).toEqual([]);
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-comment-overlay', 'true');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-comment-overlay', 'true');
  });

  test('one click on an element opens its discussion, or a fresh card', async ({ page }) => {
    const BARE = 'floating-note-pad';
    await dispatch(page, [
      ...discussedDomain(),
      { type: 'create-entity', id: BARE, entityType: 'component', title: 'Apart', position: { x: 0, y: 300 } },
    ]);
    await fit(page);
    await page.keyboard.press('c');

    // An element already discussed opens its latest comment for editing.
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await expect(page.getByTestId(`comment-text-box-${FIRST}`)).toBeVisible();
    // Clicking off keeps a comment that has words.
    await page.getByTestId('canvas').click({ position: { x: 60, y: 500 } });
    expect((await getDocument(page)).comments[FIRST]).toBeDefined();

    // An element with no discussion gets a fresh card; abandoning it empty
    // deletes it.
    await page.getByTestId(`entity-${BARE}`).click();
    const editor = page.locator('[data-testid^="comment-text-box-"]');
    await expect(editor).toBeVisible();
    await page.getByTestId('canvas').click({ position: { x: 60, y: 500 } });
    await expect(editor).toHaveCount(0);
    expect(Object.keys((await getDocument(page)).comments)).toHaveLength(3);

    // The element selection UI never showed for any of it.
    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-selected/);
  });

  test('ctrl+click while a card is open toggles what it discusses', async ({ page }) => {
    const BARE = 'floating-note-pad';
    await dispatch(page, [
      ...discussedDomain(),
      { type: 'create-entity', id: BARE, entityType: 'component', title: 'Apart', position: { x: 0, y: 300 } },
    ]);
    await fit(page);
    await page.keyboard.press('c');

    await page.getByTestId(`entity-${BARE}`).click();
    const editor = page.locator('[data-testid^="comment-text-box-"]');
    await editor.fill('does this belong with the UI?');

    await page.getByTestId(`entity-${IDS.ui}`).click({ modifiers: ['Control'] });
    const card = page.locator('.comment-card', { hasText: 'does this belong' });
    await expect(card.locator('.comment-card__meta')).toHaveText('one comment across 2 elements');

    await page.getByTestId(`entity-${IDS.ui}`).click({ modifiers: ['Control'] });
    await expect(card.locator('.comment-card__meta')).toBeHidden();

    await page.getByTestId('canvas').click({ position: { x: 60, y: 500 } });
    const written = Object.values((await getDocument(page)).comments).find(
      (comment) => comment.text === 'does this belong with the UI?',
    );
    expect(written?.targets).toEqual([BARE]);
  });

  test('double-clicking empty board writes a general remark', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);
    await page.keyboard.press('c');

    await page.getByTestId('canvas').dblclick({ position: { x: 60, y: 500 } });
    const editor = page.locator('[data-testid^="comment-text-box-"]');
    await editor.fill('a remark about everything');
    await page.getByTestId('canvas').click({ position: { x: 60, y: 560 } });

    const written = Object.values((await getDocument(page)).comments).find(
      (comment) => comment.text === 'a remark about everything',
    );
    expect(written?.targets).toEqual([]);
    // The remark landed where it was written: pinned at the double-click.
    expect((await getDocument(page)).layout[written!.id]).toBeDefined();
    // No element was created by the double-click.
    expect(Object.keys((await getDocument(page)).model.elements)).toHaveLength(5);
  });

  test('a pane click in the overlay pulses a card ghost, never the gravity wave', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);
    await page.keyboard.press('c');

    await page.getByTestId('canvas').click({ position: { x: 60, y: 500 } });
    await expect(page.getByTestId('comment-ghost')).toBeVisible();
    // The single click wrote nothing; the ghost only says what a double
    // click would do.
    expect(Object.keys((await getDocument(page)).comments)).toHaveLength(3);
  });

  test('a dragged card is pinned, and its arc follows during the drag', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);
    await page.keyboard.press('c');

    // Centre the card first: near the right edge it sits under the
    // timeline's entries, which take the pointer.
    await page.getByTestId(`timeline-entry-${SECOND}`).click();
    await page.waitForTimeout(400);

    const arc = page.getByTestId(`comment-arc-${SECOND}-0`);
    const before = await arc.getAttribute('x1');

    const card = page.getByTestId(`comment-card-${SECOND}`);
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 8);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + 88, { steps: 5 });

    // Mid-drag, the button still down: the arc has already moved with the card.
    expect(await arc.getAttribute('x1')).not.toBe(before);
    await page.mouse.up();

    const layout = (await getDocument(page)).layout[SECOND];
    expect(layout).toBeDefined();
    expect('x' in layout!).toBe(true);
  });

  test('the filter gates what the overlay can touch', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);
    await setFilter(page, 'team=web');
    await page.keyboard.press('c');

    // The gateway does not match team=web, so clicking it opens nothing.
    await page.getByTestId(`entity-${IDS.gateway}`).click({ force: true });
    await expect(page.locator('[data-testid^="comment-text-box-"]')).toHaveCount(0);

    // The UI matches, so its discussion opens.
    await page.getByTestId(`entity-${IDS.ui}`).click();
    await expect(page.getByTestId(`comment-text-box-${FIRST}`)).toBeVisible();
  });

  test('arcs follow an element while it is dragged in model mode', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);

    await dispatch(page, [{ type: 'set-selection', ids: [IDS.ledger] }]);
    const arc = page.getByTestId(`comment-arc-${SECOND}-0`);
    await expect(arc).toHaveCount(1);
    const before = await arc.getAttribute('x2');

    const node = await page.getByTestId(`entity-${IDS.ledger}`).boundingBox();
    await page.mouse.move(node!.x + node!.width / 2, node!.y + node!.height / 2);
    await page.mouse.down();
    await page.mouse.move(node!.x + node!.width / 2 - 100, node!.y + node!.height / 2 - 40, {
      steps: 5,
    });

    // Mid-drag, the button still down: the arc already points at the element.
    expect(await arc.getAttribute('x2')).not.toBe(before);
    await page.mouse.up();
  });

  test('in model mode the card selects, edits, and deletes without opening the overlay', async ({ page }) => {
    await dispatch(page, discussedDomain());
    await fit(page);

    await dispatch(page, [{ type: 'set-selection', ids: [IDS.ledger] }]);
    const card = page.getByTestId(`comment-card-${SECOND}`);
    await expect(card).toBeVisible();

    // A drag only moves the card: the element stays selected, the comment
    // stays unselected, and the card stays where the reader can see it.
    const box = await card.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 8);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 - 90, box!.y + 60, { steps: 4 });
    await page.mouse.up();
    expect((await state(page)).selection).toEqual([IDS.ledger]);

    await card.click();
    expect((await state(page)).selection).toEqual([SECOND]);
    await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-comment-overlay', 'true');

    await page.keyboard.press('Delete');
    expect((await getDocument(page)).comments[SECOND]).toBeUndefined();
    await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-comment-overlay', 'true');
  });
});

test.describe('first-open expansion (issue #50)', () => {
  /** One group holding one member, with the given first-open hint. */
  function groupedDocument(defaultExpanded?: true | string[]) {
    return {
      formatVersion: 8,
      id: 'grouped-doc',
      title: 'Grouped',
      model: {
        elements: {
          box: { id: 'box', kind: 'entity', type: 'component', title: 'Box',
                 description: '', tags: {}, sources: [], groupId: null },
          member: { id: 'member', kind: 'entity', type: 'component', title: 'Member',
                    description: '', tags: {}, sources: [], groupId: 'box' },
        },
      },
      comments: {},
      layout: {},
      view: {
        pan: { x: 0, y: 0 },
        zoom: 1,
        ...(defaultExpanded === undefined ? {} : { defaultExpanded }),
      },
    };
  }

  test('a document hinting `true` opens with its group expanded', async ({ page }) => {
    const result = await page.evaluate(
      (doc) => window.__modl.dispatch({ type: 'load-document', document: doc as never }),
      groupedDocument(true),
    );
    expect(result.ok).toBe(true);
    await expect(page.getByTestId('entity-member')).toBeVisible();
  });

  test('a document without the hint opens collapsed', async ({ page }) => {
    await page.evaluate(
      (doc) => window.__modl.dispatch({ type: 'load-document', document: doc as never }),
      groupedDocument(),
    );
    await expect(page.getByTestId('entity-box')).toBeVisible();
    await expect(page.getByTestId('entity-member')).toHaveCount(0);
  });

  test('the toggle captures the current expansion into the saved file', async ({ page }) => {
    const GROUP = '77777777-7777-4777-8777-777777777777';
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'create-entity', id: GROUP, entityType: 'component', title: 'Payments', position: { x: 900, y: 0 } },
      { type: 'set-group', id: IDS.gateway, groupId: GROUP },
      { type: 'set-expanded', id: GROUP, expanded: true },
    ]);

    await page.getByTestId('first-open-toggle').click();
    await page.getByTestId('save').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved');

    const saved = JSON.parse((await savedFile(page, 'Untitled domain.modl.json'))!);
    expect(saved.view.defaultExpanded).toEqual([GROUP]);
  });

  test('pressing the toggle again clears the hint', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-default-expanded', defaultExpanded: true },
    ]);

    await page.getByTestId('first-open-toggle').click();

    expect((await getDocument(page)).view.defaultExpanded).toBeUndefined();
  });
});
