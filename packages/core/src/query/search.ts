import type { AppState } from '../commands/types.js';
import { isConnection, isEntity, type Comment, type Element, type Id } from '../model/types.js';
import { readableName } from '../naming/readable-name.js';
import { fuzzyScore } from './fuzzy.js';
import { formatTerm, parseFilter, tagKeys, tagValues, type FilterTerm } from './filter.js';

/**
 * What the search menu offers for a query: filters to apply, and elements to
 * go to. See docs/decisions/015-search-and-filter-menu.md.
 *
 * The ordering rule is the feature: while the query still matches several
 * elements the reader is narrowing, so the option that makes the narrowing
 * permanent comes first. Once one element is left there is nothing to narrow,
 * so the list holds that element alone and the only act is going to it.
 */
export type SearchOption =
  | { kind: 'filter'; term: FilterTerm; label: string; score: number }
  | { kind: 'element'; id: Id; label: string; sublabel: string; score: number };

/** How an element reads in the list when it has no title of its own. */
export function elementLabel(element: Element): string {
  return element.title || readableName(element.id);
}

/** What kind of thing an option points at, under its name in the list. */
function kindLabel(element: Element): string {
  if (isEntity(element)) return element.type;
  if (isConnection(element)) return `${element.type} connection`;
  return `${element.shape} node`;
}

/**
 * Elements matching the query, best first. Ties break on the label so the
 * list is stable between renders rather than following object order.
 */
export function searchElements(
  elements: Record<Id, Element>,
  query: string,
): Extract<SearchOption, { kind: 'element' }>[] {
  if (query.trim() === '') return [];

  const hits: Extract<SearchOption, { kind: 'element' }>[] = [];
  for (const element of Object.values(elements)) {
    const label = elementLabel(element);
    const score = fuzzyScore(query, label);
    if (score === null) continue;
    hits.push({
      kind: 'element',
      id: element.id,
      label,
      sublabel: kindLabel(element),
      score,
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/**
 * Tag filters matching the query, best first. Every key is offered on its
 * own and paired with each of its values, which is what the filter bar's key
 * buttons and its datalist did between them.
 */
export function tagSuggestions(
  elements: Record<Id, Element>,
  query: string,
): Extract<SearchOption, { kind: 'filter' }>[] {
  const suggestions: Extract<SearchOption, { kind: 'filter' }>[] = [];

  const consider = (term: FilterTerm): void => {
    const label = formatTerm(term);
    const score = fuzzyScore(query, label);
    if (score === null) return;
    suggestions.push({ kind: 'filter', term, label, score });
  };

  for (const key of tagKeys(elements)) {
    // The reserved key cannot be written as a tag term: the grammar reads
    // `comment=x` back as a comment filter, so offering it here would apply
    // a different filter than the one chosen.
    if (key === 'comment') continue;
    consider({ kind: 'tag', negated: false, key });
    for (const value of tagValues(elements, key)) {
      consider({ kind: 'tag', negated: false, key, value });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/**
 * Comment filters matching the query. `comment` on its own shows everything
 * discussed, and a query found inside a comment's text is offered as
 * `comment=query`, which is how a remark is found from its words (issue #37).
 */
export function commentSuggestions(
  comments: Record<Id, Comment>,
  query: string,
): Extract<SearchOption, { kind: 'filter' }>[] {
  if (Object.keys(comments).length === 0) return [];

  const suggestions: Extract<SearchOption, { kind: 'filter' }>[] = [];
  const all: FilterTerm = { kind: 'comment', negated: false };
  const allScore = fuzzyScore(query, 'comment');
  if (allScore !== null) {
    suggestions.push({ kind: 'filter', term: all, label: formatTerm(all), score: allScore });
  }

  const trimmed = query.trim();
  const inText = Object.values(comments).some((comment) =>
    comment.text.toLowerCase().includes(trimmed.toLowerCase()),
  );
  if (trimmed !== '' && inText) {
    const term: FilterTerm = { kind: 'comment', negated: false, text: trimmed };
    // Above the bare `comment` chip: the reader typed words, and the option
    // carrying them is the one they are reaching for.
    suggestions.push({
      kind: 'filter',
      term,
      label: formatTerm(term),
      score: (allScore ?? 0) + 1,
    });
  }

  return suggestions.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

export interface SearchOptionsInput {
  /**
   * Leave elements out, for the filter editor: it changes which view the
   * board holds, and going to one element is a different act.
   */
  filtersOnly?: boolean;
  /**
   * Whether there is room for another filter. False at the cap, so the menu
   * stops offering one rather than offering one that would be refused.
   */
  allowNewFilter?: boolean;
}

/**
 * The menu's options for a query, in the order they are cycled through.
 *
 * A query that still matches several elements leads with the filter that
 * would make the narrowing permanent, then the tag filters that read like the
 * query, then the elements themselves. A query matching exactly one element
 * offers only that element.
 */
export function searchOptions(
  state: AppState,
  query: string,
  input: SearchOptionsInput = {},
): SearchOption[] {
  const elements = state.document.model.elements;
  const { filtersOnly = false, allowNewFilter = true } = input;
  const trimmed = query.trim();

  const hits = filtersOnly ? [] : searchElements(elements, trimmed);
  if (hits.length === 1) return hits;

  const filters: SearchOption[] = [];
  if (trimmed !== '' && allowNewFilter) {
    const term: FilterTerm = { kind: 'text', negated: false, text: trimmed };
    filters.push({ kind: 'filter', term, label: formatTerm(term), score: Number.POSITIVE_INFINITY });
  }
  if (allowNewFilter) {
    filters.push(...tagSuggestions(elements, trimmed));
    filters.push(...commentSuggestions(state.document.comments, trimmed));
  }

  return [...filters, ...hits];
}

/** How many filters are active, for the count on the menu's button. */
export function activeFilterTerms(expression: string): FilterTerm[] {
  const parsed = parseFilter(expression);
  return parsed.ok ? parsed.terms : [];
}
