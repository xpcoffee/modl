import { useRef, useState } from 'react';
import {
  CONNECTION_TYPES,
  ENTITY_TYPES,
  type ConnectionType,
  type Direction,
  type EntityType,
  type Id,
} from '@modl/core';
import { store } from '../store/store.js';
import { DeleteButton } from './DeleteButton.js';
import type { BoardComment } from './derive.js';
import { ElementIcon, type JunctionLabel } from './ElementIcon.js';
import { StyleEditor } from './StyleEditor.js';

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
  hidden,
  elementType,
  description,
  tags,
  direction,
  comments,
}: {
  id: Id;
  kind: 'entity' | 'connection' | 'node';
  /** True when the reader has put this element away. */
  hidden: boolean;
  /**
   * A connection point has no type to choose, so its chip is a label rather
   * than a menu, and it carries the reader's word for the shape.
   */
  elementType: EntityType | ConnectionType | 'connection node' | 'decision';
  description: string;
  tags: Record<string, string[]>;
  /** Present for connections: which way the connection reads. */
  direction?: Direction;
  /** Comments attached to this element, edited in place. */
  comments: BoardComment[];
}) {
  const [addingTag, setAddingTag] = useState(false);
  const [pickingType, setPickingType] = useState(false);
  /** The comment just added, so its box gets focus once it renders. */
  const [freshCommentId, setFreshCommentId] = useState<Id | null>(null);
  /**
   * What this element could be instead.
   *
   * An entity and a connection node are different kinds, but from a reader's
   * seat they are both "the thing in the box", so changing between them
   * belongs in the same list as changing an entity's type. A connection has
   * nothing to convert into, so it lists only its own types.
   */
  const types: readonly string[] =
    kind === 'connection'
      ? CONNECTION_TYPES
      : [...ENTITY_TYPES, 'connection node', 'decision'];

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
                    const junction = type === 'connection node' || type === 'decision';
                    const changesKind =
                      junction !== (elementType === 'connection node' || elementType === 'decision');

                    store.dispatch(
                      changesKind
                        ? {
                            type: 'convert-element',
                            id,
                            to: junction
                              ? type === 'decision'
                                ? 'decision'
                                : 'connection-node'
                              : (type as EntityType),
                          }
                        : junction
                          ? {
                              type: 'set-node-shape',
                              id,
                              shape: type === 'decision' ? 'diamond' : 'circle',
                            }
                          : {
                              type: 'set-element-type',
                              id,
                              elementType: type as EntityType | ConnectionType,
                            },
                    );
                    setPickingType(false);
                  }}
                >
                  <ElementIcon elementType={type as EntityType | ConnectionType | JunctionLabel} />
                  {type}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {direction && (
        <div className="element-editor__arrows" data-testid={`editor-arrows-${id}`}>
          {/* A head at each end, toggled separately. Every combination is
              reachable, and turning on the start alone flips the connection
              rather than inventing a second way to say backwards. */}
          <button
            type="button"
            data-testid={`editor-arrow-start-${id}`}
            aria-label="Arrowhead at the start"
            aria-pressed={direction === 'both'}
            className={direction === 'both' ? 'is-on' : undefined}
            onClick={() =>
              store.dispatch({
                type: 'set-arrowheads',
                id,
                start: direction !== 'both',
                end: direction === 'forward' || direction === 'both',
              })
            }
          >
            ←
          </button>
          <button
            type="button"
            data-testid={`editor-arrow-end-${id}`}
            aria-label="Arrowhead at the end"
            aria-pressed={direction === 'forward' || direction === 'both'}
            className={direction === 'forward' || direction === 'both' ? 'is-on' : undefined}
            onClick={() =>
              store.dispatch({
                type: 'set-arrowheads',
                id,
                start: direction === 'both',
                end: !(direction === 'forward' || direction === 'both'),
              })
            }
          >
            →
          </button>
        </div>
      )}

      <StyleEditor ids={[id]} />

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
          <TagChip key={key} id={id} tagKey={key} values={values} />
        ))}

        <li>
          {addingTag ? (
            <NewTagChip id={id} onDone={() => setAddingTag(false)} />
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

      <div className="element-editor__comments" data-testid={`editor-comments-${id}`}>
        {comments.map((comment) => (
          <CommentField
            key={comment.id}
            comment={comment}
            fresh={comment.id === freshCommentId}
          />
        ))}
        <button
          type="button"
          className="element-editor__add-comment"
          data-testid={`editor-add-comment-${id}`}
          onClick={() => {
            const commentId = crypto.randomUUID();
            const result = store.dispatch({
              type: 'create-comment',
              id: commentId,
              text: '',
              targets: [id],
              createdAt: new Date().toISOString(),
            });
            if (result.ok) setFreshCommentId(commentId);
          }}
        >
          + comment
        </button>
      </div>

      <footer className="element-editor__footer">
        {/* Hiding mutes the element and takes its connections off the board;
            the element stays selectable so this same button brings it back.
            A connection has no toggle: hidden it would leave no remnant to
            find it by, so it only leaves the board with its endpoints. */}
        {kind !== 'connection' && (
          <button
            type="button"
            className="element-editor__hide"
            data-testid={`editor-hide-${id}`}
            aria-pressed={hidden}
            onClick={() => store.dispatch({ type: 'set-hidden', id, hidden: !hidden })}
          >
            {hidden ? 'Show' : 'Hide'}
          </button>
        )}
        <DeleteButton count={1} />
      </footer>
    </div>
  );
}

