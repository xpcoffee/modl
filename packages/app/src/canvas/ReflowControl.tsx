import { ControlButton } from '@xyflow/react';
import { planReflow } from '@modl/core';
import { store } from '../store/store.js';

/**
 * Reflow in the board's control cluster: one press re-spaces the board so
 * that neighbours clear each other and line labels have room, keeping every
 * element's place in the reading order (issue #43). It acts on the board in
 * front of you, like undo and the spotlight, which is why it lives here
 * rather than in the toolbar.
 */
export function ReflowControl() {
  return (
    <ControlButton
      data-testid="board-reflow"
      title="Reflow layout"
      aria-label="Reflow layout"
      onClick={() => {
        const plan = planReflow(store.getState());
        if (plan === null) return;
        store.dispatch({ type: 'reflow-layout', ...plan });
      }}
    >
      {/* Four boxes settled into a tidy grid: what a press leaves behind. */}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h6v6H4V4zm2 2v2h2V6H6zm8-2h6v6h-6V4zm2 2v2h2V6h-2zM4 14h6v6H4v-6zm2 2v2h2v-2H6zm8-2h6v6h-6v-6zm2 2v2h2v-2h-2z" />
      </svg>
    </ControlButton>
  );
}
