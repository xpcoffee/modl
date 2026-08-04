import { expect, test } from '@playwright/test';
import { dispatch, fit, getDocument, getTrace, IDS, open, sampleDomain, serialize } from './support.js';

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

  test('dragging an expanded group carries its members', async ({ page }) => {
    await groupPaymentsSide(page);
    await page.getByTestId(`expand-${GROUP}`).click();
    await fit(page);
    const before = await getDocument(page);

    // Grab the group header, away from any member inside it.
    await page.getByTestId(`collapse-${GROUP}`).hover();
    await page.mouse.move(0, 0);
    const header = await page.getByTestId(`group-${GROUP}`).boundingBox();
    await page.mouse.move(header!.x + header!.width - 30, header!.y + 12);
    await page.mouse.down();
    await page.mouse.move(header!.x + header!.width - 30 + 120, header!.y + 12 + 90, { steps: 12 });
    await page.mouse.up();

    const after = await getDocument(page);
    // Members moved with the container, so the group did not spring back.
    for (const id of [IDS.gateway, IDS.ledger]) {
      expect(after.layout[id]).not.toEqual(before.layout[id]);
    }
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

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags).toMatchObject({ tier: [] });
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

    await page.getByTestId('filter-input').fill('team=payments');

    await expect(page.getByTestId(`entity-${IDS.ui}`)).toHaveClass(/is-dimmed/);
    await expect(page.getByTestId(`entity-${IDS.gateway}`)).not.toHaveClass(/is-dimmed/);
    await expect(page.getByTestId('element-count')).toContainText('2 of 5');
  });

  test('keeps a half-typed expression on screen and reports it', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId('filter-input').fill('=broken');

    await expect(page.getByTestId('filter-input')).toHaveValue('=broken');
    await expect(page.getByTestId('filter-error')).toBeVisible();
    // Everything stays readable while the expression is unparseable.
    await expect(page.getByTestId(`entity-${IDS.ui}`)).not.toHaveClass(/is-dimmed/);
  });

  test('suggests recorded values for the key being typed', async ({ page }) => {
    await dispatch(page, sampleDomain());

    await page.getByTestId('filter-input').fill('team=');

    const options = await page
      .locator('#filter-suggestions option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    expect(options).toContain('team=payments');
    expect(options).toContain('team=web');
  });

  test('clearing the filter restores every element', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId('filter-input').fill('team=web');
    await page.getByTestId('filter-clear').click();

    await expect(page.getByTestId('element-count')).toContainText('5 elements');
  });
});

test.describe('save and load', () => {
  test('saves the document the store holds', async ({ page }) => {
    await dispatch(page, sampleDomain());

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('save').click(),
    ]);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);

    expect(Buffer.concat(chunks).toString('utf8')).toBe(await serialize(page));
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

  test('delete follows a dragged selection before the drop', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.gateway}`).click();
    await page.getByTestId(`entity-${IDS.ledger}`).click({ modifiers: ['ControlOrMeta'] });

    const before = (await page.getByTestId('delete-selected').boundingBox())!;
    await page.locator(`.react-flow__node[data-id="${IDS.gateway}"]`).hover();
    await page.mouse.down();
    await page.mouse.move(300, 560, { steps: 12 });

    // Still mid-drag, before any command has fired.
    const during = (await page.getByTestId('delete-selected').boundingBox())!;
    expect(during.y).not.toBe(before.y);
    await page.mouse.up();
  });

  test('deletes a single selection', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ledger}`).click();

    await page.getByTestId('delete-selected').click();

    expect((await getDocument(page)).model.elements[IDS.ledger]).toBeUndefined();
  });

  test('deletes a multi-selection and says how many', async ({ page }) => {
    await dispatch(page, sampleDomain());
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

    await page.getByTestId('filter-input').fill('flow=refund');

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

  test('a round one keeps handles to drag from, and anchors lines at its middle', async ({ page }) => {
    await dispatch(page, [
      { type: 'create-connection-node', id: 'junction', shape: 'circle', title: '', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: 'target', entityType: 'component', title: 'T', position: { x: 400, y: 0 } },
      { type: 'create-connection', id: 'out', connectionType: 'interaction', from: ['junction'], to: ['target'], title: '' },
    ]);
    await fit(page);

    // One contact point, at the middle. The four handles stacked there differ
    // only in the direction they face, so a line's tangent turns with it.
    const node = page.locator('.react-flow__node[data-id="junction"]');
    await expect(node.locator('.react-flow__handle:not(.handle--centre)')).toHaveCount(0);
    await expect(node.locator('.handle--centre')).toHaveCount(4);

    const centres = await node.locator('.handle--centre').evaluateAll((handles) =>
      handles.map((handle) => {
        const box = handle.getBoundingClientRect();
        return `${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height / 2)}`;
      }),
    );
    expect(new Set(centres).size).toBe(1);

    // The line leaves from the middle of the circle, not one of its sides.
    const box = (await page.evaluate(
      () => window.__modl.getDocument().layout['junction'],
    )) as { x: number; y: number; width: number; height: number };
    const d = (await page
      .locator('.react-flow__edge[data-id^="out"] .react-flow__edge-path')
      .getAttribute('d'))!;
    const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    // Within a handle's width of the middle, and nowhere near a side.
    expect(Math.abs(numbers[0]! - (box.x + box.width / 2))).toBeLessThan(8);
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
