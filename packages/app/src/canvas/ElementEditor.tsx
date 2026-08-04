import { useState } from 'react';
import {
  CONNECTION_TYPES,
  ENTITY_TYPES,
  type ConnectionType,
  type EntityType,
  type Id,
} from '@modl/core';
import { store } from '../store/store.js';
import { DeleteButton } from './DeleteButton.js';
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
  arrows,
}: {
  id: Id;
  kind: 'entity' | 'connection' | 'fork';
  /** A fork has no type to choose, so its chip is a label rather than a menu. */
  elementType: EntityType | ConnectionType | 'fork';
  description: string;
  tags: Record<string, string[]>;
  /** Present for connections, which can carry a head at either end. */
  arrows?: { start: boolean; end: boolean };
}) {
  const [addingTag, setAddingTag] = useState(false);
  const [pickingType, setPickingType] = useState(false);
  const types: readonly string[] =
    kind === 'entity' ? ENTITY_TYPES : kind === 'connection' ? CONNECTION_TYPES : [];

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
          aria-label={
            types.length > 0 ? `Type: ${elementType}. Click to change` : `Type: ${elementType}`
          }
          disabled={types.length === 0}
          onClick={() => setPickingType((open) => !open)}
        >
          {elementType === 'fork' ? null : <ElementIcon elementType={elementType} />}
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

      {arrows && (
        <div className="element-editor__arrows" data-testid={`editor-arrows-${id}`}>
          <span>Arrows</span>
          <button
            type="button"
            data-testid={`editor-arrow-start-${id}`}
            aria-pressed={arrows.start}
            className={arrows.start ? 'is-on' : undefined}
            onClick={() =>
              store.dispatch({ type: 'set-arrowheads', id, start: !arrows.start, end: arrows.end })
            }
          >
            &#8592; start
          </button>
          <button
            type="button"
            data-testid={`editor-arrow-end-${id}`}
            aria-pressed={arrows.end}
            className={arrows.end ? 'is-on' : undefined}
            onClick={() =>
              store.dispatch({ type: 'set-arrowheads', id, start: arrows.start, end: !arrows.end })
            }
          >
            end &#8594;
          </button>
        </div>
      )}

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
        {Object.entries(tags).map(([key, values]) => (
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
              // Several values, comma separated: an element often belongs to
              // more than one flow or team at once.
              value={values.join(', ')}
              size={Math.max(values.join(', ').length, 3)}
              onChange={(event) =>
                store.dispatch({
                  type: 'set-tag',
                  id,
                  key,
                  values: event.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter((entry) => entry !== ''),
                })
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
                store.dispatch({ type: 'set-tag', id, key, values: [] });
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

      <footer className="element-editor__footer">
        <DeleteButton count={1} />
      </footer>
    </div>
  );
}
