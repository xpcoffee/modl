import { ControlButton } from '@xyflow/react';
import { isGroup } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';

/**
 * Board settings in the control cluster, beside React Flow's lock.
 *
 * Selecting mutes the rest of the board by default, and not every reader wants
 * that. The preference used to live in the filter bar; issue #33 removed that
 * bar, and this is where it belongs anyway, with the other switches over how
 * the board is viewed.
 *
 * The first-open toggle is the one control here that edits the document: it
 * captures the current expansion as `view.defaultExpanded`, the author's hint
 * for how the file opens (issue #50), and clears it on the next press.
 */
export function BoardSettings() {
  const state = useAppState();
  const on = state.selectionHighlight;
  const hinted = state.document.view.defaultExpanded !== undefined;

  const toggleFirstOpen = () => {
    const defaultExpanded = hinted
      ? null
      : [...state.expanded].filter((id) => isGroup(state.document.model.elements, id)).sort();
    store.dispatch({ type: 'set-default-expanded', defaultExpanded });
  };

  return (
    <>
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
      <ControlButton
        data-testid="first-open-toggle"
        className={hinted ? 'is-on' : undefined}
        aria-pressed={hinted}
        title={
          hinted
            ? 'First open: the saved expansion. Click to clear'
            : 'First open: collapsed. Click to save the current expansion'
        }
        aria-label={
          hinted
            ? 'First open: the saved expansion. Click to clear'
            : 'First open: collapsed. Click to save the current expansion'
        }
        onClick={toggleFirstOpen}
      >
        {/* Unfolding chevrons: the document opening itself up. */}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 7.5 6.5 9 8l3-3 3 3 1.5-1.5L12 2zm0 20 4.5-4.5L15 16l-3 3-3-3-1.5 1.5L12 22z" />
          <rect x="6" y="11" width="12" height="2" />
        </svg>
      </ControlButton>
    </>
  );
}
