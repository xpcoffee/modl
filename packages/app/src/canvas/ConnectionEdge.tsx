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

/**
 * A smooth curve through every waypoint, so adding a bend reshapes the line
 * rather than turning it into a polyline.
 *
 * Catmull-Rom through the points, converted to cubic beziers. The two ghost
 * points outside the ends set the tangents there, keeping the line leaving
 * the source and entering the target horizontally the way the plain bezier
 * does.
 */
function routedPath(from: Point, waypoints: Point[], to: Point): string {
  const inner = [from, ...waypoints, to];
  const reach = Math.min(80, Math.max(20, Math.abs(to.x - from.x) / 3));
  const points = [
    { x: from.x - reach, y: from.y },
    ...inner,
    { x: to.x + reach, y: to.y },
  ];

  let path = `M ${from.x} ${from.y}`;
  for (let i = 1; i < points.length - 2; i += 1) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2]!;

    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  }
  return path;
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

  // Parallel connections bow apart so three between one pair of components do
  // not land on top of each other.
  const spread = data?.spread ?? 0;
  const bowed = spread === 0 ? [] : [{ x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 + spread }];

  const routed = waypoints.length > 0 || bowed.length > 0;
  const path = routed ? routedPath(source, waypoints.length > 0 ? waypoints : bowed, target) : bezier;
  const handles = addHandles(source, waypoints, target);
  const labelPoint = routed
    ? routeMidpoint(source, waypoints.length > 0 ? waypoints : bowed, target)
    : { x: bezierLabelX, y: bezierLabelY };
  const rolledUp = (data?.rolledUp ?? []).length > 0;

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
        {selected && !rolledUp && (
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
          // A roll-up stands in for several connections, so it does not answer
          // to any one of their ids.
          data-testid={rolledUp ? `rollup-edge-${id}` : `connection-${connectionId}`}
          data-connection-id={rolledUp ? undefined : connectionId}
          data-type={data?.elementType}
        >
          {rolledUp ? (
            <span
              className="edge-label__title edge-label__rollup"
              data-testid={`rollup-${data?.rolledUp[0]}`}
              title={data?.description}
            >
              {data?.title}
            </span>
          ) : data?.editing ? (
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

          {data?.soleSelection && !rolledUp ? (
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
