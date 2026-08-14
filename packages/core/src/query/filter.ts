import type { Comment, Element, Id, Note } from '../model/types.js';
import { readableName } from '../naming/readable-name.js';
import { fuzzyMatches } from './fuzzy.js';

/**
 * Filter grammar, kept small on purpose:
 *
 *   expression := term (' ' term)*      terms combine with AND
 *   term       := ['-'] '"' text '"'    fuzzy match on title, '-' negates
 *               | ['-'] key '=' value   leading '-' negates
 *               | ['-'] key             matches any element carrying the key
 *   value      := literal | '*'         '*' matches any value
 *
 * A key or value holding a space is written in double quotes, so a tag like
 * `flow=user login` stays one term (issue #94). A quoted key always carries
 * an explicit value, since a bare quoted token reads as a text term.
 *
 * A text term is the non-tag filter issue #33 asks for: the search menu turns
 * whatever someone typed into one of these, so a view narrowed by name can be
 * made permanent the same way a tag filter is. It is quoted so a name with a
 * space stays one term, and so a bare word keeps meaning "carries this tag
 * key", which is what it meant before.
 *
 * The key `comment` is reserved: `comment` matches every element a comment
 * is attached to, and `comment=text` narrows to comments containing `text`.
 * The key `note` is reserved the same way for notes (issue #83). A tag key
 * literally named "comment" or "note" stays reachable by quoting the key:
 * `"comment"=todo` filters on the tag, and `"comment"=*` matches any value
 * of it. A quoted key is always read literally as a tag, never as the
 * reserved word, so both filters coexist (issue #37).
 */
export interface TagTerm {
  kind: 'tag';
  negated: boolean;
  key: string;
  /** Absent matches any value, same as '*'. */
  value?: string;
}

export interface TextTerm {
  kind: 'text';
  negated: boolean;
  /** Matched fuzzily against the element's title, then its readable name. */
  text: string;
}

export interface CommentTerm {
  kind: 'comment';
  negated: boolean;
  /**
   * Matched as a case-insensitive substring of an attached comment's text.
   * Substring rather than fuzzy: comment text is prose, and a fuzzy match
   * across a sentence catches far more than anyone typed. Absent matches any
   * comment.
   */
  text?: string;
}

export interface NoteTerm {
  kind: 'note';
  negated: boolean;
  /**
   * Matched as a case-insensitive substring of an attached note's text, the
   * same rule a comment term follows: note text is prose, and a fuzzy match
   * across a sentence catches far more than anyone typed. Absent matches any
   * note.
   */
  text?: string;
}

export type FilterTerm = TagTerm | TextTerm | CommentTerm | NoteTerm;

export type FilterParseResult =
  | { ok: true; terms: FilterTerm[] }
  | { ok: false; message: string };

/**
 * How many terms the search menu lets a reader stack up. Not enforced here:
 * an expression arriving from a trace or the runtime API is honoured whatever
 * its length, and the menu is what declines to add a sixth.
 */
export const MAX_FILTERS = 5;

const TAG = /^(-?)("[^"]+"|[^=\s]+)(?:=(.*))?$/;
const TEXT = /^(-?)"(.*)"$/;

/**
 * The tokenizer keeps quotes in place, so a value written `"user login"`
 * arrives here still wearing them. The quotes are the tokenizer's, not part
 * of the value.
 */
