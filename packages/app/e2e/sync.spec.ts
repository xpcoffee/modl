import { expect, test, type Page } from '@playwright/test';
import {
  dispatch,
  getDocument,
  IDS,
  open,
  sampleDomain,
  savedFile,
  serialize,
  setFilter,
  writeFileOutside,
} from './support.js';

/**
 * Sync mode: the board writes every change to the open file and takes the
 * file's own changes as they arrive. See docs/decisions/032-file-sync.md.
 * The fake file handles in `support.ts` stand in for the disk, and
 * `writeFileOutside` is an agent editing the document.
 */

const FILE = 'Untitled domain.modl.json';
const LEDGER = '66666666-6666-4666-8666-666666666666';

test.beforeEach(async ({ page }) => {
  await open(page);
});

/** A saved board with sync running, which is where every test here starts. */
async function startSync(page: Page): Promise<void> {
  await dispatch(page, sampleDomain());
  await page.getByTestId('save').click();
  await expect(page.getByTestId('toolbar-message')).toContainText('Saved');
  await page.getByTestId('sync').click();
  await expect(page.getByTestId('sync-status')).toContainText('wrote');
}

/** The file as an agent would rewrite it: parsed, edited, written back. */
async function editFileOutside(
  page: Page,
  edit: (raw: Record<string, unknown>) => void,
): Promise<void> {
  const text = await savedFile(page, FILE);
  if (text === undefined) throw new Error(`${FILE} has not been written`);
  const raw = JSON.parse(text) as Record<string, unknown>;
  edit(raw);
  await writeFileOutside(page, FILE, `${JSON.stringify(raw, null, 2)}\n`);
}

/** A component the file holds, with no position: what a producer emits. */
function componentWithoutPosition(id: string, title: string): Record<string, unknown> {
  return {
    id,
    kind: 'entity',
    type: 'component',
    title,
    description: '',
    tags: {},
    sources: [],
    groupId: null,
  };
}

/** Where the board draws an element, or undefined while it has no box. */
async function boxX(page: Page, id: string): Promise<number | undefined> {
  const entry = (await getDocument(page)).layout[id];
  return entry && 'x' in entry ? entry.x : undefined;
}

function transformOf(page: Page): Promise<string> {
  return page.locator('.react-flow__viewport').evaluate((viewport) => viewport.style.transform);
}

test.describe('sync mode', () => {
  test('is offered only once the board has a file', async ({ page }) => {
    await expect(page.getByTestId('sync')).toBeDisabled();

    await dispatch(page, sampleDomain());
    await page.getByTestId('save').click();
    await expect(page.getByTestId('toolbar-message')).toContainText('Saved');

    await expect(page.getByTestId('sync')).toBeEnabled();
  });

  test('writes every change to the file with no press', async ({ page }) => {
    await startSync(page);

    await dispatch(page, [{ type: 'set-metadata', id: IDS.ui, title: 'Checkout web' }]);

    await expect
      .poll(() => savedFile(page, FILE), { message: 'the file holds the new title' })
      .toContain('Checkout web');
    expect(await savedFile(page, FILE)).toBe(await serialize(page));
  });

  test('takes a change made to the file, and holds the camera still', async ({ page }) => {
    await startSync(page);
    const before = await transformOf(page);

    await editFileOutside(page, (raw) => {
      const model = raw['model'] as { elements: Record<string, unknown> };
      model.elements[LEDGER] = componentWithoutPosition(LEDGER, 'Reporting');
    });

    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await expect(page.getByTestId('sync-status')).toContainText('from the file');
    expect(await transformOf(page)).toBe(before);
  });

  test('keeps the selection and the filter through a change from the file', async ({ page }) => {
    await startSync(page);
    await setFilter(page, 'team=payments');
    await dispatch(page, [{ type: 'set-selection', ids: [IDS.gateway] }]);

    await editFileOutside(page, (raw) => {
      const model = raw['model'] as { elements: Record<string, Record<string, unknown>> };
      model.elements[IDS.ledger]!['title'] = 'General ledger';
    });

    await expect
      .poll(async () => (await getDocument(page)).model.elements[IDS.ledger]?.title)
      .toBe('General ledger');
    const state = await page.evaluate(() => window.__modl.getState());
    expect(state.selection).toEqual([IDS.gateway]);
    expect(state.filter).toBe('team=payments');
  });

  test('keeps a box the file states no position for', async ({ page }) => {
    await startSync(page);
    await dispatch(page, [{ type: 'move-element', id: IDS.ui, position: { x: 900, y: 640 } }]);
    await expect.poll(() => savedFile(page, FILE)).toContain('900');

    // A producer rewriting the document from its own model: structure, and no
    // layout at all.
    await editFileOutside(page, (raw) => {
      delete raw['layout'];
      const model = raw['model'] as { elements: Record<string, unknown> };
      model.elements[LEDGER] = componentWithoutPosition(LEDGER, 'Reporting');
    });

    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    const document = await getDocument(page);
    expect(document.layout[IDS.ui]).toMatchObject({ x: 900, y: 640 });
  });

  test('takes the box the file states, over the one the board has', async ({ page }) => {
    await startSync(page);
    await dispatch(page, [{ type: 'move-element', id: IDS.ui, position: { x: 900, y: 640 } }]);
    await expect.poll(() => savedFile(page, FILE)).toContain('900');

    await editFileOutside(page, (raw) => {
      const layout = raw['layout'] as Record<string, Record<string, number>>;
      layout[IDS.ui] = { ...layout[IDS.ui]!, x: 1200, y: 80 };
    });

    await expect.poll(() => boxX(page, IDS.ui)).toBe(1200);
  });

  test('leaves the board alone while the file is half written', async ({ page }) => {
    await startSync(page);
    const before = await getDocument(page);
    const whole = await serialize(page);

    await writeFileOutside(page, FILE, '{ "formatVersion": 9, "model": {');

    await expect(page.getByTestId('sync-status')).toContainText('does not read as a document');
    expect((await getDocument(page)).model.elements).toEqual(before.model.elements);

    // The next whole file it reads recovers, with no press in between.
    await writeFileOutside(page, FILE, whole.replace('Ledger', 'Ledgers'));
    await expect
      .poll(async () => (await getDocument(page)).model.elements[IDS.ledger]?.title)
      .toBe('Ledgers');
  });

  test('stops following when it is turned off', async ({ page }) => {
    await startSync(page);
    await page.getByTestId('sync').click();
    await expect(page.getByTestId('sync-status')).toHaveCount(0);

    await editFileOutside(page, (raw) => {
      const model = raw['model'] as { elements: Record<string, unknown> };
      model.elements[LEDGER] = componentWithoutPosition(LEDGER, 'Reporting');
    });

    await page.waitForTimeout(1200);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);

    await dispatch(page, [{ type: 'set-metadata', id: IDS.ui, title: 'Checkout web' }]);
    await page.waitForTimeout(1200);
    expect(await savedFile(page, FILE)).not.toContain('Checkout web');
  });
});
