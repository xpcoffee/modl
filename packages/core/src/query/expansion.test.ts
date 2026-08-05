import { describe, expect, it } from 'vitest';
import {
  collapseAllTargets,
  collapseNextLevelTargets,
  expandAllTargets,
  expandNextLevelTargets,
} from './expansion.js';
import type { Element, Id } from '../model/types.js';

const OUTER = 'outer';
const INNER_A = 'inner-a';
const INNER_B = 'inner-b';
const DEEP = 'deep';
const LEAF_A = 'leaf-a';
const LEAF_B = 'leaf-b';
const LONER = 'loner';

function entity(id: Id, groupId: Id | null = null): Element {
  return { id, kind: 'entity', type: 'component', title: id, description: '', tags: {}, sources: [], groupId };
}

/**
 * outer > inner-a > deep > leaf-a, outer > inner-b > leaf-b, and a loner
 * outside every group. Three group levels down one branch, two down the
 * other, so "next level" and "all" answer differently.
 */
const ELEMENTS: Record<Id, Element> = {
  [OUTER]: entity(OUTER),
  [INNER_A]: entity(INNER_A, OUTER),
  [INNER_B]: entity(INNER_B, OUTER),
  [DEEP]: entity(DEEP, INNER_A),
  [LEAF_A]: entity(LEAF_A, DEEP),
  [LEAF_B]: entity(LEAF_B, INNER_B),
  [LONER]: entity(LONER),
};

const NONE: ReadonlySet<Id> = new Set();
const ALL: ReadonlySet<Id> = new Set([OUTER, INNER_A, INNER_B, DEEP]);

describe('expandNextLevelTargets', () => {
  it('expands a collapsed item itself', () => {
    expect(expandNextLevelTargets(ELEMENTS, NONE, [OUTER])).toEqual([OUTER]);
  });

  it('expands the collapsed groups directly inside an expanded item', () => {
    expect(expandNextLevelTargets(ELEMENTS, new Set([OUTER]), [OUTER])).toEqual([INNER_A, INNER_B]);
  });

  it('reaches deeper only where every level above is open', () => {
    expect(expandNextLevelTargets(ELEMENTS, new Set([OUTER, INNER_A]), [OUTER])).toEqual([
      INNER_B,
      DEEP,
    ]);
  });

  it('does not reach through a collapsed group', () => {
    // deep is also collapsed, but expanding it under a collapsed inner-a
    // would change nothing visible.
    expect(expandNextLevelTargets(ELEMENTS, new Set([OUTER]), [INNER_A])).toEqual([INNER_A]);
  });

  it('is empty when nothing in scope is collapsed', () => {
    expect(expandNextLevelTargets(ELEMENTS, ALL, [INNER_A, INNER_B])).toEqual([]);
  });

  it('unions a selection that overlaps itself, without duplicates', () => {
    expect(expandNextLevelTargets(ELEMENTS, new Set([OUTER]), [OUTER, INNER_A])).toEqual([
      INNER_A,
      INNER_B,
    ]);
  });

  it('ignores items that are not groups', () => {
    expect(expandNextLevelTargets(ELEMENTS, NONE, [LONER])).toEqual([]);
  });
});

describe('collapseNextLevelTargets', () => {
  it('collapses only the expanded groups with nothing expanded below them', () => {
    expect(collapseNextLevelTargets(ELEMENTS, ALL, [INNER_A, INNER_B])).toEqual([INNER_B, DEEP]);
  });

  it('treats a selected expanded group as its own leaf', () => {
    expect(collapseNextLevelTargets(ELEMENTS, new Set([INNER_B]), [INNER_B])).toEqual([INNER_B]);
  });

  it('is empty when everything is collapsed', () => {
    expect(collapseNextLevelTargets(ELEMENTS, NONE, [INNER_A, INNER_B])).toEqual([]);
  });
});

describe('expandAllTargets', () => {
  it('expands every collapsed group at any depth, shallowest first', () => {
    expect(expandAllTargets(ELEMENTS, NONE, [OUTER])).toEqual([OUTER, INNER_A, INNER_B, DEEP]);
  });

  it('skips groups already expanded', () => {
    expect(expandAllTargets(ELEMENTS, new Set([OUTER, DEEP]), [OUTER])).toEqual([
      INNER_A,
      INNER_B,
    ]);
  });

  it('is empty when everything is expanded', () => {
    expect(expandAllTargets(ELEMENTS, ALL, [OUTER])).toEqual([]);
  });
});

describe('collapseAllTargets', () => {
  it('collapses every expanded group, root items first', () => {
    expect(collapseAllTargets(ELEMENTS, ALL, [INNER_A, INNER_B])).toEqual([
      INNER_A,
      INNER_B,
      DEEP,
    ]);
  });

  it('keeps roots-first order from an item downward', () => {
    expect(collapseAllTargets(ELEMENTS, ALL, [OUTER])).toEqual([OUTER, INNER_A, INNER_B, DEEP]);
  });

  it('is empty when everything is collapsed', () => {
    expect(collapseAllTargets(ELEMENTS, NONE, [INNER_A, INNER_B])).toEqual([]);
  });
});
