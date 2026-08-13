import { ViewportPortal } from '@xyflow/react';
import { isConnection } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { DeleteButton } from './DeleteButton.js';
import { usePanelStop } from './focusRing.js';
import { StyleEditor } from './StyleEditor.js';
import { useDockedTransform } from './docking.js';

/**
 * Style, hide, show, and delete for a multi-selection, at the dock.
 *
 * A single selection carries its own editor, which travels with the element
 * for free. A multi-selection has no one element to anchor a panel to — a
 * select-all can span far past the viewport — so its panel always sits at
 * the dock (docs/decisions/024-menu-docking.md).
 */
export function SelectionActions() {
  const state = useAppState();
  const { selection } = state;
  const transform = useDockedTransform('panel', selection.length >= 2);
  const panelStop = usePanelStop();
  if (selection.length < 2) return null;

  // Connections cannot be hidden directly, so only the rest count. A mixed
  // selection offers both actions, each naming how many it touches.
  const hiddenSet = new Set(state.hidden);
  const elements = state.document.model.elements;
  const hideable = selection.filter((id) => {
    const element = elements[id];
    return element && !isConnection(element) && !hiddenSet.has(id);
  });
  const showable = selection.filter((id) => hiddenSet.has(id));

  return (
    <ViewportPortal>
      <div
        ref={panelStop.ref}
        tabIndex={panelStop.tabIndex}
        className="selection-actions nodrag nopan"
        data-testid="selection-actions"
        style={{ transform }}
        onKeyDown={panelStop.onKeyDown}
      >
        {/* One panel for the whole selection: each row edits the elements it
            can mean something to, so a mixed selection still edits its
            components' fill. */}
        <div className="selection-actions__panel">
          <StyleEditor ids={selection} />
          <footer className="element-editor__footer">
            {hideable.length > 0 && (
              <button
                type="button"
                data-testid="hide-selected"
                onClick={() => {
                  for (const id of hideable) {
                    store.dispatch({ type: 'set-hidden', id, hidden: true });
                  }
                }}
              >
                Hide {hideable.length}
              </button>
            )}
            {showable.length > 0 && (
              <button
                type="button"
                data-testid="show-selected"
                onClick={() => {
                  for (const id of showable) {
                    store.dispatch({ type: 'set-hidden', id, hidden: false });
                  }
                }}
              >
                Show {showable.length}
              </button>
            )}
            <DeleteButton count={selection.length} />
          </footer>
        </div>
      </div>
    </ViewportPortal>
  );
}
