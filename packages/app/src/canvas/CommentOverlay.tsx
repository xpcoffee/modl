import { useCallback, useEffect, useMemo } from 'react';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import {
  COMMENT_CARD_SIZE,
  allComments,
  isConnection,
  type AppState,
  type Comment,
  type Id,
  type Point,
} from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { startCommentEdit, useCommentEdit } from './commentEditing.js';
import { CommentTextBox } from './CommentTextBox.js';

/**
 * Comments drawn as movable cards (issue #37, PR #39 review). The card is
 * the one rendering a comment has: in model mode it shows while the comment
 * or one of its targets is selected, and the discussion overlay shows them
 * all over a blueprint of the board.
 *
 * `c` opens the overlay, and with elements selected it also opens a fresh
 * card on them, which is the quick way to write. Escape deselects first and
 * leaves the overlay second. The up/down keys, the wheel over the timeline,
 * and clicks on its entries walk the discussion in the order it was written.
 */

/** Where a card sits when the reader has not pinned it: under its targets. */
const DERIVED_CARD_OFFSET = { x: -COMMENT_CARD_SIZE.width / 2, y: 48 };

interface CardPlace {
  comment: Comment;
  /** Absent for an unpinned general remark, which docks screen-fixed. */
  at?: Point;
  /** Centres of the targets, for the connector arcs. */
  anchors: Point[];
}

function rectCentre(state: AppState, id: Id): Point | null {
  const entry = state.document.layout[id];
  if (entry && 'x' in entry) {
    return { x: entry.x + entry.width / 2, y: entry.y + entry.height / 2 };
  }
  // A connection has no box; its line runs between its endpoints, so the
  // midpoint of the first pair stands in for it.
  const element = state.document.model.elements[id];
  if (element && isConnection(element)) {
    const from = element.from[0] === undefined ? null : rectCentre(state, element.from[0]);
    const to = element.to[0] === undefined ? null : rectCentre(state, element.to[0]);
    if (from && to) return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }
  return null;
}

function placeCards(state: AppState): CardPlace[] {
  return allComments(state.document.comments).map((comment) => {
    const anchors = comment.targets
      .map((target) => rectCentre(state, target))
      .filter((point): point is Point => point !== null);

    const pin = state.document.layout[comment.id];
    if (pin && 'x' in pin) return { comment, at: { x: pin.x, y: pin.y }, anchors };

    if (anchors.length === 0) return { comment, anchors };

    const centroid = anchors.reduce(
      (sum, point) => ({ x: sum.x + point.x / anchors.length, y: sum.y + point.y / anchors.length }),
      { x: 0, y: 0 },
    );
    return {
      comment,
      at: { x: centroid.x + DERIVED_CARD_OFFSET.x, y: centroid.y + DERIVED_CARD_OFFSET.y },
      anchors,
    };
  });
}

/** The single selected comment, if the selection is exactly that. */
function soleSelectedComment(state: AppState): Id | null {
  if (state.selection.length !== 1) return null;
  const id = state.selection[0];
  return id !== undefined && state.document.comments[id] ? id : null;
}

/** Whether this card is being read: its comment or one of its targets is selected. */
function isRead(state: AppState, comment: Comment): boolean {
  const selected = new Set(state.selection);
  return selected.has(comment.id) || comment.targets.some((target) => selected.has(target));
}

function isTyping(target: EventTarget | null): boolean {
  return Boolean((target as HTMLElement | null)?.closest('input, textarea, [contenteditable]'));
}

/** Creates a comment on the given elements and opens its card for writing. */
export function quickAddComment(targets: Id[]): void {
  const id = crypto.randomUUID();
  const result = store.dispatch({
    type: 'create-comment',
    id,
    text: '',
    targets,
    createdAt: new Date().toISOString(),
  });
  if (!result.ok) return;
  store.dispatch({ type: 'set-selection', ids: [id] });
  startCommentEdit(id, 'overlay');
}

