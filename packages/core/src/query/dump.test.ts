import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dumpDocument } from './dump.js';
import { parseDocument } from '../serialize/serialize.js';
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
import { expectMatchesGolden } from '../test-support/golden.js';

const FIXTURE = join(import.meta.dirname, '../../fixtures/checkout.modl.json');
const GOLDEN = join(import.meta.dirname, '__golden__', 'checkout-dump.txt');

function entity(id: Id, title: string, groupId: Id | null = null): Element {
  return { id, kind: 'entity', type: 'component', title, description: '', tags: {}, sources: [], groupId };
}

function connection(
  id: Id,
  title: string,
  from: Id[],
  to: Id[],
  direction: Connection['direction'] = 'forward',
): Connection {
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
    direction,
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

describe('dumpDocument', () => {
  it('renders elements, connections, and comments in a stable order', () => {
    const document = doc(
      [
        entity('ui', 'Checkout UI'),
        entity('payments', 'Payments'),
        entity('gateway', 'Payment gateway', 'payments'),
        node('decision', 'Card ok?', { 'settle': 'funds held' }),
        connection('authorise', 'authorise', ['ui'], ['gateway']),
        connection('settle', '', ['decision'], ['gateway', 'ui'], 'both'),
      ],
      [{ id: 'c1', text: 'about the document', targets: [] }],
    );

    expect(dumpDocument(document)).toBe(
      [
        'Checkout domain',
        '3 entities, 1 connection node, 2 connections, 0 notes, 1 comment',
        '',
        'elements',
        '  decision  connection-node  diamond    Card ok?',
        '  gateway   entity           component  Payment gateway  (in payments)',
        '  payments  entity           component  Payments',
        '  ui        entity           component  Checkout UI',
        '',
        'connections',
        '  authorise  interaction  Checkout UI -> Payment gateway  "authorise"',
        '  settle     interaction  Card ok? <-> Payment gateway, Checkout UI  [funds held]',
        '',
        'comments',
        '  c1  on the document',
        '    about the document',
      ].join('\n'),
    );
  });

  it('leaves out empty sections and shows their zero counts', () => {
    const document = doc([entity('ui', 'Checkout UI')]);
    expect(dumpDocument(document)).toBe(
      [
        'Checkout domain',
        '1 entity, 0 connection nodes, 0 connections, 0 notes, 0 comments',
        '',
        'elements',
        '  ui  entity  component  Checkout UI',
      ].join('\n'),
    );
  });

  it('falls back to ids where titles are empty', () => {
    const document = doc([
      entity('a', ''),
      entity('b', ''),
      connection('link', '', ['a'], ['b']),
    ]);
    expect(dumpDocument(document)).toContain('  link  interaction  a -> b');
  });

  it('dumps the checkout fixture to the golden text', () => {
    const parsed = parseDocument(readFileSync(FIXTURE, 'utf8'));
    if (!parsed.ok) throw new Error('fixture failed to parse');
    expectMatchesGolden(`${dumpDocument(parsed.document)}\n`, GOLDEN);
  });
});
