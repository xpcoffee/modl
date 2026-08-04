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
    <div
      className={`connection-node connection-node--${data.shape}${selected ? ' is-selected' : ''}${
        data.dimmed ? ' is-dimmed' : ''
      }`}
      data-testid={`node-${data.id}`}
      data-shape={data.shape}
    >
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
        One connection point, at the middle, in four copies.
        
        A line's tangent comes from its handle's `position`, so a single
        centred handle made every connection leave in the same direction
        whatever it was heading towards. These four sit on top of each other
        at the centre and the renderer picks the one facing the way the line
        travels, which keeps the anchor central and the tangent honest.
      */}
      {(
        [
          [Position.Left, 'centre-left'],
          [Position.Right, 'centre-right'],
          [Position.Top, 'centre-top'],
          [Position.Bottom, 'centre-bottom'],
        ] as const
      ).map(([position, id]) => (
        <Handle key={id} type="source" position={position} id={id} className="handle--centre" />
      ))}

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
  );
}