export function CommentOverlay() {
  const state = useAppState();
  const edit = useCommentEdit();
  const { setCenter, getViewport, screenToFlowPosition } = useReactFlow();
  const open = state.commentOverlay;

  const cards = useMemo(() => placeCards(state), [state]);
  const selectedComment = soleSelectedComment(state);

  const panTo = useCallback(
    (at: Point) => {
      void setCenter(at.x + COMMENT_CARD_SIZE.width / 2, at.y + COMMENT_CARD_SIZE.height / 2, {
        zoom: getViewport().zoom,
        duration: 250,
      });
    },
    [setCenter, getViewport],
  );

  const goTo = useCallback(
    (card: CardPlace) => {
      store.dispatch({ type: 'set-selection', ids: [card.comment.id] });
      if (card.at) panTo(card.at);
    },
    [panTo],
  );

  /** One keyboard for the feature; which keys are live depends on the mode. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const current = store.getState();

      if (isTyping(event.target)) return;

      // `c` is the way to write: it opens the overlay, and with elements
      // selected it opens a fresh card on them in the same stroke.
      if (event.key === 'c') {
        event.preventDefault();
        if (!current.commentOverlay) {
          store.dispatch({ type: 'set-comment-overlay', open: true });
        }
        const elements = current.document.model.elements;
        const targets = current.selection.filter((id) => elements[id]);
        if (targets.length > 0) quickAddComment(targets);
        return;
      }

      if (event.key === 'Escape') {
        // Deselect first, leave second: two presses back out of anything.
        if (current.selection.length > 0) {
          store.dispatch({ type: 'set-selection', ids: [] });
        } else if (current.commentOverlay) {
          store.dispatch({ type: 'set-comment-overlay', open: false });
        }
        return;
      }

      const selected = soleSelectedComment(current);

      // Reading order: up and down walk the discussion as it was written.
      if (current.commentOverlay && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        const ordered = placeCards(current);
        if (ordered.length === 0) return;
        event.preventDefault();
        const index = ordered.findIndex((card) => card.comment.id === selected);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next =
          index === -1
            ? ordered[event.key === 'ArrowDown' ? 0 : ordered.length - 1]!
            : ordered[(index + step + ordered.length) % ordered.length]!;
        store.dispatch({ type: 'set-selection', ids: [next.comment.id] });
        if (next.at) panTo(next.at);
        return;
      }

      if (selected === null) return;

      // These work in either mode and change neither: editing or deleting a
      // comment never pulls the reader into the overlay.
      if (event.key === 'Enter') {
        event.preventDefault();
        startCommentEdit(selected, 'overlay');
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.dispatch({ type: 'delete-comment', id: selected });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panTo]);

  /** Drags a card; the pin lands as one move-comment on release. */
  const dragCard = useCallback(
    (commentId: Id, from: Point) => (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      let last = from;
      const element = event.currentTarget as HTMLElement;
      element.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        const at = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        last = { x: from.x + at.x - origin.x, y: from.y + at.y - origin.y };
        element.style.transform = `translate(${last.x}px, ${last.y}px)`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (last.x !== from.x || last.y !== from.y) {
          store.dispatch({ type: 'move-comment', id: commentId, position: last });
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [screenToFlowPosition],
  );

  // The card is the one rendering a comment has. The overlay shows every
  // card; model mode shows the ones being read.
  const shown = open ? cards : cards.filter((card) => isRead(state, card.comment));
  const pinned = shown.filter((card) => card.at !== undefined);
  const docked = shown.filter((card) => card.at === undefined);

  return (
    <>
      <ViewportPortal>
        {/* Arcs under the cards: one card, one line to each thing it discusses. */}
        <svg className="comment-overlay__arcs" width="1" height="1">
          {pinned.map((card) =>
            card.anchors.map((anchor, index) => (
              <line
                key={`${card.comment.id}-${index}`}
                x1={card.at!.x + COMMENT_CARD_SIZE.width / 2}
                y1={card.at!.y + 12}
                x2={anchor.x}
                y2={anchor.y}
                className={
                  selectedComment === card.comment.id
                    ? 'comment-overlay__arc is-selected'
                    : 'comment-overlay__arc'
                }
              />
            )),
          )}
        </svg>

        {pinned.map((card) => (
          <CommentCard
            key={card.comment.id}
            card={card}
            selected={selectedComment === card.comment.id}
            editing={edit?.commentId === card.comment.id}
            onDragStart={dragCard(card.comment.id, card.at!)}
          />
        ))}
      </ViewportPortal>

      {/* General remarks with no pin dock here; dragging one pins it. */}
      {docked.length > 0 && (
        <div className="comment-overlay__dock" data-testid="comment-dock">
          <span className="comment-overlay__dock-title">whole board</span>
          {docked.map((card) => (
            <CommentCard
              key={card.comment.id}
              card={card}
              selected={selectedComment === card.comment.id}
              editing={edit?.commentId === card.comment.id}
              docked
            />
          ))}
        </div>
      )}

      {open && <Timeline cards={cards} selected={selectedComment} onPick={goTo} />}
    </>
  );
}

function CommentCard({
  card,
  selected,
  editing,
  docked = false,
  onDragStart,
}: {
  card: CardPlace;
  selected: boolean;
  editing: boolean;
  docked?: boolean;
  onDragStart?: (event: React.PointerEvent) => void;
}) {
  const { comment } = card;
  const classes = [
    'comment-card',
    'nodrag',
    'nopan',
    selected ? 'is-selected' : '',
    docked ? 'is-docked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      data-testid={`comment-card-${comment.id}`}
      style={
        docked
          ? undefined
          : { transform: `translate(${card.at!.x}px, ${card.at!.y}px)`, width: COMMENT_CARD_SIZE.width }
      }
      onPointerDown={editing ? undefined : onDragStart}
      onClick={(event) => {
        event.stopPropagation();
        if (editing) return;
        // First click points at the comment; a second click opens it.
        if (selected) startCommentEdit(comment.id, 'overlay');
        else store.dispatch({ type: 'set-selection', ids: [comment.id] });
      }}
    >
      <header className="comment-card__meta">
        {comment.targets.length === 0
          ? 'whole board'
          : comment.targets.length === 1
            ? ''
            : `one comment across ${comment.targets.length} elements`}
      </header>
      {editing ? (
        <CommentTextBox commentId={comment.id} text={comment.text} />
      ) : (
        <p className="comment-card__text">{comment.text || <em>empty comment</em>}</p>
      )}
    </div>
  );
}

/** Vertical room one timeline entry takes, centre to centre. */
const TIMELINE_SPACING = 64;
/** How much dimmer each step away from the current entry draws. */
const TIMELINE_FADE = 0.28;

/** A comment's time as the timeline shows it. Empty for untimed comments. */
function timeLabel(comment: Comment): string {
  if (comment.createdAt === undefined) return '';
  const written = new Date(comment.createdAt);
  if (Number.isNaN(written.getTime())) return '';
  return written.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * The discussion down the right edge, in writing order. The current comment
 * sits vertically centred with its neighbours above and below, and entries
 * fade with distance, so what is bright is what is being read. Click an
 * entry, roll the wheel, or use the arrow keys; there are no buttons.
 */
function Timeline({
  cards,
  selected,
  onPick,
}: {
  cards: CardPlace[];
  selected: Id | null;
  onPick: (card: CardPlace) => void;
}) {
  const current = Math.max(
    0,
    cards.findIndex((card) => card.comment.id === selected),
  );

  const step = (by: number): void => {
    const next = cards[Math.min(cards.length - 1, Math.max(0, current + by))];
    if (next && next.comment.id !== selected) onPick(next);
  };

  // The wheel lives on the entries rather than the rail: the rail spans the
  // whole edge but stays transparent to the pointer, so the board and the
  // controls beneath it keep working.
  const onWheel = (event: React.WheelEvent): void => {
    if (cards.length === 0 || event.deltaY === 0) return;
    event.stopPropagation();
    step(event.deltaY > 0 ? 1 : -1);
  };

  return (
    <div className="comment-timeline nowheel nodrag nopan" data-testid="comment-timeline">
      {cards.map((card, index) => {
        const offset = index - current;
        const opacity = Math.max(0, 1 - Math.abs(offset) * TIMELINE_FADE);
        return (
          <button
            key={card.comment.id}
            type="button"
            className={`comment-timeline__entry${offset === 0 && selected !== null ? ' is-active' : ''}`}
            data-testid={`timeline-entry-${card.comment.id}`}
            style={{
              transform: `translateY(calc(-50% + ${offset * TIMELINE_SPACING}px))`,
              opacity,
              ...(opacity === 0 ? { pointerEvents: 'none' as const } : {}),
            }}
            onClick={() => onPick(card)}
            onWheel={onWheel}
          >
            <span className="comment-timeline__time">{timeLabel(card.comment)}</span>
            <span className="comment-timeline__snippet">
              {card.comment.text.slice(0, 48) || 'empty comment'}
            </span>
          </button>
        );
      })}
      {cards.length === 0 && <span className="comment-timeline__empty">no comments yet</span>}
    </div>
  );
}

/** The mode switch: the other way in and out of the overlay besides c/Escape. */
export function OverlayToggle() {
  const state = useAppState();
  return (
    <div className="overlay-toggle" data-testid="overlay-toggle">
      <button
        type="button"
        data-testid="overlay-model"
        className={state.commentOverlay ? '' : 'is-active'}
        onClick={() => store.dispatch({ type: 'set-comment-overlay', open: false })}
      >
        model
      </button>
      <button
        type="button"
        data-testid="overlay-discussion"
        className={state.commentOverlay ? 'is-active' : ''}
        title="Discussion overlay (c)"
        onClick={() => store.dispatch({ type: 'set-comment-overlay', open: true })}
      >
        discussion
      </button>
    </div>
  );
}
