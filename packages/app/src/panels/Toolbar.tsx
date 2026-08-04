import { useRef, useState } from 'react';
import { isGroup, parseDocument, selectIds } from '@modl/core';
import { store } from '../store/store.js';
import { PLACEABLE, arm, usePending } from '../canvas/placement.js';
import { useAppState } from '../store/useStore.js';

/** Downloads text as a file. */
function download(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Toolbar() {
  const state = useAppState();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const pending = usePending();
  const [picking, setPicking] = useState(false);

  const visible = selectIds(state.document.model.elements, state.filter).size;
  const total = Object.keys(state.document.model.elements).length;

  /**
   * Starts a container around whatever is selected, or an empty one when
   * nothing is. It opens expanded so there is a box to drag elements into,
   * and an entity that never gains a member stays an ordinary entity.
   */
  const groupSelected = () => {
    const positions = state.selection
      .map((id) => state.document.layout[id])
      .filter((entry): entry is { x: number; y: number; width: number; height: number } =>
        entry !== undefined && 'x' in entry,
      );
    // group-elements sizes the box around its members itself.
    const position =
      positions.length > 0
        ? { x: positions[0]!.x, y: positions[0]!.y }
        : { x: 60, y: 60 };

    const id = crypto.randomUUID();
    store.dispatch({
      type: 'group-elements',
      id,
      title: 'New group',
      memberIds: state.selection,
      position,
    });
    store.dispatch({ type: 'set-expanded', id, expanded: true });
  };

  const ungroupSelected = () => {
    for (const id of state.selection) store.dispatch({ type: 'ungroup', id });
  };

  const canUngroup = state.selection.some((id) =>
    isGroup(state.document.model.elements, id),
  );

  const openFile = async (file: File) => {
    const result = parseDocument(await file.text());
    if (!result.ok) {
      setMessage(`Could not load: ${result.errors.map((e) => e.message).join('; ')}`);
      return;
    }
    const applied = store.dispatch({ type: 'load-document', document: result.document });
    setMessage(applied.ok ? `Loaded ${file.name}` : applied.error.message);
  };

  return (
    <header className="toolbar" data-testid="toolbar">
      <strong className="toolbar__brand">
        <img src="./modl.svg" alt="" width="20" height="20" />
        modl
      </strong>

      <div className="toolbar__add">
        <button
          type="button"
          data-testid="add-element"
          aria-expanded={picking}
          className={pending ? 'is-on' : undefined}
          onClick={() => setPicking((open) => !open)}
        >
          Add{pending ? `: ${PLACEABLE.find((entry) => entry.type === pending)?.label}` : ''}
        </button>

        {picking && (
          <ul className="toolbar__types" data-testid="add-types">
            {PLACEABLE.map((entry) => (
              <li key={entry.type}>
                <button
                  type="button"
                  data-testid={`add-type-${entry.type}`}
                  onClick={() => {
                    arm(entry.type);
                    setPicking(false);
                  }}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pending && (
        <span className="toolbar__hint" data-testid="placement-hint">
          click to place, or drag to size it
        </span>
      )}

      <button
        type="button"
        data-testid="group-selected"
        onClick={groupSelected}
        title="Start a group around the selection, or an empty one"
      >
        Group
      </button>
      <button
        type="button"
        data-testid="ungroup-selected"
        onClick={ungroupSelected}
        disabled={!canUngroup}
        title="Lift the members of the selected group out of it"
      >
        Ungroup
      </button>

      <span className="toolbar__divider" />

      <button
        type="button"
        data-testid="save"
        onClick={() => download('domain.modl.json', store.serialize())}
      >
        Save
      </button>
      <button type="button" data-testid="load" onClick={() => fileInput.current?.click()}>
        Load
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        data-testid="file-input"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        data-testid="export-trace"
        onClick={() => download('session.trace.json', `${JSON.stringify(store.getTrace(), null, 2)}\n`)}
      >
        Export trace
      </button>

      <span className="toolbar__spacer" />
      <span className="toolbar__count" data-testid="element-count">
        {visible === total ? `${total} elements` : `${visible} of ${total} elements`}
      </span>
      {message && (
        <span className="toolbar__message" data-testid="toolbar-message">
          {message}
        </span>
      )}
    </header>
  );
}
