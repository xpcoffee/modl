import { useState } from 'react';
import {
  CONNECTION_TYPES,
  ENTITY_TYPES,
  isConnection,
  isEntity,
  readableName,
} from '@domain-mapper/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';

/**
 * Edits the selected element. Every change dispatches a command as it is
 * typed, so tags behave the same way the title does.
 */
export function Inspector() {
  const state = useAppState();
  const [draftKey, setDraftKey] = useState('');

  const id = state.selection[0];
  const element = id ? state.document.model.elements[id] : undefined;

  if (!element) {
    return (
      <aside className="inspector" data-testid="inspector">
        <p className="inspector__empty">Select an element to edit it.</p>
      </aside>
    );
  }

  const types = isEntity(element) ? ENTITY_TYPES : isConnection(element) ? CONNECTION_TYPES : [];

  /** Renaming a key removes the old one and writes the new one. */
  const renameTag = (from: string, to: string) => {
    const value = element.tags[from] ?? '';
    store.dispatch({ type: 'remove-tag', id: element.id, key: from });
    if (to.trim() !== '') {
      store.dispatch({ type: 'set-tag', id: element.id, key: to.trim(), value });
    }
  };

  /** Typing in the blank row creates the tag immediately. */
  const startTag = (key: string) => {
    setDraftKey(key);
    if (key.trim() === '') return;
    store.dispatch({ type: 'set-tag', id: element.id, key: key.trim(), value: '' });
    setDraftKey('');
  };

  return (
    <aside className="inspector" data-testid="inspector">
      <header className="inspector__header">
        <span className="inspector__kind">{element.kind}</span>
        <code className="inspector__name" data-testid="inspector-name">
          {readableName(element.id)}
        </code>
      </header>

      {types.length > 0 && (
        <label className="field">
          <span>Type</span>
          <select
            data-testid="inspector-type"
            value={'type' in element ? element.type : ''}
            onChange={(event) =>
              store.dispatch({
                type: 'set-element-type',
                id: element.id,
                elementType: event.target.value as (typeof types)[number],
              })
            }
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span>Title</span>
        <input
          data-testid="inspector-title"
          value={element.title}
          onChange={(event) =>
            store.dispatch({ type: 'set-metadata', id: element.id, title: event.target.value })
          }
        />
      </label>

      <label className="field">
        <span>Description</span>
        <textarea
          data-testid="inspector-description"
          rows={4}
          value={element.description}
          onChange={(event) =>
            store.dispatch({
              type: 'set-metadata',
              id: element.id,
              description: event.target.value,
            })
          }
        />
      </label>

      <div className="field">
        <span>Tags</span>
        <ul className="tag-list" data-testid="inspector-tags">
          {Object.entries(element.tags).map(([key, value]) => (
            <li key={key}>
              <input
                aria-label={`Tag key ${key}`}
                className="tag-list__key"
                defaultValue={key}
                onBlur={(event) => event.target.value !== key && renameTag(key, event.target.value)}
              />
              <input
                aria-label={`Tag value for ${key}`}
                className="tag-list__value"
                value={value}
                onChange={(event) =>
                  store.dispatch({
                    type: 'set-tag',
                    id: element.id,
                    key,
                    value: event.target.value,
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove tag ${key}`}
                onClick={() => store.dispatch({ type: 'remove-tag', id: element.id, key })}
              >
                ×
              </button>
            </li>
          ))}
          <li>
            <input
              data-testid="tag-key"
              className="tag-list__key"
              placeholder="new tag"
              value={draftKey}
              onChange={(event) => startTag(event.target.value)}
            />
          </li>
        </ul>
      </div>

      <code className="inspector__id">{element.id}</code>
    </aside>
  );
}
