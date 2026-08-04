import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { store } from '../store/store.js';
import type { EntityNodeData } from './derive.js';
import { ElementEditor } from './ElementEditor.js';
import { ElementHover } from './ElementHover.js';
import { ElementIcon } from './ElementIcon.js';
import { InlineTitle } from './InlineTitle.js';
import { MIN_GROUP_SIZE } from './derive.js';
import { stopEditing } from './editing.js';
import { boxCss } from './styling.js';

/**
 * An expanded entity: a container that holds whatever is dropped into it.
 * Collapsing puts the members away and leaves an ordinary node in its place,
 * which is how zooming out works.
 *
 * It is resizable, so a container can be opened up before anything joins it.
 */
export function GroupNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
  return (
    <div
      className={`group-node${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
      style={boxCss(data.style)}
      data-testid={`group-${data.id}`}
      data-expanded="true"
    >
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_GROUP_SIZE.width}
        minHeight={MIN_GROUP_SIZE.height}
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

      <header className="group-node__header">
        <button
          type="button"
          className="group-node__toggle nodrag"
          data-testid={`collapse-${data.id}`}
          aria-label={`Collapse ${data.title}`}
          onClick={() => store.dispatch({ type: 'set-expanded', id: data.id, expanded: false })}
        >
          −
        </button>

        <ElementIcon elementType={data.elementType} className="group-node__icon" />

        {data.editing ? (
          <InlineTitle
            id={data.id}
            title={data.title}
            onDone={stopEditing}
            testId={`rename-${data.id}`}
          />
        ) : (
          <span className="group-node__title">{data.title || <em>untitled</em>}</span>
        )}

        {data.memberCount === 0 && (
          <span className="group-node__empty">drop elements here</span>
        )}

      </header>

      {data.soleSelection ? (
        <div className="group-node__editor">
            <ElementEditor
              id={data.id}
              kind="entity"
              elementType={data.elementType}
              description={data.description}
              tags={data.tags}
            />
          </div>
        ) : (
        <div className="group-node__hover">
            <ElementHover
              elementType={data.elementType}
              description={data.description}
              tags={data.tags}
            />
          </div>
        )}

    </div>
  );
}
