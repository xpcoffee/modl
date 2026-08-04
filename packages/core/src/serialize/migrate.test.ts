import { describe, expect, it } from 'vitest';
import { migrateDocument } from './migrate.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { FORMAT_VERSION } from '../model/types.js';

const V1 = {
  formatVersion: 1,
  id: '00000000-0000-4000-8000-000000000000',
  title: 'Old',
  model: {
    elements: {
      'checkout-ui': {
        id: 'checkout-ui',
        kind: 'entity',
        type: 'component',
        title: 'Checkout UI',
        description: '',
        tags: { team: 'web' },
        groupId: null,
      },
    },
  },
  layout: {},
  view: { pan: { x: 0, y: 0 }, zoom: 1 },
};

describe('migrateDocument', () => {
  it('turns single tag values into lists', () => {
    const result = migrateDocument(V1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const element = (result.document as typeof V1).model.elements['checkout-ui'] as never;
    expect(element).toMatchObject({ tags: { team: ['web'] }, sources: [] });
  });

  it('reports where it came from', () => {
    const result = migrateDocument(V1);
    expect(result).toMatchObject({ ok: true, from: 1, migrated: true });
  });

  it('leaves a current document alone', () => {
    const current = { ...V1, formatVersion: FORMAT_VERSION };
    expect(migrateDocument(current)).toMatchObject({ migrated: false });
  });

  it('refuses a version newer than it reads', () => {
    const result = migrateDocument({ ...V1, formatVersion: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('newer');
  });

  it('refuses a document with no version', () => {
    const result = migrateDocument({ model: { elements: {} } });
    expect(result.ok).toBe(false);
  });

  it('refuses something that is not an object', () => {
    expect(migrateDocument('nope').ok).toBe(false);
  });
});

describe('reading an old file', () => {
  it('loads and saves at the current version', () => {
    const result = parseDocument(JSON.stringify(V1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.formatVersion).toBe(FORMAT_VERSION);

    // Saving upgrades the file on disk.
    const saved = serializeDocument(result.document);
    expect(JSON.parse(saved).formatVersion).toBe(FORMAT_VERSION);
    expect(JSON.parse(saved).model.elements['checkout-ui'].tags).toEqual({ team: ['web'] });
  });
});
