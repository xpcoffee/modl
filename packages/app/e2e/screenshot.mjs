/**
 * Loads the app, builds a sample domain through the runtime API, and writes a
 * screenshot. Handy for eyeballing a change without clicking through it.
 *
 *   node e2e/screenshot.mjs [outputPath] [filterExpression]
 */
import { chromium } from '@playwright/test';

const output = process.argv[2] ?? '/tmp/modl.png';
const filter = process.argv[3] ?? '';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 780 } });

await page.goto(`http://localhost:${process.env.MODL_PORT ?? 5173}/`);
await page.waitForFunction(() => window.__modl?.ready === true);

const ui = '11111111-1111-4111-8111-111111111111';
const gateway = '22222222-2222-4222-8222-222222222222';
const ledger = '33333333-3333-4333-8333-333333333333';

await page.evaluate(
  ([a, b, c]) =>
    window.__modl.dispatchAll([
      { type: 'create-entity', id: a, entityType: 'component', title: 'Checkout UI', position: { x: 0, y: 0 } },
      { type: 'create-entity', id: b, entityType: 'component', title: 'Payment gateway', position: { x: 300, y: 0 } },
      { type: 'create-entity', id: c, entityType: 'component', title: 'Ledger', position: { x: 600, y: 120 } },
      { type: 'create-connection', id: '44444444-4444-4444-8444-444444444444', connectionType: 'interaction', from: [a], to: [b], title: 'authorise' },
      { type: 'create-connection', id: '55555555-5555-4555-8555-555555555555', connectionType: 'interaction', from: [b], to: [c], title: 'post entry' },
      { type: 'set-tag', id: a, key: 'team', values: ['web'] },
      { type: 'set-tag', id: b, key: 'team', values: ['payments'] },
      { type: 'set-tag', id: b, key: 'tier', values: ['1'] },
      { type: 'set-tag', id: c, key: 'team', values: ['payments'] },
      { type: 'set-selection', ids: [b] },
    ]),
  [ui, gateway, ledger],
);

if (filter) {
  await page.evaluate(
    (expression) => window.__modl.dispatchAll([{ type: 'set-filter', expression }]),
    filter,
  );
}

if (process.env.GROUPED) {
  const group = '77777777-7777-4777-8777-777777777777';
  const expand = process.env.EXPANDED !== undefined;
  await page.evaluate(
    ([id, a, b, open]) =>
      window.__modl.dispatchAll([
        { type: 'group-elements', id, title: 'Payments', memberIds: [a, b], position: { x: 280, y: 0 } },
        { type: 'set-expanded', id, expanded: open },
        { type: 'set-selection', ids: [] },
      ]),
    [group, gateway, ledger, expand],
  );
}

await page.waitForTimeout(500);
await page.screenshot({ path: output });
await browser.close();
console.log(`wrote ${output}`);
