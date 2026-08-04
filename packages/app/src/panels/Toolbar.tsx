import { useRef, useState } from 'react';
import {
  ENTITY_TYPES,
  isGroup,
  parseDocument,
  selectIds,
  type EntityType,
} from '@modl/core';
import { store } from '../store/store.js';
import { setNewElementType, useNewElementType } from '../canvas/newElementType.js';
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
  const entityType = useNewElementType();

  const visible = selectIds(state.document.model.elements, state.filter).size;
  const total = Object.keys(state.document.model.elements).length;

  const addEntity = () => {
    store.dispatch({
      type: 'create-entity',
      id: crypto.randomUUID(),
      entityType,
      title: `New ${entityType}`,
      position: { x: 40 + total * 30, y: 40 + total * 20 },
    });
  };

  /** A junction, so a decision or a join is a thing rather than an inference. */
  const addFork = () => {
    store.dispatch({
      type: 'create-fork',
      id: crypto.randomUUID(),
      shape: 'diamond',
      title: '',
      position: { x: 60 + total * 30, y: 140 + total * 20 },
    });
  };

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

      <select
        data-testid="entity-type"
        aria-label="Type for new elements"
        value={entityType}
        onChange={(event) => setNewElementType(event.target.value as EntityType)}
      >
        {ENTITY_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <button type="button" data-testid="add-entity" onClick={addEntity}>
        Add
      </button>
      <button
        type="button"
        data-testid="add-fork"
        onClick={addFork}
        title="A point where connections fan in or out. Make it a diamond for a decision"
      >
        Add connection point
      </button>
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
