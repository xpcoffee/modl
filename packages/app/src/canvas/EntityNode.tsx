import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { readableName } from '@domain-mapper/core';
import type { EntityNodeData } from './derive.js';

/**
 * A domain entity. The title shows always; the readable name and tags appear
 * on hover, per the bootstrap spec.
 */
export function EntityNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
  const tags = Object.entries(data.tags);

  return (
    <div
      className={`entity-node${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
      data-testid={`entity-${data.id}`}
      data-title={data.title}
    >
      <Handle type="target" position={Position.Left} />
      <div className="entity-node__title">{data.title || <em>untitled</em>}</div>

      <div className="entity-node__hover">
        <div className="entity-node__name">{readableName(data.id)}</div>
        {tags.length > 0 && (
          <ul className="entity-node__tags">
            {tags.map(([key, value]) => (
              <li key={key}>
                {key}={value}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
