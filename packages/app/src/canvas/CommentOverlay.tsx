import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewportPortal, useNodes, useReactFlow } from '@xyflow/react';
import {
  COMMENT_CARD_SIZE,
  allComments,
  isConnection,
  isEntityLayout,
  type AppState,
  type Comment,
  type DomainEvent,
  type Id,
  type Point,
} from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { getCommentEdit, startCommentEdit, stopCommentEdit, useCommentEdit } from './commentEditing.js';
import { CommentTextBox } from './CommentTextBox.js';

/**
 * Comments drawn as movable cards (issue #37, PR #39 review). The card is
 * the one rendering a comment has: in model mode it shows while the comment
 * or one of its targets is selected, and the discussion overlay shows them
 * all over a blueprint of the board.
 *
 * In the overlay every element click speaks comments: one click opens the
 * element's discussion, or a fresh card when it has none, and the normal
 * element selection UI never shows. `c` opens the overlay (and a card on
 * whatever was selected), double-clicking empty board writes a general
 * remark, and while a card is open ctrl+click and shift+box grow or shrink
 * what it discusses. Escape deselects first and leaves the overlay second.
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

/**
 * Centres React Flow is drawing right now, so an arc follows an element as
 * it is dragged rather than jumping when the move lands in the document.
 */
type LiveCentres = ReadonlyMap<Id, Point>;

function rectCentre(state: AppState, id: Id, live?: LiveCentres): Point | null {
  const drawn = live?.get(id);
  if (drawn) return drawn;
  const entry = state.document.layout[id];
  if (entry && 'x' in entry) {
    return { x: entry.x + entry.width / 2, y: entry.y + entry.height / 2 };
  }
  // A connection has no box; its line runs between its endpoints, so the
  // midpoint of the first pair stands in for it.
  const element = state.document.model.elements[id];
  if (element && isConnection(element)) {
    const from = element.from[0] === undefined ? null : rectCentre(state, element.from[0], live);
    const to = element.to[0] === undefined ? null : rectCentre(state, element.to[0], live);
    if (from && to) return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }
  return null;
}

/**
 * Where unpinned general remarks stack: beside the content, so they sit on
 * the board like everything else without covering it. A general remark
 * normally arrives pinned where it was double-clicked; this fallback is for
 * files that carry one without a pin.
 */
function generalFallback(state: AppState, index: number): Point {
  const boxes = Object.values(state.document.layout).filter(isEntityLayout);
  const left = boxes.length === 0 ? 0 : Math.min(...boxes.map((box) => box.x));
  const top = boxes.length === 0 ? 0 : Math.min(...boxes.map((box) => box.y));
  return {
    x: left - COMMENT_CARD_SIZE.width - 60,
    y: top + index * (COMMENT_CARD_SIZE.height + 16),
  };
}

