import { store } from '../store/store.js';

/** Removes whatever is selected. Placed with the selection, never in a toolbar. */
export function DeleteButton({ count }: { count: number }) {
  return (
    <button
      type="button"
      className="delete-button nodrag nopan"
      data-testid="delete-selected"
      aria-label={count === 1 ? 'Delete element' : `Delete ${count} elements`}
      title="Delete"
      onClick={() => {
        for (const id of store.getState().selection) {
          store.dispatch({ type: 'delete-element', id });
        }
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M4 6.5h16M9.5 6.5V4.8h5v1.7M6.5 6.5 7.4 20h9.2l.9-13.5" strokeLinecap="round" />
        <path d="M10.3 10v6.4M13.7 10v6.4" strokeLinecap="round" />
      </svg>
      {count > 1 && <span>{count}</span>}
    </button>
  );
}
