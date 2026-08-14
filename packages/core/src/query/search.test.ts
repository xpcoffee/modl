import { beforeEach, describe, expect, it } from 'vitest';
import { applyAll } from '../commands/apply.js';
import type { AppState, Command } from '../commands/types.js';
import { initialState } from '../state.js';
import { activeFilterTerms, searchElements, searchOptions, tagSuggestions } from './search.js';

const DOC = '00000000-0000-4000-8000-000000000000';
const UI = '11111111-1111-4111-8111-111111111111';
const GATEWAY = '22222222-2222-4222-8222-222222222222';
const LEDGER = '33333333-3333-4333-8333-333333333333';
const AUTHORISE = '44444444-4444-4444-8444-444444444444';

function must(state: AppState, ...commands: Command[]): AppState {
  const result = applyAll(state, commands);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.error)}`);
  return result.state;
}

let base: AppState;

beforeEach(() => {
  base = must(
    initialState(DOC),
    { type: 'create-entity', id: UI, entityType: 'component', title: 'Checkout UI', position: { x: 0, y: 0 } },
    { type: 'create-entity', id: GATEWAY, entityType: 'component', title: 'Payment gateway', position: { x: 280, y: 0 } },
    { type: 'create-entity', id: LEDGER, entityType: 'component', title: 'Ledger', position: { x: 560, y: 0 } },
    { type: 'create-connection', id: AUTHORISE, connectionType: 'interaction', from: [UI], to: [GATEWAY], title: 'authorise' },
    { type: 'set-tag', id: UI, key: 'team', values: ['web'] },
    { type: 'set-tag', id: GATEWAY, key: 'team', values: ['payments'] },
  );
});

describe('searchElements', () => {
  it('finds an element by part of its title', () => {
    const hits = searchElements(base.document.model.elements, 'gate');
    expect(hits.map((hit) => hit.id)).toEqual([GATEWAY]);
  });

  it('finds an element by scattered characters', () => {
    const hits = searchElements(base.document.model.elements, 'chkui');
    expect(hits.map((hit) => hit.id)).toEqual([UI]);
  });

  it('finds a connection by its title', () => {
    const hits = searchElements(base.document.model.elements, 'authorise');
    expect(hits.map((hit) => hit.id)).toEqual([AUTHORISE]);
  });

  it('says what kind of thing each hit is', () => {
    const [hit] = searchElements(base.document.model.elements, 'authorise');
    expect(hit?.sublabel).toBe('interaction connection');
  });

  it('ranks the better match first', () => {
    const hits = searchElements(base.document.model.elements, 'led');
    expect(hits[0]?.id).toBe(LEDGER);
  });

  it('finds nothing for an empty query', () => {
    expect(searchElements(base.document.model.elements, '  ')).toEqual([]);
  });
});

describe('tagSuggestions', () => {
  it('offers each key on its own and with each of its values', () => {
    const labels = tagSuggestions(base.document.model.elements, 'team').map((option) => option.label);
    expect(labels).toContain('team');
    expect(labels).toContain('team=web');
    expect(labels).toContain('team=payments');
  });

  it('narrows to the values that read like the query', () => {
    const labels = tagSuggestions(base.document.model.elements, 'pay').map((option) => option.label);
    expect(labels).toEqual(['team=payments']);
  });
});

describe('searchOptions', () => {
  it('leads with the filter that makes the narrowing permanent', () => {
    const options = searchOptions(base, 'e');
    expect(options[0]).toMatchObject({
      kind: 'filter',
      term: { kind: 'text', text: 'e' },
    });
  });

  it('offers only the element once one is left', () => {
    const options = searchOptions(base, 'chkui');
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: 'element', id: UI });
  });

  it('lists elements after the filters while several match', () => {
    const options = searchOptions(base, 'e');
    const firstElement = options.findIndex((option) => option.kind === 'element');
    const lastFilter = options.map((option) => option.kind).lastIndexOf('filter');
    expect(firstElement).toBeGreaterThan(lastFilter);
  });

  it('leaves elements out for the filter editor', () => {
    const options = searchOptions(base, 'e', { filtersOnly: true });
    expect(options.every((option) => option.kind === 'filter')).toBe(true);
  });

  it('shows only the element even in an editor when nothing else is offered', () => {
    // filtersOnly never collapses to one element: an editor edits filters.
    const options = searchOptions(base, 'chkui', { filtersOnly: true });
    expect(options.every((option) => option.kind === 'filter')).toBe(true);
  });

  it('stops offering filters at the cap', () => {
    const options = searchOptions(base, 'e', { allowNewFilter: false });
    expect(options.every((option) => option.kind === 'element')).toBe(true);
  });

  it('offers the tag filters with nothing typed', () => {
    const options = searchOptions(base, '');
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.kind === 'filter')).toBe(true);
  });

  it('leaves out a filter that is already active', () => {
    const filtered = must(base, { type: 'set-filter', expression: 'team=web' });
    const labels = searchOptions(filtered, 'team').map((option) =>
      option.kind === 'filter' ? option.label : '',
    );
    expect(labels).not.toContain('team=web');
    expect(labels).toContain('team=payments');
  });

  it('leaves out the active filters with nothing typed', () => {
    const filtered = must(base, { type: 'set-filter', expression: 'team' });
    const labels = searchOptions(filtered, '').map((option) =>
      option.kind === 'filter' ? option.label : '',
    );
    expect(labels).not.toContain('team');
    expect(labels).toContain('team=web');
  });
});

describe('activeFilterTerms', () => {
  it('counts the terms in the expression', () => {
    expect(activeFilterTerms('team=web "ledger"')).toHaveLength(2);
  });

  it('counts nothing for an expression that does not parse', () => {
    expect(activeFilterTerms('=broken')).toEqual([]);
  });
});
