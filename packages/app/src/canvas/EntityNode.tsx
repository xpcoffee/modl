import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { store } from '../store/store.js';
import type { EntityNodeData } from './derive.js';
import { ElementEditor } from './ElementEditor.js';
import { ElementHover } from './ElementHover.js';
import { ElementIcon } from './ElementIcon.js';
import { InlineTitle } from './InlineTitle.js';
import { stopEditing } from './editing.js';

/**
 * A domain entity. The title and a type icon show always, the description and
 * tags on hover, and the editor when it is selected.
 */
export function EntityNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
  return (
    <div
      className={`entity-node${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
      data-testid={`entity-${data.id}`}
      data-type={data.elementType}
    >
      <Handle type="target" position={Position.Left} />

      <ElementIcon elementType={data.elementType} className="entity-node__icon" />

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

      {selected ? (
        <div className="entity-node__editor">
          <ElementEditor
            id={data.id}
            kind="entity"
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

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
