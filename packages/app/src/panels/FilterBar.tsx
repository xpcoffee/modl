import { useEffect, useMemo, useState } from 'react';
import { parseFilter, tagKeys, tagValues } from '@domain-mapper/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';

/**
 * Filters the board by tag.
 *
 * The text box keeps its own state so a half-typed expression stays on screen.
 * Only a parseable expression reaches the command bus, which keeps the trace
 * free of keystroke-by-keystroke rejections.
 */
export function FilterBar() {
  const state = useAppState();
  const [text, setText] = useState(state.filter);

  // Follow the store when a load or replay changes the filter elsewhere.
  useEffect(() => setText(state.filter), [state.filter]);

  const parsed = parseFilter(text);
  const elements = state.document.model.elements;
  const keys = useMemo(() => tagKeys(elements), [elements]);

  /**
   * Completions for the term being typed. Once a key and '=' are present the
   * list narrows to the values recorded against that key.
   */
  const suggestions = useMemo(() => {
    const terms = text.split(/\s+/);
    const active = terms[terms.length - 1] ?? '';
    const prefix = terms.slice(0, -1).join(' ');
    const lead = prefix === '' ? '' : `${prefix} `;
    const negation = active.startsWith('-') ? '-' : '';
    const bare = negation ? active.slice(1) : active;

    if (bare.includes('=')) {
      const key = bare.slice(0, bare.indexOf('='));
      return tagValues(elements, key).map((value) => `${lead}${negation}${key}=${value}`);
    }
    // No '=' yet, so offer the bare key alongside every value it carries.
    return keys.flatMap((key) => [
      `${lead}${negation}${key}`,
      ...tagValues(elements, key).map((value) => `${lead}${negation}${key}=${value}`),
    ]);
  }, [text, elements, keys]);

  const change = (expression: string) => {
    setText(expression);
    if (parseFilter(expression).ok) store.dispatch({ type: 'set-filter', expression });
  };

  return (
    <div className="filter-bar" data-testid="filter-bar">
      <label className="filter-bar__field">
        <span>Filter</span>
        <input
          data-testid="filter-input"
          list="filter-suggestions"
          placeholder="team=payments -deprecated"
          autoComplete="off"
          value={text}
          onChange={(event) => change(event.target.value)}
        />
      </label>
      <datalist id="filter-suggestions" data-testid="filter-suggestions">
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      {parsed.ok ? null : (
        <span className="filter-bar__error" data-testid="filter-error">
          {parsed.message}
        </span>
      )}

      {keys.length > 0 && (
        <div className="filter-bar__keys">
          {keys.map((key) => (
            <button key={key} type="button" onClick={() => change(key)}>
              {key}
            </button>
          ))}
          <button type="button" data-testid="filter-clear" onClick={() => change('')}>
            clear
          </button>
        </div>
      )}
    </div>
  );
}
