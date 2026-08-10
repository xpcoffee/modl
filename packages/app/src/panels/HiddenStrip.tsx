import { readableName } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';

/**
 * What the reader has put away, with a chip to bring each one back.
 *
 * This used to sit in the filter bar. The search menu that replaced the bar
 * opens on demand, and a list of things you cannot currently see is no use
 * behind a keystroke, so it keeps its own strip over the board. It draws
 * nothing at all while nothing is hidden. See decision 009 for why unhiding
 * lives in more than one place.
 */
export function HiddenStrip() {
  const state = useAppState();
  const elements = state.document.model.elements;
  if (state.hidden.length === 0) return null;

  return (
    <div className="hidden-strip" data-testid="hidden-list">
      <span>Hidden</span>
      {state.hidden.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`unhide-${id}`}
          aria-label={`Show ${elements[id]?.title || readableName(id)}`}
          onClick={() => store.dispatch({ type: 'set-hidden', id, hidden: false })}
        >
          {elements[id]?.title || readableName(id)} ×
        </button>
      ))}
      <button
        type="button"
        data-testid="unhide-all"
        onClick={() => {
          for (const id of state.hidden) {
            store.dispatch({ type: 'set-hidden', id, hidden: false });
          }
        }}
      >
        show all
      </button>
    </div>
  );
}
