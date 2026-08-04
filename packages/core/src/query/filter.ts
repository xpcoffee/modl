import type { Element, Id } from '../model/types.js';

/**
 * Tag filter grammar, kept small on purpose:
 *
 *   expression := term (' ' term)*      terms combine with AND
 *   term       := ['-'] key '=' value   leading '-' negates
 *               | ['-'] key             matches any element carrying the key
 *   value      := literal | '*'         '*' matches any value
 */
export interface FilterTerm {
  negated: boolean;
  key: string;
  /** Absent matches any value, same as '*'. */
  value?: string;
}

export type FilterParseResult =
  | { ok: true; terms: FilterTerm[] }
  | { ok: false; message: string };

const TERM = /^(-?)([^=\s]+)(?:=(.*))?$/;

export function parseFilter(expression: string): FilterParseResult {
  const terms: FilterTerm[] = [];
  for (const token of expression.trim().split(/\s+/)) {
    if (token === '') continue;

    const match = TERM.exec(token);
    if (!match) {
      return { ok: false, message: `cannot read filter term "${token}"` };
    }
    const [, negation, key, value] = match;
    if (!key) {
      return { ok: false, message: `filter term "${token}" has no tag key` };
    }
    terms.push({
      negated: negation === '-',
      ...(value === undefined || value === '*' ? {} : { value }),
    key,
    });
  }
  return { ok: true, terms };
}

/**
 * True when the element satisfies every term. A key holds several values, and
 * a term matches when any one of them does.
 */
export function matchesTerms(element: Element, terms: FilterTerm[]): boolean {
  return terms.every((term) => {
    const actual = element.tags[term.key];
    const present =
      actual !== undefined &&
      actual.length >= 0 &&
      (term.value === undefined || actual.includes(term.value));
    return term.negated ? !present : present;
  });
}

/**
 * Ids the filter selects. An empty or unparseable expression selects
 * everything, so a half-typed filter leaves the board readable.
 */
export function selectIds(elements: Record<Id, Element>, expression: string): Set<Id> {
  const parsed = parseFilter(expression);
  const all = new Set(Object.keys(elements));
  if (!parsed.ok || parsed.terms.length === 0) return all;

  const selected = new Set<Id>();
  for (const [id, element] of Object.entries(elements)) {
    if (matchesTerms(element, parsed.terms)) selected.add(id);
  }
  return selected;
}

/** Every tag key in the document, sorted. Drives filter suggestions. */
export function tagKeys(elements: Record<Id, Element>): string[] {
  const keys = new Set<string>();
  for (const element of Object.values(elements)) {
    for (const key of Object.keys(element.tags)) keys.add(key);
  }
  return [...keys].sort();
}

/** Values recorded against a tag key, sorted. */
export function tagValues(elements: Record<Id, Element>, key: string): string[] {
  const values = new Set<string>();
  for (const element of Object.values(elements)) {
    for (const value of element.tags[key] ?? []) values.add(value);
  }
  return [...values].sort();
}
