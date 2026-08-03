import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyDocument,
  loadDocument,
  parseDocument,
  serializeDocument,
  withDefaultLayout,
} from './serialize.js';
import type { Document, Element } from '../model/types.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
const CHECKOUT = join(FIXTURES, 'checkout.dmap.json');

function loadCheckout(): Document {
  const result = parseDocument(readFileSync(CHECKOUT, 'utf8'));
  if (!result.ok) throw new Error(`fixture failed to load: ${JSON.stringify(result.errors)}`);
  return result.document;
}

describe('round trip', () => {
  it('reproduces the fixture byte for byte', () => {
    const text = readFileSync(CHECKOUT, 'utf8');
    const result = parseDocument(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(serializeDocument(result.document)).toBe(text);
  });

  it('is stable across repeated round trips', () => {
    const once = serializeDocument(loadCheckout());
    const twice = serializeDocument(loadCheckout());
    expect(once).toBe(twice);
  });

  it('produces identical bytes regardless of key insertion order', () => {
    const document = loadCheckout();
    const reversed: Record<string, Element> = {};
    for (const id of Object.keys(document.model.elements).reverse()) {
      const element = document.model.elements[id];
      if (element) reversed[id] = element;
    }
    const shuffled: Document = { ...document, model: { elements: reversed } };
    expect(serializeDocument(shuffled)).toBe(serializeDocument(document));
  });

  it('sorts tag keys', () => {
    const document = loadCheckout();
    const target = document.model.elements['22222222-2222-4222-8222-222222222222'];
    if (!target) throw new Error('fixture element missing');
    target.tags = { tier: '1', team: 'payments' };
    const text = serializeDocument(document);
    expect(text.indexOf('"team"')).toBeLessThan(text.indexOf('"tier"'));
  });
});

describe('parseDocument', () => {
  it('reports invalid JSON without throwing', () => {
    const result = parseDocument('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('schema-invalid');
  });

  it('returns warnings alongside a loadable document', () => {
    const result = parseDocument(readFileSync(CHECKOUT, 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });
});

describe('layout defaults', () => {
  it('places entities on a grid when layout is absent', () => {
    const document = loadCheckout();
    const result = loadDocument({ ...document, layout: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.layout['11111111-1111-4111-8111-111111111111']).toEqual({
      x: 0,
      y: 0,
      width: 180,
      height: 72,
    });
    expect(result.document.layout['22222222-2222-4222-8222-222222222222']).toEqual({
      x: 240,
      y: 0,
      width: 180,
      height: 72,
    });
  });

  it('loads a document with no layout section at all', () => {
    const document = loadCheckout();
    const { layout, ...withoutLayout } = document;
    void layout;
    const result = loadDocument(withoutLayout);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.document.layout)).toHaveLength(3);
  });

  it('keeps positions that are already present', () => {
    const document = loadCheckout();
    const resolved = withDefaultLayout(document.model.elements, {
      '11111111-1111-4111-8111-111111111111': { x: 99, y: 99, width: 10, height: 10 },
    });
    expect(resolved['11111111-1111-4111-8111-111111111111']).toEqual({
      x: 99,
      y: 99,
      width: 10,
      height: 10,
    });
  });

  it('gives connections no default layout', () => {
    const document = loadCheckout();
    const resolved = withDefaultLayout(document.model.elements, {});
    expect(resolved['44444444-4444-4444-8444-444444444444']).toBeUndefined();
  });

  it('is deterministic for the same element set', () => {
    const document = loadCheckout();
    const first = withDefaultLayout(document.model.elements, {});
    const second = withDefaultLayout(document.model.elements, {});
    expect(first).toEqual(second);
  });
});

describe('emptyDocument', () => {
  it('round trips', () => {
    const document = emptyDocument('00000000-0000-4000-8000-000000000000');
    const text = serializeDocument(document);
    const result = parseDocument(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(serializeDocument(result.document)).toBe(text);
  });
});
