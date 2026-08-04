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

describe('2 -> 3', () => {
  const V2 = {
    formatVersion: 2,
    id: 'doc',
    title: 'Two',
    model: {
      elements: {
        a: { id:'a', kind:'entity', type:'component', title:'A',
             description:'', tags:{}, sources:[], groupId:null },
        b: { id:'b', kind:'entity', type:'component', title:'B',
             description:'', tags:{}, sources:[], groupId:null },
        one: { id:'one', kind:'connection', type:'interaction', from:['a'], to:['b'],
               title:'', description:'', tags:{}, sources:[], groupId:null },
        two: { id:'two', kind:'connection', type:'interaction', from:['a'], to:['b'],
               title:'', description:'', tags:{}, sources:[], groupId:null },
      },
    },
    layout: {
      one: { waypoints: [], arrowStart: true, arrowEnd: true },
      two: { waypoints: [{ x: 1, y: 2 }] },
    },
    view: { pan: { x: 0, y: 0 }, zoom: 1 },
  };

  it('reads a head at each end as a two-way connection', () => {
    const result = migrateDocument(V2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const elements = (result.document as typeof V2).model.elements as Record<string, { direction?: string }>;
    expect(elements['one']).toMatchObject({ direction: 'both' });
  });

  it('reads anything else as running from `from` to `to`', () => {
    const result = migrateDocument(V2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const elements = (result.document as typeof V2).model.elements as Record<string, { direction?: string }>;
    expect(elements['two']).toMatchObject({ direction: 'forward' });
  });

  it('takes the arrowheads out of layout and leaves the bends', () => {
    const result = migrateDocument(V2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const layout = (result.document as typeof V2).layout as Record<string, Record<string, unknown>>;
    expect(layout['one']).not.toHaveProperty('arrowStart');
    expect(layout['two']).toMatchObject({ waypoints: [{ x: 1, y: 2 }] });
  });

  it('carries a version 1 document all the way up', () => {
    const result = migrateDocument(V1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.document as { formatVersion: number }).formatVersion).toBe(FORMAT_VERSION);
  });
});

describe('3 -> 4', () => {
  const V3 = {
    formatVersion: 3,
    id: 'doc',
    title: 'Three',
    model: {
      elements: {
        a: { id:'a', kind:'entity', type:'component', title:'A',
             description:'', tags:{}, sources:[], groupId:null },
        j: { id:'j', kind:'fork', shape:'diamond', title:'ready?',
             description:'', tags:{}, sources:[], groupId:null },
      },
    },
    layout: {},
    view: { pan: { x: 0, y: 0 }, zoom: 1 },
  };

  it('renames a fork to a connection node', () => {
    const result = migrateDocument(V3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const elements = (result.document as typeof V3).model.elements as Record<string, { kind: string }>;
    expect(elements['j']!.kind).toBe('connection-node');
    expect(elements['a']!.kind).toBe('entity');
  });

  it('loads a version 3 document with a fork in it', () => {
    const result = parseDocument(JSON.stringify(V3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.formatVersion).toBe(FORMAT_VERSION);
    expect(result.document.model.elements['j']).toMatchObject({
      kind: 'connection-node',
      shape: 'diamond',
    });
  });
});
