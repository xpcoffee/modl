import { describe, expect, it } from 'vitest';
import { parseFilter, selectIds, tagKeys, tagValues } from './filter.js';
import type { Element, Id } from '../model/types.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function entity(id: Id, tags: Record<string, string[]>): Element {
  return { id, kind: 'entity', type: 'component', title: id, description: '', tags, sources: [], groupId: null };
}

const ELEMENTS: Record<Id, Element> = {
  [A]: entity(A, { team: ['web'], tier: ['1'] }),
  [B]: entity(B, { team: ['payments'], tier: ['1'] }),
  [C]: entity(C, { team: ['payments'], deprecated: ['yes'] }),
};

describe('parseFilter', () => {
  it('reads a key=value term', () => {
    expect(parseFilter('team=web')).toEqual({ ok: true, terms: [{ negated: false, key: 'team', value: 'web' }] });
  });

  it('reads a bare key as any value', () => {
    expect(parseFilter('team')).toEqual({ ok: true, terms: [{ negated: false, key: 'team' }] });
  });

  it('reads a wildcard as any value', () => {
    expect(parseFilter('team=*')).toEqual({ ok: true, terms: [{ negated: false, key: 'team' }] });
  });

  it('reads a negated term', () => {
    expect(parseFilter('-team=web')).toEqual({ ok: true, terms: [{ negated: true, key: 'team', value: 'web' }] });
  });

  it('reads several terms', () => {
    const result = parseFilter('team=payments tier=1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.terms).toHaveLength(2);
  });

  it('treats an empty expression as no terms', () => {
    expect(parseFilter('   ')).toEqual({ ok: true, terms: [] });
  });

  it('rejects a term with no key', () => {
    const result = parseFilter('=web');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('=web');
  });

  it('reads an empty value as a literal empty string', () => {
    expect(parseFilter('team=')).toEqual({ ok: true, terms: [{ negated: false, key: 'team', value: '' }] });
  });
});

describe('selectIds', () => {
  it('matches an exact value', () => {
    expect(selectIds(ELEMENTS, 'team=web')).toEqual(new Set([A]));
  });

  it('matches any element carrying a key', () => {
    expect(selectIds(ELEMENTS, 'deprecated')).toEqual(new Set([C]));
  });

  it('combines terms with AND', () => {
    expect(selectIds(ELEMENTS, 'team=payments tier=1')).toEqual(new Set([B]));
  });

  it('negates a term', () => {
    expect(selectIds(ELEMENTS, '-team=payments')).toEqual(new Set([A]));
  });

  it('negates a bare key', () => {
    expect(selectIds(ELEMENTS, '-deprecated')).toEqual(new Set([A, B]));
  });

  it('selects everything for an empty expression', () => {
    expect(selectIds(ELEMENTS, '')).toEqual(new Set([A, B, C]));
  });

  it('selects everything for an unparseable expression', () => {
    expect(selectIds(ELEMENTS, '=broken')).toEqual(new Set([A, B, C]));
  });

  it('selects nothing when no element matches', () => {
    expect(selectIds(ELEMENTS, 'team=nobody')).toEqual(new Set());
  });
});

describe('tag suggestions', () => {
  it('lists every key, sorted', () => {
    expect(tagKeys(ELEMENTS)).toEqual(['deprecated', 'team', 'tier']);
  });

  it('lists the values for a key, sorted', () => {
    expect(tagValues(ELEMENTS, 'team')).toEqual(['payments', 'web']);
  });

  it('returns nothing for an unused key', () => {
    expect(tagValues(ELEMENTS, 'absent')).toEqual([]);
  });
});
