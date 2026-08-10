/**
 * Fuzzy matching for the search menu.
 *
 * A query matches when its characters appear in order somewhere in the
 * candidate, which is what lets "chkui" find "Checkout UI". Order alone would
 * rank a buried match level with an obvious one, so matches are scored: a
 * character continuing the previous one counts most, one starting a word next,
 * and one landing mid-word least. Longer candidates lose a fraction of a
 * point, so a short title carrying the whole query beats a long one that
 * happens to contain it.
 */

/** Characters a new word can start after. */
const WORD_BOUNDARY = /[\s\-_/.:,()[\]]/;

/** How far a candidate's length keeps counting against it. */
const LENGTH_CEILING = 40;

const CONTIGUOUS = 3;
const WORD_START = 2;
const MID_WORD = 1;

/**
 * How well the query matches, or null when it does not match at all. Spaces
 * in the query are skipped rather than matched, so "customer order" finds
 * "CustomerOrder" as readily as "Customer Order".
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  const needle = query.trim().toLowerCase();
  const haystack = candidate.toLowerCase();
  if (needle === '') return 0;

  let score = 0;
  let from = 0;
  let previous = -1;

  for (const character of needle) {
    if (/\s/.test(character)) continue;

    const at = haystack.indexOf(character, from);
    if (at === -1) return null;

    if (at === previous + 1) score += CONTIGUOUS;
    else if (at === 0 || WORD_BOUNDARY.test(haystack[at - 1] ?? '')) score += WORD_START;
    else score += MID_WORD;

    previous = at;
    from = at + 1;
  }

  return score - Math.min(haystack.length, LENGTH_CEILING) / LENGTH_CEILING;
}

/** Whether the query matches at all, ignoring how well. */
export function fuzzyMatches(query: string, candidate: string): boolean {
  return fuzzyScore(query, candidate) !== null;
}