function placeCards(state: AppState, live?: LiveCentres): CardPlace[] {
  let unpinnedGenerals = 0;
  return allComments(state.document.comments).map((comment) => {
    const anchors = comment.targets
      .map((target) => rectCentre(state, target, live))
      .filter((point): point is Point => point !== null);

    const pin = state.document.layout[comment.id];
    if (pin && 'x' in pin) return { comment, at: { x: pin.x, y: pin.y }, anchors };

    if (anchors.length === 0) {
      return { comment, at: generalFallback(state, unpinnedGenerals++), anchors };
    }

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

/**
 * Closes whatever card is open the way clicking off would: an empty comment
 * is abandoned, one with words is already saved. Switching to another
 * element's discussion goes through here so no blank card lingers behind.
 */
function settleOpenCard(): void {
  const edit = getCommentEdit();
  if (edit === null) return;
  stopCommentEdit();
  const comment = store.getState().document.comments[edit.commentId];
  if (comment && comment.text.trim() === '') {
    store.dispatch({ type: 'delete-comment', id: edit.commentId });
  }
}

/**
 * Creates a comment on the given elements and opens its card for writing.
 * `at` pins the card there (a general remark lands where it was
 * double-clicked); without it the card derives its place from its targets.
 */
export function quickAddComment(targets: Id[], at?: Point): void {
  settleOpenCard();
  const id = crypto.randomUUID();
  const result = store.dispatch({
    type: 'create-comment',
    id,
    text: '',
    targets,
    createdAt: new Date().toISOString(),
  });
  if (!result.ok) return;
  if (at !== undefined) {
    store.dispatch({
      type: 'move-comment',
      id,
      position: { x: at.x - COMMENT_CARD_SIZE.width / 2, y: at.y - 12 },
    });
  }
  store.dispatch({ type: 'set-selection', ids: [id] });
  startCommentEdit(id, 'overlay');
}

/**
 * What one click on an element means in the overlay: open its discussion.
 * The latest comment on the element opens for editing, and an element with
 * none gets a fresh card, so pointing at a thing is all writing takes.
 */
export function openElementComment(elementId: Id): void {
  const state = store.getState();
  const discussion = allComments(state.document.comments).filter((comment) =>
    comment.targets.includes(elementId),
  );
  const latest = discussion[discussion.length - 1];
  if (latest === undefined) {
    quickAddComment([elementId]);
    return;
  }
  if (getCommentEdit()?.commentId !== latest.id) settleOpenCard();
  store.dispatch({ type: 'set-selection', ids: [latest.id] });
  startCommentEdit(latest.id, 'overlay');
}

/**
 * Ctrl+click while a card is open: the element joins what the comment
 * discusses, or leaves it when it is already there. Removing the last
 * target turns the comment into a general remark rather than deleting
 * words someone wrote.
 */
export function toggleCommentTarget(commentId: Id, elementId: Id): void {
  const comment = store.getState().document.comments[commentId];
  if (!comment) return;
  const targets = comment.targets.includes(elementId)
    ? comment.targets.filter((target) => target !== elementId)
    : [...comment.targets, elementId];
  store.dispatch({ type: 'set-comment-targets', id: commentId, targets });
}

/** Shift+box while a card is open: everything boxed joins the comment. */
export function addCommentTargets(commentId: Id, elementIds: Id[]): void {
  const comment = store.getState().document.comments[commentId];
  if (!comment || elementIds.length === 0) return;
  store.dispatch({
    type: 'set-comment-targets',
    id: commentId,
    targets: [...new Set([...comment.targets, ...elementIds])],
  });
}

export function CommentOverlay() {
  const state = useAppState();
  const edit = useCommentEdit();
  const { setCenter, getViewport, screenToFlowPosition } = useReactFlow();
  const open = state.commentOverlay;

  // A drag in flight, held locally so the card AND its arcs follow the
  // pointer; the document gets one move-comment on release.
  const [liveDrag, setLiveDrag] = useState<{ id: Id; at: Point } | null>(null);
  // The click that ends a drag must not also select the card.
  const justDragged = useRef(false);
  // The card just written into being, pulsing its border once.
  const [bornId, setBornId] = useState<Id | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = store.subscribeEvents((events) => {
      const created = events.find(
        (event): event is Extract<DomainEvent, { type: 'comment-created' }> =>
          event.type === 'comment-created',
      );
      if (!created || !store.getState().commentOverlay) return;
      setBornId(created.id);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBornId(null), 700);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  // React Flow owns node positions while a drag is in flight, so the arcs
  // read what it is drawing rather than the document, which only hears
  // about the move on drop.
  const flowNodes = useNodes();
  const liveCentres = useMemo(() => {
    const centres = new Map<Id, Point>();
    for (const node of flowNodes) {
      const origin = (node.data['parentOrigin'] as Point | undefined) ?? { x: 0, y: 0 };
      const width = node.measured?.width ?? Number(node.style?.width ?? 0);
      const height = node.measured?.height ?? Number(node.style?.height ?? 0);
      centres.set(node.id, {
        x: node.position.x + origin.x + width / 2,
        y: node.position.y + origin.y + height / 2,
      });
    }
    return centres;
  }, [flowNodes]);

  const cards = useMemo(() => {
    const placed = placeCards(state, liveCentres);
    if (liveDrag === null) return placed;
    return placed.map((card) =>
      card.comment.id === liveDrag.id ? { ...card, at: liveDrag.at } : card,
    );
  }, [state, liveDrag, liveCentres]);
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

  /**
   * Drags a card, arcs following live; the pin lands as one move-comment on
   * release. A card drags while its text box is open too: only a press on
   * the box itself is left alone, so the caret still places by mouse.
   */
  const dragCard = useCallback(
    (commentId: Id, from: Point) => (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest('textarea, input, button')) return;
      event.stopPropagation();
      // Keeps focus (and the open text box) where it is while the card moves.
      event.preventDefault();
      const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      let last = from;
      const element = event.currentTarget as HTMLElement;
      element.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        const at = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        last = { x: from.x + at.x - origin.x, y: from.y + at.y - origin.y };
        setLiveDrag({ id: commentId, at: last });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setLiveDrag(null);
        if (last.x !== from.x || last.y !== from.y) {
          justDragged.current = true;
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
  const pinned = open ? cards : cards.filter((card) => isRead(state, card.comment));

  return (
    <>
      <ViewportPortal>
        {/* Arcs under the cards: one card, one line to each thing it discusses. */}
        <svg className="comment-overlay__arcs" width="1" height="1">
          {pinned.map((card) =>
            card.anchors.map((anchor, index) => (
              <line
                key={`${card.comment.id}-${index}`}
                data-testid={`comment-arc-${card.comment.id}-${index}`}
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
            born={card.comment.id === bornId}
            justDragged={justDragged}
            onDragStart={dragCard(card.comment.id, card.at!)}
          />
        ))}
      </ViewportPortal>

      {open && <Timeline cards={cards} selected={selectedComment} onPick={goTo} />}
    </>
  );
}

function CommentCard({
  card,
  selected,
  editing,
  born,
  justDragged,
  onDragStart,
}: {
  card: CardPlace;
  selected: boolean;
  editing: boolean;
  /** True just after creation: the border pulses once to say "written here". */
  born: boolean;
  /** Set by a drag ending; the click that follows it must not select. */
  justDragged: React.MutableRefObject<boolean>;
  onDragStart?: (event: React.PointerEvent) => void;
}) {
  const { comment } = card;
  const classes = [
    'comment-card',
    'nodrag',
    'nopan',
    selected ? 'is-selected' : '',
    born ? 'is-born' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      data-testid={`comment-card-${comment.id}`}
      style={{ transform: `translate(${card.at!.x}px, ${card.at!.y}px)`, width: COMMENT_CARD_SIZE.width }}
      onPointerDown={onDragStart}
      onClick={(event) => {
        event.stopPropagation();
        // A drag is a move, never a click: the element under discussion (or
        // the card itself) stays exactly as selected as it was.
        if (justDragged.current) {
          justDragged.current = false;
          return;
        }
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
      {/* Marks the reading position: the entry beside this is the current one. */}
      <span className="comment-timeline__centre" data-testid="timeline-centre" aria-hidden="true" />
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
