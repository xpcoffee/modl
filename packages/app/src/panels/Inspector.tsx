import { useState } from 'react';
import { readableName } from '@domain-mapper/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';

/** Edits the selected element. Every change dispatches a command. */
export function Inspector() {
  const state = useAppState();
  const [tagKey, setTagKey] = useState('');
  const [tagValue, setTagValue] = useState('');

  const id = state.selection[0];
  const element = id ? state.document.model.elements[id] : undefined;

  if (!element) {
    return (
      <aside className="inspector" data-testid="inspector">
        <p className="inspector__empty">Select an element to edit it.</p>
      </aside>
    );
  }

  const addTag = () => {
    if (tagKey.trim() === '') return;
    store.dispatch({ type: 'set-tag', id: element.id, key: tagKey.trim(), value: tagValue.trim() });
    setTagKey('');
    setTagValue('');
  };

  return (
    <aside className="inspector" data-testid="inspector">
      <header className="inspector__header">
        <span className="inspector__kind">{element.kind}</span>
        <code className="inspector__name" data-testid="inspector-name">
          {readableName(element.id)}
        </code>
      </header>

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
              <code>
                {key}={value}
              </code>
              <button
                type="button"
                aria-label={`Remove tag ${key}`}
                onClick={() => store.dispatch({ type: 'remove-tag', id: element.id, key })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="tag-add">
          <input
            data-testid="tag-key"
            placeholder="key"
            value={tagKey}
            onChange={(event) => setTagKey(event.target.value)}
          />
          <input
            data-testid="tag-value"
            placeholder="value"
            value={tagValue}
            onChange={(event) => setTagValue(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && addTag()}
          />
          <button type="button" data-testid="tag-add" onClick={addTag}>
            Add
          </button>
        </div>
      </div>

      <code className="inspector__id">{element.id}</code>
    </aside>
  );
}
