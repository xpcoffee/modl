import { describe, expect, it } from 'vitest';
import {
  addTerm,
  formatFilter,
  formatTerm,
  parseFilter,
  replaceTerm,
  selectIds,
  tagKeys,
  tagValues,
} from './filter.js';
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
    expect(parseFilter('team=web')).toEqual({ ok: true, terms: [{ kind: 'tag', negated: false, key: 'team', value: 'web' }] });
  });

  it('reads a bare key as any value', () => {
    expect(parseFilter('team')).toEqual({ ok: true, terms: [{ kind: 'tag', negated: false, key: 'team' }] });
  });

  it('reads a wildcard as any value', () => {
    expect(parseFilter('team=*')).toEqual({ ok: true, terms: [{ kind: 'tag', negated: false, key: 'team' }] });
  });

  it('reads a negated term', () => {
    expect(parseFilter('-team=web')).toEqual({ ok: true, terms: [{ kind: 'tag', negated: true, key: 'team', value: 'web' }] });
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
    expect(parseFilter('team=')).toEqual({ ok: true, terms: [{ kind: 'tag', negated: false, key: 'team', value: '' }] });
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

describe('selectIds: connections', () => {
  const LINK = '44444444-4444-4444-8444-444444444444';

  function connection(id: Id, from: Id[], to: Id[], tags: Record<string, string[]>): Element {
    return {
      id,
      kind: 'connection',
      type: 'interaction',
      title: id,
      description: '',
      tags,
      sources: [],
      groupId: null,
      from,
      to,
      direction: 'forward',
    };
  }

  it('a matching connection brings its endpoints, so the line can draw', () => {
    const elements: Record<Id, Element> = {
      ...ELEMENTS,
      [LINK]: connection(LINK, [A], [B], { flow: ['checkout'] }),
    };
    expect(selectIds(elements, 'flow=checkout')).toEqual(new Set([LINK, A, B]));
  });

  it('a purely negated filter brings no endpoints', () => {
    // The untagged connection matches -deprecated by carrying nothing, and C
    // is exactly what the reader excluded; the match says nothing about C.
    const elements: Record<Id, Element> = {
      [A]: entity(A, { team: ['web'], tier: ['1'] }),
      [C]: entity(C, { deprecated: ['yes'] }),
      [LINK]: connection(LINK, [A], [C], {}),
    };
    expect(selectIds(elements, '-deprecated')).toEqual(new Set([A, LINK]));
  });

  it('a non-matching connection brings nothing', () => {
    const elements: Record<Id, Element> = {
      ...ELEMENTS,
      [LINK]: connection(LINK, [A], [B], {}),
    };
    expect(selectIds(elements, 'deprecated')).toEqual(new Set([C]));
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

/** Named elements, for the text terms the search menu writes. */
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';

function named(id: Id, title: string): Element {
  return { id, kind: 'entity', type: 'component', title, description: '', tags: {}, sources: [], groupId: null };
}

const NAMED: Record<Id, Element> = {
  [D]: named(D, 'Checkout UI'),
  [E]: named(E, 'Payment gateway'),
};

describe('text terms', () => {
  it('reads a quoted term as text', () => {
    expect(parseFilter('"checkout"')).toEqual({
      ok: true,
      terms: [{ kind: 'text', negated: false, text: 'checkout' }],
    });
  });

  it('keeps a space inside the quotes in one term', () => {
    const result = parseFilter('"payment gateway" team=web');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.terms).toEqual([
      { kind: 'text', negated: false, text: 'payment gateway' },
      { kind: 'tag', negated: false, key: 'team', value: 'web' },
    ]);
  });

  it('reads a negated text term', () => {
    expect(parseFilter('-"ui"')).toEqual({
      ok: true,
      terms: [{ kind: 'text', negated: true, text: 'ui' }],
    });
  });

  it('rejects an unclosed quote', () => {
    const result = parseFilter('"checkout');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('unclosed quote');
  });

  it('rejects empty text', () => {
    expect(parseFilter('""').ok).toBe(false);
  });

  it('matches a title fuzzily', () => {
    expect(selectIds(NAMED, '"chkui"')).toEqual(new Set([D]));
  });

  it('matches a title across a space in the query', () => {
    expect(selectIds(NAMED, '"payment gate"')).toEqual(new Set([E]));
  });

  it('negates a text term', () => {
    expect(selectIds(NAMED, '-"checkout"')).toEqual(new Set([E]));
  });

  it('combines a text term with a tag term', () => {
    expect(selectIds(ELEMENTS, '"1111" team=web')).toEqual(new Set([A]));
  });
});

describe('writing expressions', () => {
  it('writes back what it read', () => {
    const expression = '-team=web tier "payment gateway"';
    const parsed = parseFilter(expression);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(formatFilter(parsed.terms)).toBe(expression);
  });

  it('writes a bare key without a value', () => {
    expect(formatTerm({ kind: 'tag', negated: false, key: 'tier' })).toBe('tier');
  });

  it('appends a term', () => {
    expect(addTerm('team=web', { kind: 'text', negated: false, text: 'ledger' })).toBe(
      'team=web "ledger"',
    );
  });

  it('replaces an unparseable expression rather than appending to it', () => {
    expect(addTerm('=broken', { kind: 'tag', negated: false, key: 'tier' })).toBe('tier');
  });

  it('replaces a term in place', () => {
    expect(replaceTerm('team=web tier', 0, { kind: 'tag', negated: false, key: 'team', value: 'payments' })).toBe(
      'team=payments tier',
    );
  });

  it('removes a term when the replacement is null', () => {
    expect(replaceTerm('team=web tier', 0, null)).toBe('tier');
  });

  it('leaves an out-of-range index alone', () => {
    expect(replaceTerm('team=web', 4, null)).toBe('team=web');
  });
});
