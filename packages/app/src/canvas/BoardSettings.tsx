import { ControlButton } from '@xyflow/react';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';

/**
 * Board settings in the control cluster, beside React Flow's lock.
 *
 * Selecting mutes the rest of the board by default, and not every reader wants
 * that. The preference used to live in the filter bar; issue #33 removed that
 * bar, and this is where it belongs anyway, with the other switch that
 * changes how the board behaves rather than what it holds.
 */
export function BoardSettings() {
  const state = useAppState();
  const on = state.selectionHighlight;

  return (
    <ControlButton
      data-testid="highlight-toggle"
      className={on ? 'is-on' : undefined}
      aria-pressed={on}
      title={on ? 'Highlight selection: on' : 'Highlight selection: off'}
      aria-label={on ? 'Highlight selection: on' : 'Highlight selection: off'}
      onClick={() => store.dispatch({ type: 'set-selection-highlight', enabled: !on })}
    >
      {/* A spotlight: a cone of light picking one thing out of the dark. */}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 4 19h16L12 3zm0 4.6 4.6 9.4H7.4L12 7.6z" />
        <circle cx="12" cy="14.5" r="2.2" />
      </svg>
    </ControlButton>
  );
}
