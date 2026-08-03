import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { ConnectionEdgeData } from './derive.js';
import { ElementEditor } from './ElementEditor.js';
import { ElementHover } from './ElementHover.js';
import { ElementIcon } from './ElementIcon.js';
import { InlineTitle } from './InlineTitle.js';
import { stopEditing } from './editing.js';

/**
 * A connection. The label carries the title, and hovering it reveals the type
 * badge, description, and tags the same way an entity does.
 */
export function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<Edge<ConnectionEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const dimmed = data?.dimmed ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`connection-edge${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
      />
      <EdgeLabelRenderer>
        <div
          className={`edge-label${dimmed ? ' is-dimmed' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          data-testid={`connection-${data?.connectionId}`}
          data-connection-id={data?.connectionId}
          data-type={data?.elementType}
        >
          {data?.editing ? (
            <InlineTitle
              id={data.connectionId}
              title={data.title}
              onDone={stopEditing}
              testId={`rename-${data.connectionId}`}
            />
          ) : (
            <span className="edge-label__title">
              {data ? <ElementIcon elementType={data.elementType} className="edge-label__icon" /> : null}
              {data?.title}
            </span>
          )}

          {selected && data ? (
            <div className="edge-label__editor">
              <ElementEditor
                id={data.connectionId}
                kind="connection"
                elementType={data.elementType}
                description={data.description}
                tags={data.tags}
              />
            </div>
          ) : (
            <div className="edge-label__hover">
              <ElementHover
                elementType={data?.elementType ?? ''}
                description={data?.description ?? ''}
                tags={data?.tags ?? {}}
              />
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
