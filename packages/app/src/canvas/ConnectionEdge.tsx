import { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { Point } from '@modl/core';
import { store } from '../store/store.js';
import type { ConnectionEdgeData } from './derive.js';
import { ElementEditor } from './ElementEditor.js';
import { ElementHover } from './ElementHover.js';
import { ElementIcon } from './ElementIcon.js';
import { InlineTitle } from './InlineTitle.js';
import { stopEditing } from './editing.js';

/** A polyline through the waypoints, rounded at each bend. */
function routedPath(from: Point, waypoints: Point[], to: Point): string {
  const points = [from, ...waypoints, to];
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/**
 * Where a new bend can be added: a third of the way along each segment and
 * two thirds along it. The midpoint is left free because the label sits
 * there, and a handle on top of it would swallow the double-click that
 * renames the connection.
 */
function addHandles(from: Point, waypoints: Point[], to: Point): { at: Point; index: number }[] {
  const points = [from, ...waypoints, to];
  const handles: { at: Point; index: number }[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (const t of [1 / 3, 2 / 3]) {
      handles.push({ at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, index: i });
    }
  }
  return handles;
}

/** Midpoint of the whole route, where the label goes. */
function routeMidpoint(from: Point, waypoints: Point[], to: Point): Point {
  const points = [from, ...waypoints, to];
  const middle = Math.floor((points.length - 1) / 2);
  const a = points[middle]!;
  const b = points[middle + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * A connection. Hand-placed waypoints reroute it, and arrowheads are opt-in
 * because `from` and `to` already carry the direction.
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
  const { screenToFlowPosition } = useReactFlow();
  const connectionId = data?.connectionId ?? id;
  const waypoints = data?.waypoints ?? [];

  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };

  const [bezier, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const routed = waypoints.length > 0;
  const path = routed ? routedPath(source, waypoints, target) : bezier;
  const handles = addHandles(source, waypoints, target);
  const labelPoint = routed
    ? routeMidpoint(source, waypoints, target)
    : { x: bezierLabelX, y: bezierLabelY };

  const dimmed = data?.dimmed ?? false;

  /** Drags a bend, committing one command on release. */
  const dragWaypoint = useCallback(
    (index: number) => (event: React.PointerEvent) => {
      event.stopPropagation();
      (event.target as Element).setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        const at = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        const next = waypoints.map((point, i) => (i === index ? at : point));
        store.dispatch({ type: 'set-waypoints', id: connectionId, waypoints: next });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [connectionId, waypoints, screenToFlowPosition],
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`connection-edge${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
        {...(data?.arrowStart ? { markerStart: 'url(#modl-arrow-start)' } : {})}
        {...(data?.arrowEnd ? { markerEnd: 'url(#modl-arrow-end)' } : {})}
      />

      <EdgeLabelRenderer>
        {/* Handles live in this layer rather than the edge SVG so they stack
            above the label instead of being swallowed by it. */}
        {selected && (
          <div className="waypoints" data-testid={`waypoints-${connectionId}`}>
            {handles.map((handle, position) => (
              <button
                type="button"
                key={`add-${position}`}
                className="waypoint waypoint--add nodrag nopan"
                data-testid={`waypoint-add-${connectionId}-${position}`}
                aria-label="Add a bend"
                style={{ transform: `translate(-50%, -50%) translate(${handle.at.x}px, ${handle.at.y}px)` }}
                onClick={(event) => {
                  event.stopPropagation();
                  const next = [...waypoints];
                  next.splice(handle.index, 0, handle.at);
                  store.dispatch({ type: 'set-waypoints', id: connectionId, waypoints: next });
                }}
              />
            ))}
            {waypoints.map((point, index) => (
              <button
                type="button"
                key={`bend-${index}`}
                className="waypoint waypoint--bend nodrag nopan"
                data-testid={`waypoint-${connectionId}-${index}`}
                aria-label="Drag to move this bend, double-click to remove it"
                style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
                onPointerDown={dragWaypoint(index)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  store.dispatch({
                    type: 'set-waypoints',
                    id: connectionId,
                    waypoints: waypoints.filter((_, i) => i !== index),
                  });
                }}
              />
            ))}
          </div>
        )}

        <div
          className={`edge-label${dimmed ? ' is-dimmed' : ''}${selected ? ' is-selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)` }}
          data-testid={`connection-${connectionId}`}
          data-connection-id={connectionId}
          data-type={data?.elementType}
        >
          {data?.editing ? (
            <InlineTitle
              id={connectionId}
              title={data.title}
              onDone={stopEditing}
              testId={`rename-${connectionId}`}
            />
          ) : (
            <span className="edge-label__title">
              {data ? <ElementIcon elementType={data.elementType} className="edge-label__icon" /> : null}
              {data?.title}
            </span>
          )}

          {data?.soleSelection ? (
            <div className="edge-label__editor">
              <ElementEditor
                id={connectionId}
                kind="connection"
                elementType={data.elementType}
                description={data.description}
                tags={data.tags}
                arrows={{ start: data.arrowStart, end: data.arrowEnd }}
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
