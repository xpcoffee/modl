import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  connectionAnchors,
  cyclicGroupIds,
  descendantsOf,
  groupIds,
  isGroup,
  isRendered,
  membersOf,
  visibleAnchor,
  wouldCycle,
} from './groups.js';
import type { Element, Id } from '../model/types.js';

const OUTER = '10000000-0000-4000-8000-000000000000';
const INNER = '20000000-0000-4000-8000-000000000000';
const LEAF = '30000000-0000-4000-8000-000000000000';
const OUTSIDE = '40000000-0000-4000-8000-000000000000';
const LINK = '50000000-0000-4000-8000-000000000000';

function entity(id: Id, groupId: Id | null = null): Element {
  return { id, kind: 'entity', type: 'component', title: id, description: '', tags: {}, sources: [], groupId };
}

function connection(id: Id, from: Id[], to: Id[]): Element {
  return {
    id,
    kind: 'connection',
    type: 'interaction',
    title: '',
    description: '',
    tags: {},
    sources: [],
    groupId: null,
    from,
    to,
  };
}

/** outer > inner > leaf, plus an unrelated entity joined to the leaf. */
const NESTED: Record<Id, Element> = {
  [OUTER]: entity(OUTER),
  [INNER]: entity(INNER, OUTER),
  [LEAF]: entity(LEAF, INNER),
  [OUTSIDE]: entity(OUTSIDE),
  [LINK]: connection(LINK, [OUTSIDE], [LEAF]),
};

describe('membership', () => {
  it('lists direct members only', () => {
    expect(membersOf(NESTED, OUTER).map((e) => e.id)).toEqual([INNER]);
  });

  it('lists ancestors nearest first', () => {
    expect(ancestorsOf(NESTED, LEAF)).toEqual([INNER, OUTER]);
  });

  it('lists descendants at every depth', () => {
    expect(descendantsOf(NESTED, OUTER).sort()).toEqual([INNER, LEAF].sort());
  });

  it('identifies groups', () => {
    expect(isGroup(NESTED, OUTER)).toBe(true);
    expect(isGroup(NESTED, LEAF)).toBe(false);
  });

  it('lists every group', () => {
    expect(groupIds(NESTED)).toEqual([INNER, OUTER].sort());
  });
});

describe('cycles', () => {
  it('rejects an element joining itself', () => {
    expect(wouldCycle(NESTED, OUTER, OUTER)).toBe(true);
  });

  it('rejects a group joining its own descendant', () => {
    expect(wouldCycle(NESTED, OUTER, LEAF)).toBe(true);
  });

  it('allows an unrelated move', () => {
    expect(wouldCycle(NESTED, OUTSIDE, OUTER)).toBe(false);
  });

  it('allows clearing a group', () => {
    expect(wouldCycle(NESTED, LEAF, null)).toBe(false);
  });

  it('finds no cycle in a sound document', () => {
    expect(cyclicGroupIds(NESTED)).toEqual([]);
  });

  it('finds a two-element cycle', () => {
    const looped = { ...NESTED, [OUTER]: entity(OUTER, LEAF) };
    expect(cyclicGroupIds(looped).length).toBeGreaterThan(0);
  });

  it('terminates on a self-reference', () => {
    const looped = { ...NESTED, [OUTSIDE]: entity(OUTSIDE, OUTSIDE) };
    expect(cyclicGroupIds(looped)).toContain(OUTSIDE);
  });
});

describe('rendering', () => {
  it('hides members while their group stays collapsed', () => {
    expect(isRendered(NESTED, LEAF, new Set())).toBe(false);
    expect(isRendered(NESTED, OUTER, new Set())).toBe(true);
  });

  it('needs every ancestor expanded to show a nested element', () => {
    expect(isRendered(NESTED, LEAF, new Set([INNER]))).toBe(false);
    expect(isRendered(NESTED, LEAF, new Set([OUTER, INNER]))).toBe(true);
  });

  it('anchors a hidden element to the outermost collapsed group', () => {
    expect(visibleAnchor(NESTED, LEAF, new Set())).toBe(OUTER);
    expect(visibleAnchor(NESTED, LEAF, new Set([OUTER]))).toBe(INNER);
    expect(visibleAnchor(NESTED, LEAF, new Set([OUTER, INNER]))).toBe(LEAF);
  });

  it('anchors a root element to itself', () => {
    expect(visibleAnchor(NESTED, OUTSIDE, new Set())).toBe(OUTSIDE);
  });
});

describe('connectionAnchors', () => {
  it('re-points a connection at the collapsed group', () => {
    expect(connectionAnchors(NESTED, LINK, new Set())).toEqual({ from: [OUTSIDE], to: [OUTER] });
  });

  it('points at the element once its groups are open', () => {
    expect(connectionAnchors(NESTED, LINK, new Set([OUTER, INNER]))).toEqual({
      from: [OUTSIDE],
      to: [LEAF],
    });
  });

  it('drops a connection whose ends collapse into one group', () => {
    const internal = {
      ...NESTED,
      [OUTSIDE]: entity(OUTSIDE, INNER),
    };
    expect(connectionAnchors(internal, LINK, new Set())).toBeNull();
  });

  it('returns null for an element that is not a connection', () => {
    expect(connectionAnchors(NESTED, OUTER, new Set())).toBeNull();
  });
});
