import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { store } from '../store/store.js';
import type { EntityNodeData } from './derive.js';
import { ElementHover } from './ElementHover.js';
import { InlineTitle } from './InlineTitle.js';
import { stopEditing } from './editing.js';

/**
 * A domain entity. The title shows always. The type badge, description, and
 * tags appear on hover.
 */
export function EntityNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
  return (
    <div
      className={`entity-node${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
      data-testid={`entity-${data.id}`}
      data-type={data.elementType}
    >
      <Handle type="target" position={Position.Left} />

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

      <span className="entity-node__badge" data-testid={`badge-${data.id}`}>
        {data.elementType}
      </span>

      {data.memberCount > 0 && (
        <button
          type="button"
          className="entity-node__expand"
          data-testid={`expand-${data.id}`}
          aria-label={`Expand ${data.title}`}
          onClick={() => store.dispatch({ type: 'set-expanded', id: data.id, expanded: true })}
        >
          + {data.memberCount}
        </button>
      )}

      <div className="entity-node__hover">
        <ElementHover
          elementType={data.elementType}
          description={data.description}
          tags={data.tags}
        />
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
