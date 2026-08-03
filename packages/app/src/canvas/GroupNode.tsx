import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { store } from '../store/store.js';
import type { EntityNodeData } from './derive.js';
import { ElementHover } from './ElementHover.js';
import { InlineTitle } from './InlineTitle.js';
import { stopEditing } from './editing.js';

/**
 * An expanded group: a container holding its members. Collapsing it puts the
 * members away and leaves an ordinary-looking node in its place, which is how
 * zooming out works.
 */
export function GroupNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
  return (
    <div
      className={`group-node${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
      data-testid={`group-${data.id}`}
      data-expanded="true"
    >
      <Handle type="target" position={Position.Left} />

      <header className="group-node__header">
        <button
          type="button"
          className="group-node__toggle"
          data-testid={`collapse-${data.id}`}
          aria-label={`Collapse ${data.title}`}
          onClick={() => store.dispatch({ type: 'set-expanded', id: data.id, expanded: false })}
        >
          −
        </button>

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

        <span className="group-node__badge">{data.elementType}</span>

        <div className="group-node__hover">
          <ElementHover
            elementType={data.elementType}
            description={data.description}
            tags={data.tags}
          />
        </div>
      </header>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
