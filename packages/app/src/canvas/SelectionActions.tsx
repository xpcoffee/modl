import { useState } from 'react';
import { ViewportPortal, type Node } from '@xyflow/react';
import { isConnection, type Id } from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { DeleteButton } from './DeleteButton.js';
import { StyleEditor } from './StyleEditor.js';
import type { BoardNodeData } from './derive.js';

/**
 * Style, hide, show, and delete for a multi-selection, under the box that
 * holds it.
 *
 * A single selection carries its own editor, which travels with the element
 * for free. This reads the live React Flow nodes rather than the document, so
 * it keeps up while a drag is in flight.
 */
export function SelectionActions({ nodes }: { nodes: Node<BoardNodeData>[] }) {
  const state = useAppState();
  const { selection } = state;
  if (selection.length < 2) return null;

  // Connections cannot be hidden directly, so only the rest count. A mixed
  // selection offers both actions, each naming how many it touches.
  const hiddenSet = new Set(state.hidden);
  const elements = state.document.model.elements;
  const hideable = selection.filter((id) => {
    const element = elements[id];
    return element && !isConnection(element) && !hiddenSet.has(id);
  });
  const showable = selection.filter((id) => hiddenSet.has(id));
  // A comment attaches to elements; comment ids riding in the selection are
  // not something a new comment can discuss.
  const commentable = selection.filter((id) => elements[id] !== undefined);

  const chosen = new Set(selection);
  const boxes = nodes
    .filter((node) => chosen.has(node.id))
    .map((node) => {
      const origin = (node.data.parentOrigin as { x: number; y: number }) ?? { x: 0, y: 0 };
      return {
        x: node.position.x + origin.x,
        y: node.position.y + origin.y,
        width: node.measured?.width ?? 0,
        height: node.measured?.height ?? 0,
      };
    });

  if (boxes.length === 0) return null;

  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));

  return (
    <ViewportPortal>
      <div
        className="selection-actions nodrag nopan"
        data-testid="selection-actions"
        style={{ transform: `translate(${(left + right) / 2}px, ${bottom}px)` }}
      >
        {/* One panel for the whole selection: each row edits the elements it
            can mean something to, so a mixed selection still edits its
            components' fill. */}
        <div className="selection-actions__panel">
          <StyleEditor ids={selection} />
          {commentable.length > 0 && <CommentComposer targets={commentable} />}
          <footer className="element-editor__footer">
            {hideable.length > 0 && (
              <button
                type="button"
                data-testid="hide-selected"
                onClick={() => {
                  for (const id of hideable) {
                    store.dispatch({ type: 'set-hidden', id, hidden: true });
                  }
                }}
              >
                Hide {hideable.length}
              </button>
            )}
            {showable.length > 0 && (
              <button
                type="button"
                data-testid="show-selected"
                onClick={() => {
                  for (const id of showable) {
                    store.dispatch({ type: 'set-hidden', id, hidden: false });
                  }
                }}
              >
                Show {showable.length}
              </button>
            )}
            <DeleteButton count={selection.length} />
          </footer>
        </div>
      </div>
    </ViewportPortal>
  );
}

/**
 * One comment across the whole selection, which is what a remark about a
 * flow rather than a box needs (issue #37). The single-element editor covers
 * commenting on one thing; this is the only place a multi-target comment can
 * be written.
 */
function CommentComposer({ targets }: { targets: Id[] }) {
  const [text, setText] = useState('');

  return (
    <div className="comment-composer nodrag nowheel" onKeyDown={(event) => event.stopPropagation()}>
      <textarea
        data-testid="comment-selected-text"
        placeholder={`Comment on ${targets.length} elements`}
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="button"
        data-testid="comment-selected"
        disabled={text.trim() === ''}
        onClick={() => {
          const result = store.dispatch({
            type: 'create-comment',
            id: crypto.randomUUID(),
            text,
            targets,
            createdAt: new Date().toISOString(),
          });
          if (result.ok) setText('');
        }}
      >
        Comment
      </button>
    </div>
  );
}
