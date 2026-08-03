import { useState } from 'react';
import {
  CONNECTION_TYPES,
  ENTITY_TYPES,
  type ConnectionType,
  type EntityType,
  type Id,
} from '@modl/core';
import { store } from '../store/store.js';
import { ElementIcon } from './ElementIcon.js';

/**
 * Editing surface attached to the selected element, so details are changed
 * where the element is rather than in a panel across the screen.
 *
 * `nodrag nopan nowheel` keep the canvas still while a field has focus, and
 * key events stop here so Delete edits text instead of removing the element.
 */
export function ElementEditor({
  id,
  kind,
  elementType,
  description,
  tags,
}: {
  id: Id;
  kind: 'entity' | 'connection';
  elementType: EntityType | ConnectionType;
  description: string;
  tags: Record<string, string>;
}) {
  const [addingTag, setAddingTag] = useState(false);
  const [pickingType, setPickingType] = useState(false);
  const types: readonly string[] = kind === 'entity' ? ENTITY_TYPES : CONNECTION_TYPES;

  return (
    <div
      className="element-editor nodrag nopan nowheel"
      data-testid={`editor-${id}`}
      onKeyDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="element-editor__row">
        <button
          type="button"
          className="element-editor__type"
          data-testid={`editor-type-${id}`}
          aria-label={`Type: ${elementType}. Click to change`}
          onClick={() => setPickingType((open) => !open)}
        >
          <ElementIcon elementType={elementType} />
          <span>{elementType}</span>
        </button>

        {pickingType && (
          <ul className="element-editor__types" data-testid={`editor-types-${id}`}>
            {types.map((type) => (
              <li key={type}>
                <button
                  type="button"
                  data-testid={`editor-type-${id}-${type}`}
                  className={type === elementType ? 'is-current' : undefined}
                  onClick={() => {
                    store.dispatch({
                      type: 'set-element-type',
                      id,
                      elementType: type as EntityType | ConnectionType,
                    });
                    setPickingType(false);
                  }}
                >
                  <ElementIcon elementType={type as EntityType | ConnectionType} />
                  {type}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <textarea
        className="element-editor__description"
        data-testid={`editor-description-${id}`}
        placeholder="Add a description"
        rows={2}
        value={description}
        onChange={(event) =>
          store.dispatch({ type: 'set-metadata', id, description: event.target.value })
        }
      />

      <ul className="element-editor__tags" data-testid={`editor-tags-${id}`}>
        {Object.entries(tags).map(([key, value]) => (
          <li key={key} className="tag-chip">
            <input
              className="tag-chip__key"
              aria-label={`Tag key ${key}`}
              defaultValue={key}
              size={Math.max(key.length, 3)}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next === key) return;
                const result = store.dispatch({ type: 'rename-tag', id, from: key, to: next });
                // A refused rename leaves the tag alone, so put the box back.
                if (!result.ok) event.target.value = key;
              }}
            />
            <span className="tag-chip__equals">=</span>
            <input
              className="tag-chip__value"
              aria-label={`Tag value for ${key}`}
              value={value}
              size={Math.max(value.length, 3)}
              onChange={(event) =>
                store.dispatch({ type: 'set-tag', id, key, value: event.target.value })
              }
            />
            <button
              type="button"
              aria-label={`Remove tag ${key}`}
              onClick={() => store.dispatch({ type: 'remove-tag', id, key })}
            >
              ×
            </button>
          </li>
        ))}

        <li>
          {addingTag ? (
            <input
              className="tag-chip__key"
              data-testid={`editor-new-tag-${id}`}
              placeholder="key"
              autoFocus
              onBlur={() => setAddingTag(false)}
              onChange={(event) => {
                const key = event.target.value.trim();
                if (key === '') return;
                store.dispatch({ type: 'set-tag', id, key, value: '' });
                setAddingTag(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="element-editor__add-tag"
              data-testid={`editor-add-tag-${id}`}
              onClick={() => setAddingTag(true)}
            >
              + tag
            </button>
          )}
        </li>
      </ul>
    </div>
  );
}
