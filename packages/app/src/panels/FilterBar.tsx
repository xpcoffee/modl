import { useEffect, useState } from 'react';
import { parseFilter, tagKeys } from '@domain-mapper/core';
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
  const keys = tagKeys(state.document.model.elements);

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
          placeholder="team=payments -deprecated"
          value={text}
          onChange={(event) => change(event.target.value)}
        />
      </label>

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
