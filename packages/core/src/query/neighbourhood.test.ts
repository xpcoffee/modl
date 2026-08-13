import { describe, expect, it } from 'vitest';
import { neighbourhoodOf, renderNeighbourhood } from './neighbourhood.js';
import {
  DEFAULT_VIEW,
  FORMAT_VERSION,
  type Comment,
  type Connection,
  type ConnectionNode,
  type Document,
  type Element,
  type Id,
} from '../model/types.js';

function entity(id: Id, title: string, groupId: Id | null = null): Element {
  return { id, kind: 'entity', type: 'component', title, description: '', tags: {}, sources: [], groupId };
}

function connection(id: Id, title: string, from: Id[], to: Id[]): Connection {
  return {
    id,
    kind: 'connection',
    type: 'interaction',
    title,
    description: '',
    tags: {},
    sources: [],
    groupId: null,
    from,
    to,
    direction: 'forward',
  };
}

function node(id: Id, title: string, labels: Record<Id, string>): ConnectionNode {
  return {
    id,
    kind: 'connection-node',
    shape: 'diamond',
    title,
    description: '',
    tags: {},
    sources: [],
    groupId: null,
    labels,
  };
}

function doc(elements: Element[], comments: Comment[] = []): Document {
  return {
    formatVersion: FORMAT_VERSION,
    id: 'doc',
    title: 'Checkout domain',
    model: {
      elements: Object.fromEntries(elements.map((element) => [element.id, element])),
      notes: {},
    },
    comments: Object.fromEntries(comments.map((comment) => [comment.id, comment])),
    layout: {},
    view: DEFAULT_VIEW,
  };
}

/**
 * ui -> gateway -> decision -> ledger, with gateway and ledger inside the
 * payments group, and the decision labelling its outgoing branch.
 */
const DOCUMENT = doc(
  [
    entity('payments', 'Payments'),
    entity('ui', 'Checkout UI'),
    entity('gateway', 'Payment gateway', 'payments'),
    entity('ledger', 'Ledger', 'payments'),
    node('decision', 'Card ok?', { 'settle': 'funds held' }),
    connection('authorise', 'authorise', ['ui'], ['gateway']),
    connection('check', '', ['gateway'], ['decision']),
    connection('settle', 'post entry', ['decision'], ['ledger']),
  ],
  [
    { id: 'c-later', text: 'second remark', createdAt: '2026-02-01T00:00:00Z', targets: ['gateway'] },
    { id: 'c-early', text: 'does the gateway retry?', createdAt: '2026-01-01T00:00:00Z', targets: ['gateway', 'ui'] },
    { id: 'c-general', text: 'about the document', targets: [] },
  ],
);

describe('neighbourhoodOf', () => {
  it('returns null when the id names nothing', () => {
    expect(neighbourhoodOf(DOCUMENT, 'missing')).toBeNull();
  });

  it('splits connections by which side names the element', () => {
    const found = neighbourhoodOf(DOCUMENT, 'gateway');
    expect(found?.incoming.map((c) => c.id)).toEqual(['authorise']);
    expect(found?.outgoing.map((c) => c.id)).toEqual(['check']);
  });

  it('lists group siblings without the element itself', () => {
    const found = neighbourhoodOf(DOCUMENT, 'gateway');
    expect(found?.siblings.map((e) => e.id)).toEqual(['ledger']);
  });

  it('gives a top-level element no siblings', () => {
    expect(neighbourhoodOf(DOCUMENT, 'ui')?.siblings).toEqual([]);
  });

  it('lists a group\'s direct members', () => {
    const found = neighbourhoodOf(DOCUMENT, 'payments');
    expect(found?.members.map((e) => e.id)).toEqual(['gateway', 'ledger']);
  });

  it('lists only the comments attached to the element, oldest first', () => {
    const found = neighbourhoodOf(DOCUMENT, 'gateway');
    expect(found?.comments.map((c) => c.id)).toEqual(['c-early', 'c-later']);
  });

  it('finds connections into a connection node', () => {
    const found = neighbourhoodOf(DOCUMENT, 'decision');
    expect(found?.incoming.map((c) => c.id)).toEqual(['check']);
    expect(found?.outgoing.map((c) => c.id)).toEqual(['settle']);
  });
});

describe('renderNeighbourhood', () => {
  it('returns null when the id names nothing', () => {
    expect(renderNeighbourhood(DOCUMENT, 'missing')).toBeNull();
  });

  it('renders every section with its count', () => {
    expect(renderNeighbourhood(DOCUMENT, 'gateway')).toBe(
      [
        'Payment gateway',
        '  id     gateway',
        '  kind   entity (component)',
        '  group  Payments (payments)',
        '',
        'incoming (1)',
        '  authorise  interaction  from Checkout UI  "authorise"',
        '',
        'outgoing (1)',
        '  check  interaction  to Card ok?',
        '',
        'siblings (1)',
        '  ledger  Ledger',
        '',
        'comments (2)',
        '  does the gateway retry?',
        '  second remark',
      ].join('\n'),
    );
  });

  it('renders a connection with its endpoints', () => {
    const text = renderNeighbourhood(DOCUMENT, 'settle');
    expect(text).toContain('  kind   connection (interaction, forward)');
    expect(text).toContain('  from   Card ok? (decision)');
    expect(text).toContain('  to     Ledger (ledger)');
  });

  it('renders a connection node with its branch labels', () => {
    const text = renderNeighbourhood(DOCUMENT, 'decision');
    expect(text).toContain('  label  "funds held" on post entry (settle)');
    expect(text).toContain('  settle  interaction  to Ledger  "post entry"  [funds held]');
  });

  it('renders a group with its members', () => {
    const text = renderNeighbourhood(DOCUMENT, 'payments');
    expect(text).toContain('members (2)');
    expect(text).toContain('  gateway  Payment gateway');
  });
});
