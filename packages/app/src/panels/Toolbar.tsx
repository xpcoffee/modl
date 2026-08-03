import { useRef, useState } from 'react';
import { ENTITY_TYPES, parseDocument, selectIds, type EntityType } from '@domain-mapper/core';
import { store } from '../store/store.js';
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
  const [entityType, setEntityType] = useState<EntityType>('component');

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

  const deleteSelected = () => {
    for (const id of state.selection) store.dispatch({ type: 'delete-element', id });
  };

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
      <strong className="toolbar__brand">domain-mapper</strong>

      <select
        data-testid="entity-type"
        aria-label="Type for new elements"
        value={entityType}
        onChange={(event) => setEntityType(event.target.value as EntityType)}
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
        data-testid="delete-selected"
        onClick={deleteSelected}
        disabled={state.selection.length === 0}
      >
        Delete
      </button>

      <span className="toolbar__divider" />

      <button
        type="button"
        data-testid="save"
        onClick={() => download('domain.dmap.json', store.serialize())}
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