function unquoteValue(value: string | undefined): string | undefined {
  if (value !== undefined && value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Splits on whitespace, except inside double quotes. Written out rather than
 * done with a regex because an unclosed quote has to be reportable: silently
 * treating it as closed would filter the board by something nobody typed.
 */
function tokenize(expression: string): { ok: true; tokens: string[] } | { ok: false; message: string } {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (const character of expression) {
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (!quoted && /\s/.test(character)) {
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }
    current += character;
  }

  if (quoted) return { ok: false, message: 'filter has an unclosed quote' };
  if (current !== '') tokens.push(current);
  return { ok: true, tokens };
}

export function parseFilter(expression: string): FilterParseResult {
  const tokenized = tokenize(expression);
  if (!tokenized.ok) return tokenized;

  const terms: FilterTerm[] = [];
  for (const token of tokenized.tokens) {
    const text = TEXT.exec(token);
    if (text) {
      const [, negation, body] = text;
      if (!body) {
        return { ok: false, message: `filter term ${token} has no text` };
      }
      terms.push({ kind: 'text', negated: negation === '-', text: body });
      continue;
    }

    const match = TAG.exec(token);
    if (!match) {
      return { ok: false, message: `cannot read filter term "${token}"` };
    }
    const [, negation, key, value] = match;
    if (!key) {
      return { ok: false, message: `filter term "${token}" has no tag key` };
    }
    // A quoted key is a literal tag key, which is how a tag named "comment"
    // stays reachable past the reserved word.
    const literalKey = /^"(.+)"$/.exec(key)?.[1];
    const unquoted = unquoteValue(value);
    if (literalKey !== undefined) {
      terms.push({
        kind: 'tag',
        negated: negation === '-',
        ...(unquoted === undefined || unquoted === '*' ? {} : { value: unquoted }),
        key: literalKey,
      });
      continue;
    }
    if (key === 'comment' || key === 'note') {
      terms.push({
        kind: key,
        negated: negation === '-',
        ...(unquoted === undefined || unquoted === '*' ? {} : { text: unquoted }),
      });
      continue;
    }
    terms.push({
      kind: 'tag',
      negated: negation === '-',
      ...(unquoted === undefined || unquoted === '*' ? {} : { value: unquoted }),
      key,
    });
  }
  return { ok: true, terms };
}

/** A term as it reads in an expression. `parseFilter` reads back what this writes. */
export function formatTerm(term: FilterTerm): string {
  const negation = term.negated ? '-' : '';
  if (term.kind === 'text') return `${negation}"${term.text}"`;
  if (term.kind === 'comment' || term.kind === 'note') {
    if (term.text === undefined) return `${negation}${term.kind}`;
    const text = /\s/.test(term.text) ? `"${term.text}"` : term.text;
    return `${negation}${term.kind}=${text}`;
  }
  // A value holding a space is quoted, so the tokenizer keeps it one term
  // rather than one per word (issue #94).
  const value =
    term.value !== undefined && /\s/.test(term.value) ? `"${term.value}"` : term.value;
  // A tag key that collides with a reserved word, or holds a space, is
  // written quoted, and with an explicit value: a bare quoted key would read
  // back as a text term.
  if (term.key === 'comment' || term.key === 'note' || /\s/.test(term.key)) {
    return `${negation}"${term.key}"=${value ?? '*'}`;
  }
  return `${negation}${term.key}${value === undefined ? '' : `=${value}`}`;
}

/** Terms joined back into one expression. */
export function formatFilter(terms: readonly FilterTerm[]): string {
  return terms.map(formatTerm).join(' ');
}

/**
 * The expression with one more term on the end. An expression that does not
 * parse is replaced rather than appended to, since there is nothing to keep.
 */
export function addTerm(expression: string, term: FilterTerm): string {
  const parsed = parseFilter(expression);
  return formatFilter(parsed.ok ? [...parsed.terms, term] : [term]);
}

/**
 * The expression with the term at `index` replaced, or removed when the
 * replacement is null. Out-of-range indexes leave the expression alone, so a
 * chip clicked as the filter changes underneath cannot rewrite a neighbour.
 */
export function replaceTerm(
  expression: string,
  index: number,
  term: FilterTerm | null,
): string {
  const parsed = parseFilter(expression);
  if (!parsed.ok || index < 0 || index >= parsed.terms.length) return expression;

  const terms = [...parsed.terms];
  if (term === null) terms.splice(index, 1);
  else terms[index] = term;
  return formatFilter(terms);
}

/**
 * The name a text term is matched against. An untitled element answers to
 * its readable name, which is what the board and the traces call it; a titled
 * one answers to its title alone, so a filter cannot catch an element on a
 * name nobody sees.
 */
function searchableName(element: Element): string {
  return element.title || readableName(element.id);
}

/**
 * True when the element satisfies every term. A key holds several values, and
 * a term matches when any one of them does. A comment term reads the
 * document's comments and a note term the model's notes, so a caller
 * filtering on them passes the maps along.
 */
export function matchesTerms(
  element: Element,
  terms: readonly FilterTerm[],
  comments: Record<Id, Comment> = {},
  notes: Record<Id, Note> = {},
): boolean {
  return terms.every((term) => {
    const present =
      term.kind === 'text'
        ? fuzzyMatches(term.text, searchableName(element))
        : term.kind === 'comment'
          ? hasComment(element, term, comments)
          : term.kind === 'note'
            ? hasNote(element, term, notes)
            : hasTag(element, term, notes);
    return term.negated ? !present : present;
  });
}

/**
 * An element carries a tag through its own `tags`, or through a note
 * attached to it: a note's tags describe the elements it targets, so a tag
 * filter reaches them too.
 */
function hasTag(element: Element, term: TagTerm, notes: Record<Id, Note>): boolean {
  if (tagsMatch(element.tags, term)) return true;
  return Object.values(notes).some(
    (note) => note.targets.includes(element.id) && tagsMatch(note.tags, term),
  );
}

function tagsMatch(tags: Record<string, string[]>, term: TagTerm): boolean {
  const actual = tags[term.key];
  return actual !== undefined && (term.value === undefined || actual.includes(term.value));
}

function hasComment(
  element: Element,
  term: CommentTerm,
  comments: Record<Id, Comment>,
): boolean {
  return Object.values(comments).some(
    (comment) =>
      comment.targets.includes(element.id) &&
      (term.text === undefined ||
        comment.text.toLowerCase().includes(term.text.toLowerCase())),
  );
}

function hasNote(element: Element, term: NoteTerm, notes: Record<Id, Note>): boolean {
  return Object.values(notes).some(
    (note) =>
      note.targets.includes(element.id) &&
      (term.text === undefined || note.text.toLowerCase().includes(term.text.toLowerCase())),
  );
}

/**
 * Ids the filter selects. An empty or unparseable expression selects
 * everything, so a half-typed filter leaves the board readable.
 */
export function selectIds(
  elements: Record<Id, Element>,
  expression: string,
  comments: Record<Id, Comment> = {},
  notes: Record<Id, Note> = {},
): Set<Id> {
  const parsed = parseFilter(expression);
  const all = new Set(Object.keys(elements));
  if (!parsed.ok || parsed.terms.length === 0) return all;

  const selected = new Set<Id>();
  for (const [id, element] of Object.entries(elements)) {
    if (matchesTerms(element, parsed.terms, comments, notes)) selected.add(id);
  }
  return selected;
}

/**
 * Ids of the notes whose own tags satisfy every tag term in the filter. Text,
 * comment, and note terms are ignored: they pick elements rather than
 * describe notes. An expression with no tag term in it satisfies every note,
 * so a caller that needs a tag to have been asked for checks that itself; see
 * `visibleNoteIds`.
 */
export function notesMatchingTagTerms(
  notes: Record<Id, Note>,
  terms: readonly FilterTerm[],
): Set<Id> {
  const matching = new Set<Id>();
  for (const [id, note] of Object.entries(notes)) {
    const matches = terms.every((term) => {
      if (term.kind !== 'tag') return true;
      const present = tagsMatch(note.tags, term);
      return term.negated ? !present : present;
    });
    if (matches) matching.add(id);
  }
  return matching;
}

/** Every tag key on an element or a note, sorted. Drives filter suggestions. */
export function tagKeys(
  elements: Record<Id, Element>,
  notes: Record<Id, Note> = {},
): string[] {
  const keys = new Set<string>();
  for (const holder of [...Object.values(elements), ...Object.values(notes)]) {
    for (const key of Object.keys(holder.tags)) keys.add(key);
  }
  return [...keys].sort();
}

/** Values recorded against a tag key, on elements and notes, sorted. */
export function tagValues(
  elements: Record<Id, Element>,
  key: string,
  notes: Record<Id, Note> = {},
): string[] {
  const values = new Set<string>();
  for (const holder of [...Object.values(elements), ...Object.values(notes)]) {
    for (const value of holder.tags[key] ?? []) values.add(value);
  }
  return [...values].sort();
}
