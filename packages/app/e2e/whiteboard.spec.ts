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
  test('the toolbar creates an entity', async ({ page }) => {
    await page.getByTestId('add-entity').click();

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
    expect(document.model.elements[IDS.ui]?.tags).toMatchObject({ tier: '' });
  });

  test('edits a tag value in place', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByLabel('Tag value for team').fill('platform');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags['team']).toBe('platform');
  });

  test('renames a tag key as one command', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByLabel('Tag key team').fill('squad');
    await page.getByTestId(`editor-description-${IDS.ui}`).click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags).toEqual({ squad: 'web' });

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
  test('arrowheads are off until switched on', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`connection-${IDS.authorise}`).click();

    await page.getByTestId(`editor-arrow-end-${IDS.authorise}`).click();

    const document = await getDocument(page);
    expect(document.layout[IDS.authorise]).toMatchObject({ arrowEnd: true });
    await expect(
      page.locator(`.react-flow__edge[data-id^="${IDS.authorise}"] .react-flow__edge-path`),
    ).toHaveAttribute('marker-end', 'url(#modl-arrow-end)');
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

  test('waypoints and arrowheads survive save and load', async ({ page }) => {
    await dispatch(page, [
      ...sampleDomain(),
      { type: 'set-waypoints', id: IDS.authorise, waypoints: [{ x: 200, y: 120 }] },
      { type: 'set-arrowheads', id: IDS.authorise, start: false, end: true },
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
