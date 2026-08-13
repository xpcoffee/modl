import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { store } from '../store/store.js';
import type { EntityNodeData } from './derive.js';
import { CommentBadge, NoteBadge } from './CommentMarker.js';
import { ElementEditor } from './ElementEditor.js';
import { ElementHover } from './ElementHover.js';
import { ElementIcon } from './ElementIcon.js';
import { InlineTitle } from './InlineTitle.js';
import { MIN_ENTITY_SIZE } from './derive.js';
import { stopEditing } from './editing.js';
import { boxCss } from './styling.js';

/**
 * A domain entity. The title and a type icon show always, the description and
 * tags on hover, and the editor when it is the only thing selected.
 *
 * Handles and the resizer sit beside the visual box, not inside it. The
 * warp-in animation scales the box, and React Flow measures handle positions
 * from the DOM when the node mounts: a handle inside a mid-scale box gets
 * cached closer to the centre than it rests, and every connection then
 * anchors inside the element.
 */
export function EntityNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={MIN_ENTITY_SIZE.width}
        minHeight={MIN_ENTITY_SIZE.height}
        onResizeEnd={(_, params) =>
          store.dispatch({
            type: 'resize-element',
            id: data.id,
            width: params.width,
            height: params.height,
          })
        }
      />

      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />

      <div
        className={`entity-node${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
        style={boxCss(data.style)}
        data-testid={`entity-${data.id}`}
        data-type={data.elementType}
      >
        {/* Expand sits where collapse sits on an open container, so the control
            for a group is in one place whichever way it is showing. */}
        <div className="entity-node__corner">
          {data.memberCount > 0 && (
            <button
              type="button"
              className="entity-node__expand nodrag"
              data-testid={`expand-${data.id}`}
              aria-label={`Expand ${data.title}`}
              onClick={() => store.dispatch({ type: 'set-expanded', id: data.id, expanded: true })}
            >
              + {data.memberCount}
            </button>
          )}
          {data.matchCount > 0 && (
            <span
              className="entity-node__matches"
              data-testid={`match-count-${data.id}`}
              aria-label={`${data.matchCount} filter ${data.matchCount === 1 ? 'match' : 'matches'} inside`}
            >
              {data.matchCount}
            </span>
          )}
          <NoteBadge id={data.id} count={data.noteCount} />
          <CommentBadge id={data.id} count={data.commentCount} />
          <ElementIcon elementType={data.elementType} className="entity-node__icon" />
        </div>

        {data.editing ? (
          <InlineTitle
            id={data.id}
            title={data.title}
            onDone={stopEditing}
            testId={`rename-${data.id}`}
          />
        ) : (
          <div className="entity-node__title">{data.title || <em>untitled</em>}</div>
        )}

        {data.soleSelection ? (
          <div className="entity-node__editor">
            <ElementEditor
              id={data.id}
              kind="entity"
              hidden={data.hidden}
              elementType={data.elementType}
              description={data.description}
              tags={data.tags}
            />
          </div>
        ) : (
          <div className="entity-node__hover">
            <ElementHover
              elementType={data.elementType}
              description={data.description}
              tags={data.tags}
            />
          </div>
        )}

      </div>
    </>
  );
}