/**
 * One comment, edited where it is read. Leaving an emptied comment deletes
 * it: a remark with no words left is resolved, and there is no other way a
 * blank one disappears without hunting for a delete control.
 */
function CommentField({ comment, fresh }: { comment: BoardComment; fresh: boolean }) {
  return (
    <div className="comment-field">
      <textarea
        data-testid={`editor-comment-${comment.id}`}
        placeholder="Write a comment"
        rows={2}
        autoFocus={fresh}
        value={comment.text}
        onChange={(event) =>
          store.dispatch({ type: 'set-comment-text', id: comment.id, text: event.target.value })
        }
        onBlur={(event) => {
          if (event.target.value.trim() === '') {
            store.dispatch({ type: 'delete-comment', id: comment.id });
          }
        }}
      />
      {/* One instance shared across elements: without saying so, an edit here
          showing up on another element reads as a bug. */}
      {comment.targetCount > 1 && (
        <span className="comment-field__span" data-testid={`editor-comment-span-${comment.id}`}>
          one comment across {comment.targetCount} elements; edits show on all of them
        </span>
      )}
      <button
        type="button"
        aria-label="Delete this comment"
        data-testid={`editor-delete-comment-${comment.id}`}
        onClick={() => store.dispatch({ type: 'delete-comment', id: comment.id })}
      >
        ×
      </button>
    </div>
  );
}

/** Several values, comma separated: an element often belongs to more than one
 * flow or team at once. */
function parseValues(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * One existing tag.
 *
 * The chip's React key is the tag key, so committing a rename remounts the
 * whole row. Renaming on the key input's own blur destroyed the value input
 * the reader had just tabbed into (issue #25); the rename now waits until
 * focus leaves the chip entirely.
 */
function TagChip({ id, tagKey, values }: { id: Id; tagKey: string; values: string[] }) {
  const keyInput = useRef<HTMLInputElement>(null);
  /**
   * The value text as typed. Parsing on every keystroke and rendering the
   * parsed values back would eat the comma or space the reader just typed,
   * so the raw text holds while the input has focus.
   */
  const [valueText, setValueText] = useState<string | null>(null);

  return (
    <li
      className="tag-chip"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setValueText(null);
        const input = keyInput.current;
        if (!input) return;
        const next = input.value.trim();
        if (next === tagKey) return;
        const result = store.dispatch({ type: 'rename-tag', id, from: tagKey, to: next });
        // A refused rename leaves the tag alone, so put the box back.
        if (!result.ok) input.value = tagKey;
      }}
    >
      <input
        ref={keyInput}
        className="tag-chip__key"
        aria-label={`Tag key ${tagKey}`}
        defaultValue={tagKey}
        size={Math.max(tagKey.length, 3)}
      />
      <span className="tag-chip__equals">=</span>
      <input
        className="tag-chip__value"
        aria-label={`Tag value for ${tagKey}`}
        value={valueText ?? values.join(', ')}
        size={Math.max((valueText ?? values.join(', ')).length, 3)}
        onChange={(event) => {
          setValueText(event.target.value);
          store.dispatch({ type: 'set-tag', id, key: tagKey, values: parseValues(event.target.value) });
        }}
      />
      <button
        type="button"
        aria-label={`Remove tag ${tagKey}`}
        onClick={() => store.dispatch({ type: 'remove-tag', id, key: tagKey })}
      >
        ×
      </button>
    </li>
  );
}

/**
 * The row a new tag is typed into.
 *
 * Both fields stay local until the reader finishes: dispatching on the first
 * keystroke re-rendered the row and threw focus out mid-word (issue #25).
 * Enter or leaving the row commits; Escape or an empty key abandons it.
 */
function NewTagChip({ id, onDone }: { id: Id; onDone: () => void }) {
  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const done = useRef(false);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const key = draftKey.trim();
    if (commit && key !== '') {
      store.dispatch({ type: 'set-tag', id, key, values: parseValues(draftValue) });
    }
    onDone();
  };

  return (
    <span
      className="tag-chip"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        finish(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      }}
    >
      <input
        className="tag-chip__key"
        data-testid={`editor-new-tag-${id}`}
        aria-label="New tag key"
        placeholder="key"
        autoFocus
        value={draftKey}
        size={Math.max(draftKey.length, 3)}
        onChange={(event) => setDraftKey(event.target.value)}
      />
      <span className="tag-chip__equals">=</span>
      <input
        className="tag-chip__value"
        data-testid={`editor-new-tag-value-${id}`}
        aria-label="New tag value"
        placeholder="value"
        value={draftValue}
        size={Math.max(draftValue.length, 5)}
        onChange={(event) => setDraftValue(event.target.value)}
      />
    </span>
  );
}
