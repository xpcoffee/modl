import { expect, test } from '@playwright/test';
import { dispatch, getDocument, getTrace, IDS, open, sampleDomain, serialize } from './support.js';

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
      .poll(() => page.evaluate(() => window.__domainMapper.getState().selection.length))
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
        window.__domainMapper.dispatch({
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

test.describe('inspector', () => {
  test('edits the title of the selected element', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId('inspector-title').fill('Renamed');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.title).toBe('Renamed');
  });

  test('creates a tag as soon as the key is typed', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    // No confirm step: typing the key is enough, matching how the title behaves.
    await page.getByTestId('tag-key').fill('tier');

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

  test('removes a tag', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByLabel('Remove tag team').click();

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]?.tags['team']).toBeUndefined();
  });

  test('changes the type of an element', async ({ page }) => {
    await dispatch(page, sampleDomain());
    await page.getByTestId(`entity-${IDS.ui}`).click();

    await page.getByTestId('inspector-type').selectOption('state');

    const document = await getDocument(page);
    expect(document.model.elements[IDS.ui]).toMatchObject({ type: 'state' });
  });

  test('prompts when nothing is selected', async ({ page }) => {
    await expect(page.getByTestId('inspector')).toContainText('Select an element');
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
      name: 'broken.dmap.json',
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
      name: 'domain.dmap.json',
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
      (entries) => window.__domainMapper.replay(entries),
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
      (entries) => window.__domainMapper.replay(entries),
      trace,
    );
    expect(result.divergences).toBe(0);
  });
});
