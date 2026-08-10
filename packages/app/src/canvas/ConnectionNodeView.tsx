import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeShape } from '@modl/core';
import { store } from '../store/store.js';
import type { ConnectionNodeData } from './derive.js';
import { ElementEditor } from './ElementEditor.js';
import { ElementHover } from './ElementHover.js';
import { InlineTitle } from './InlineTitle.js';
import { MIN_NODE_SIZE } from './derive.js';
import { stopEditing } from './editing.js';
import { boxCss } from './styling.js';

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
export function ConnectionNodeView({ data, selected }: NodeProps<Node<ConnectionNodeData>>) {
  const next: NodeShape = data.shape === 'circle' ? 'diamond' : 'circle';
  // "connection point" read as the handles on a component, so: node.
  const label = (shape: NodeShape) => (shape === 'diamond' ? 'decision' : 'connection node');

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={MIN_NODE_SIZE.width}
        minHeight={MIN_NODE_SIZE.height}
        keepAspectRatio
        onResizeEnd={(_, params) =>
          store.dispatch({
            type: 'resize-element',
            id: data.id,
            width: params.width,
            height: params.height,
          })
        }
      />

      {/*
        A contact point at each vertex, which for a diamond drawn in this box
        is the middle of each side of it.

        They were stacked at the centre so a line met the junction at a point.
        One anchor meant every branch left from the same spot, and a decision's
        answers piled up on top of each other; a branch now leaves from its own
        vertex and carries its own label (issue #12).

        They sit beside the drawn shape rather than inside it, for the reason
        an entity's do: the warp-in animation scales that shape, and React Flow
        caches a handle's position from the DOM at mount, so a handle inside it
        is remembered pulled towards the middle.
      */}
      {(
        [
          [Position.Left, 'left'],
          [Position.Right, 'right'],
          [Position.Top, 'top'],
          [Position.Bottom, 'bottom'],
        ] as const
      ).map(([position, id]) => (
        <Handle key={id} type="source" position={position} id={id} className="handle--vertex" />
      ))}

      <div
        className={`connection-node connection-node--${data.shape}${selected ? ' is-selected' : ''}${
          data.dimmed ? ' is-dimmed' : ''
        }`}
        data-testid={`node-${data.id}`}
        data-shape={data.shape}
      >
        <div className="connection-node__face" style={boxCss(data.style)} />

        <div className="connection-node__label">
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
            className="connection-node__shape nodrag"
            data-testid={`node-shape-${data.id}`}
            aria-label={`Make this a ${label(next)}`}
            title={`Make this a ${label(next)}`}
            onClick={() => store.dispatch({ type: 'set-node-shape', id: data.id, shape: next })}
          >
            {next === 'diamond' ? '◇' : '○'}
          </button>
        )}

        {data.soleSelection ? (
          <div className="connection-node__editor">
            <ElementEditor
              id={data.id}
              kind="node"
              hidden={data.hidden}
              elementType={label(data.shape)}
              description={data.description}
              tags={data.tags}
            />
          </div>
        ) : (
          <div className="connection-node__hover">
            <ElementHover
              elementType={label(data.shape)}
              description={data.description}
              tags={data.tags}
            />
          </div>
        )}
      </div>
    </>
  );
}
