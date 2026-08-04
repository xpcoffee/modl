import type { Page } from '@playwright/test';
import type { Command, Document, TraceEntry } from '@modl/core';

export const IDS = {
  ui: '11111111-1111-4111-8111-111111111111',
  gateway: '22222222-2222-4222-8222-222222222222',
  ledger: '33333333-3333-4333-8333-333333333333',
  authorise: '44444444-4444-4444-8444-444444444444',
  post: '55555555-5555-4555-8555-555555555555',
} as const;

/** Loads the app and waits for the runtime API to come up. */
export async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__modl?.ready === true);
  await page.evaluate(() => window.__modl.reset());
}

export async function dispatch(page: Page, commands: Command[]): Promise<void> {
  await page.evaluate((batch) => window.__modl.dispatchAll(batch), commands);
}

/**
 * Refits the camera. `fitView` runs on mount only, so a domain built after
 * load can sit outside the viewport and land outside hit-testing.
 */
export async function fit(page: Page): Promise<void> {
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(300);
}

export async function getDocument(page: Page): Promise<Document> {
  return page.evaluate(() => window.__modl.getDocument());
}

export async function getTrace(page: Page): Promise<TraceEntry[]> {
  return page.evaluate(() => window.__modl.getTrace());
}

export async function serialize(page: Page): Promise<string> {
  return page.evaluate(() => window.__modl.serialize());
}

/** A three-component domain with two interactions. */
export function sampleDomain(): Command[] {
  return [
    { type: 'create-entity', id: IDS.ui, entityType: 'component', title: 'Checkout UI', position: { x: 0, y: 0 } },
    { type: 'create-entity', id: IDS.gateway, entityType: 'component', title: 'Payment gateway', position: { x: 280, y: 0 } },
    { type: 'create-entity', id: IDS.ledger, entityType: 'component', title: 'Ledger', position: { x: 560, y: 0 } },
    { type: 'create-connection', id: IDS.authorise, connectionType: 'interaction', from: [IDS.ui], to: [IDS.gateway], title: 'authorise' },
    { type: 'create-connection', id: IDS.post, connectionType: 'interaction', from: [IDS.gateway], to: [IDS.ledger], title: 'post entry' },
    { type: 'set-tag', id: IDS.ui, key: 'team', values: ['web'] },
    { type: 'set-tag', id: IDS.gateway, key: 'team', values: ['payments'] },
    { type: 'set-tag', id: IDS.ledger, key: 'team', values: ['payments'] },
  ];
}
