import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ForkShape } from '@modl/core';
import { store } from '../store/store.js';
import type { ForkNodeData } from './derive.js';
import { ElementEditor } from './ElementEditor.js';
import { ElementHover } from './ElementHover.js';
import { InlineTitle } from './InlineTitle.js';
import { stopEditing } from './editing.js';

/**
 * A junction where connections fan in or fan out, drawn as a circle or a
 * diamond by the author's choice.
 *
 * It exists so a decision or a join is a thing in the model rather than an
 * arrangement of arrows a reader has to infer. Its title carries the question
 * or the condition; the connections leaving it carry the answers.
 *
 * Handles sit on all four sides, because a junction has no natural direction.
 */
export function ForkNode({ data, selected }: NodeProps<Node<ForkNodeData>>) {
  const next: ForkShape = data.shape === 'circle' ? 'diamond' : 'circle';

  return (
    <div
      className={`fork-node fork-node--${data.shape}${selected ? ' is-selected' : ''}${
        data.dimmed ? ' is-dimmed' : ''
      }`}
      data-testid={`fork-${data.id}`}
      data-shape={data.shape}
    >
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />

      <div className="fork-node__face" />

      <div className="fork-node__label">
        {data.editing ? (
          <InlineTitle
            id={data.id}
            title={data.title}
            onDone={stopEditing}
            testId={`rename-${data.id}`}
          />
        ) : (
          data.title && <span>{data.title}</span>
        )}
      </div>

      {selected && (
        <button
          type="button"
          className="fork-node__shape nodrag"
          data-testid={`fork-shape-${data.id}`}
          aria-label={`Draw as a ${next}`}
          title={`Draw as a ${next}`}
          onClick={() => store.dispatch({ type: 'set-fork-shape', id: data.id, shape: next })}
        >
          {next === 'diamond' ? '◇' : '○'}
        </button>
      )}

      {data.soleSelection ? (
        <div className="fork-node__editor">
          <ElementEditor
            id={data.id}
            kind="fork"
            elementType="fork"
            description={data.description}
            tags={data.tags}
          />
        </div>
      ) : (
        <div className="fork-node__hover">
          <ElementHover elementType="fork" description={data.description} tags={data.tags} />
        </div>
      )}
    </div>
  );
}
