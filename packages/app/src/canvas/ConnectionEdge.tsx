import { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { Position } from '@xyflow/react';
import type { Point } from '@modl/core';
import { store } from '../store/store.js';
import type { ConnectionEdgeData } from './derive.js';
import { CommentBadge, NoteBadge } from './CommentMarker.js';
import { ElementEditor } from './ElementEditor.js';
import { ElementHover } from './ElementHover.js';
import { ElementIcon } from './ElementIcon.js';
import { InlineTitle } from './InlineTitle.js';
import { stopEditing } from './editing.js';
import { lineCss, markerRefs } from './styling.js';

/** The way out of an element, given the side a line leaves from. */
function outward(position: Position): Point {
  if (position === Position.Left) return { x: -1, y: 0 };
  if (position === Position.Right) return { x: 1, y: 0 };
  if (position === Position.Top) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

/**
 * How far a line's way out points away from where it is going: 0 when the
 * side faces the other element at all, up to 1 when it faces straight back.
 */
function turnedAway(normal: Point, at: Point, towards: Point): number {
  const span = { x: towards.x - at.x, y: towards.y - at.y };
  const length = Math.hypot(span.x, span.y) || 1;
  return Math.max(0, -(normal.x * span.x + normal.y * span.y) / length);
}

/**
 * As far out as a line ever sets off before turning. What it is getting around
 * is its own element, and that stays the same size however far away the other
 * end is, so past this there is nothing left to gain.
 */
const FURTHEST = 250;

/**
 * How much further out a line has to set off to get clear of its own element.
 *
 * Squared, so a side that only just points the wrong way is barely touched
 * and one facing straight back gets the whole detour. Two lines placed a
 * degree apart come out a hair apart, rather than one taking a detour the
 * other does not.
 *
 * The 2.3 is the smallest that keeps a line clear of its own box when the
 * other end is a junction: a junction anchors on the vertex facing the line,
 * which is half its width nearer than the middle it used to anchor at, and
 * that much less room to turn in.
 */
function standoff(normal: Point, at: Point, towards: Point): Point {
  const away = turnedAway(normal, at, towards);
  if (away === 0) return { x: 0, y: 0 };
  const span = Math.hypot(towards.x - at.x, towards.y - at.y);
  const reach = Math.min(away * away * span * 2.3, FURTHEST);
  return { x: normal.x * reach, y: normal.y * reach };
}

/** The two control points of a cubic path, so a line can be shifted off it. */
function controlsOf(path: string): [Point, Point] | null {
  const parts = /^M\s*(\S+),(\S+)\s*C\s*(\S+),(\S+)\s+(\S+),(\S+)\s+(\S+),(\S+)$/.exec(path.trim());
  if (!parts) return null;
  const numbers = parts.slice(1).map(Number);
  if (numbers.some(Number.isNaN)) return null;
  return [
    { x: numbers[2]!, y: numbers[3]! },
    { x: numbers[4]!, y: numbers[5]! },
  ];
}

/**
 * The same line with its control points moved.
 *
 * Every adjustment a line needs is one of these. Moving a control point never
 * moves the end it belongs to, so the line stays on its handle whatever is
 * asked of it, and the result is still the cubic React Flow drew rather than a
 * different kind of curve beside it. Moving both by the same amount slides the
 * line sideways by `3·|by|·t(1-t)`: nothing at the ends, most in the middle.
 */
function reshaped(path: string, atSource: Point, atTarget: Point): string {
  const controls = controlsOf(path);
  if (!controls) return path;
  const ends = /^M\s*(\S+,\S+)\s*C\s*\S+,\S+\s+\S+,\S+\s+(\S+,\S+)$/.exec(path.trim());
  if (!ends) return path;
  const [first, second] = controls;
  return (
    `M ${ends[1]!.replace(',', ' ')}` +
    ` C ${first.x + atSource.x} ${first.y + atSource.y},` +
    ` ${second.x + atTarget.x} ${second.y + atTarget.y},` +
    ` ${ends[2]!.replace(',', ' ')}`
  );
}

/**
 * How far a line moves aside to clear the ones already between the same pair
 * of handles. Small, and the same step each time, so a third line reads as one
 * more in a bundle. The line already on the board is rank 0 and never moves.
 */
const SEPARATION = 26;

/** Sideways from the straight run between two points, always the same way. */
function aside(from: Point, to: Point, by: number): Point {
  const span = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.hypot(span.x, span.y) || 1;
  return { x: (-span.y / length) * by, y: (span.x / length) * by };
}

/**
 * A smooth curve through every waypoint, so adding a bend reshapes the line
 * rather than turning it into a polyline.
 *
 * Catmull-Rom through the points, converted to cubic beziers. Each end gets a
 * point pushed straight out along its normal, and a ghost beyond that, so the
 * line leaves and arrives perpendicular to the side it touches.
 */
function routedPath(
  from: Point,
  waypoints: Point[],
  to: Point,
  exits: { source: Point; target: Point },
): string {
  // Matches React Flow's own control offset, so a line drawn here sits along
  // the curve it would have drawn rather than cutting across it.
  const reach = Math.hypot(to.x - from.x, to.y - from.y) * 0.25;
  // Ghosts sit behind each end along its own normal, which sets the tangent
  // there: a hand-bent line still leaves the way the plain bezier would.
  const before = { x: from.x - exits.source.x * reach, y: from.y - exits.source.y * reach };
  const after = { x: to.x - exits.target.x * reach, y: to.y - exits.target.y * reach };
  const points = [before, from, ...waypoints, to, after];

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

/**
 * How far along the line a decision's label sits, in pixels from the junction,
 * and the most of the line it is allowed to take on a short run. Far enough
 * out to clear the diamond, near enough that it reads as belonging to that end
 * rather than to the connection.
 */
const END_LABEL_REACH = 56;
const END_LABEL_SHARE = 0.35;

/** Where an end label goes: along the line, out from the end it belongs to. */
function endLabelPoint(at: Point, towards: Point): Point {
  const span = { x: towards.x - at.x, y: towards.y - at.y };
  const length = Math.hypot(span.x, span.y) || 1;
  const reach = Math.min(END_LABEL_REACH, length * END_LABEL_SHARE);
  return { x: at.x + (span.x / length) * reach, y: at.y + (span.y / length) * reach };
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

  // Ends sit exactly on their handles, always.
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

  /*
   * Two things move a line off the path React Flow drew, and both are matters
   * of degree. It sets off further out the more its side faces away from where
   * it is going, and further aside the more lines already run between the same
   * two handles. A line whose side points where it is headed and has the pair
   * to itself is left alone: at nothing to answer for, both come to zero.
   */
  const rank = data?.rank ?? 0;
  const sideways = aside(source, target, rank * SEPARATION);
  const out = {
    source: standoff(outward(sourcePosition), source, target),
    target: standoff(outward(targetPosition), target, source),
  };

  const routed = waypoints.length > 0;
  const path = routed
    ? routedPath(source, waypoints, target, {
        source: outward(sourcePosition),
        target: outward(targetPosition),
      })
    : reshaped(
        bezier,
        { x: sideways.x + out.source.x, y: sideways.y + out.source.y },
        { x: sideways.x + out.target.x, y: sideways.y + out.target.y },
      );

  const handles = addHandles(source, waypoints, target);
  // The label rides with the line. Halfway along, a cubic sits three eighths
  // of its two control moves off the one it came from.
  const carry = {
    x: (sideways.x * 2 + out.source.x + out.target.x) * 0.375,
    y: (sideways.y * 2 + out.source.y + out.target.y) * 0.375,
  };
  const labelPoint = routed
    ? routeMidpoint(source, waypoints, target)
    : { x: bezierLabelX + carry.x, y: bezierLabelY + carry.y };
  const rolledUp = (data?.rolledUp ?? []).length > 0;

  const dimmed = data?.dimmed ?? false;
  const highlighted = data?.highlighted ?? false;

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
        className={`connection-edge${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}${highlighted ? ' is-highlighted' : ''}`}
        style={lineCss(data?.style)}
        {...(data?.direction === 'both' ? { markerStart: markerRefs(data?.style).start } : {})}
        {...(data?.direction === 'forward' || data?.direction === 'both'
          ? { markerEnd: markerRefs(data?.style).end }
          : {})}
      />

      <EdgeLabelRenderer>
        {/* What a decision's branch answers, drawn at the decision's end of
            the line, and part of the drawing rather than something to go
            looking for. Reading the junction or the line brings its answers
            forward; a line between two decisions carries one at each end. */}
        {(data?.endLabels ?? []).map((label) => {
          const at = label.atSource ? source : target;
          const point = endLabelPoint(at, label.atSource ? target : source);
          return (
            <div
              key={label.nodeId}
              className={`decision-label${dimmed ? ' is-dimmed' : ''}${label.read ? ' is-read' : ''}`}
              data-testid={`decision-label-${label.nodeId}-${connectionId}`}
              style={{
                transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
              }}
            >
              {label.text}
            </div>
          );
        })}

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
          className={`edge-label${dimmed ? ' is-dimmed' : ''}${selected ? ' is-selected' : ''}${highlighted ? ' is-highlighted' : ''}`}
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
              <NoteBadge id={connectionId} count={data?.noteCount ?? 0} />
              <CommentBadge id={connectionId} count={data?.commentCount ?? 0} />
            </span>
          )}

          {data?.soleSelection && !rolledUp ? (
            <div className="edge-label__editor">
              <ElementEditor
                id={connectionId}
                kind="connection"
                hidden={false}
                elementType={data.elementType}
                description={data.description}
                tags={data.tags}
                direction={data.direction}
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
