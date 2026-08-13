import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewportPortal, useNodes, useReactFlow } from '@xyflow/react';
import {
  NOTE_CARD_SIZE,
  allNotes,
  hiddenNoteIds,
  isEntityLayout,
  notesOn,
  type AppState,
  type Id,
  type Note,
  type Point,
} from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { rectCentre, type LiveCentres } from './CommentOverlay.js';
import {
  enterNotesMode,
  getNoteEdit,
  leaveNotesMode,
  settleOpenNoteCard,
  startNoteEdit,
  useNoteEdit,
  useNotesMode,
} from './noteEditing.js';
import { NoteTextBox } from './NoteTextBox.js';

/**
 * Notes drawn as movable cards, always on the board (issue #83, decision
 * 029). A note is model content, so unlike a comment its card never waits
 * for a selection or an overlay; a committed filter is the one thing that
 * takes a card away. Notes mode carries the discussion overlay's grammar
 * for writing them: one press on an element opens or creates its note,
 * ctrl+click and shift+box grow or shrink what it describes, double-click
 * on empty board writes a document-level note, and the two modes exclude
 * each other.
 */

/** Where an unpinned card sits: above its targets, where comments sit below,
 * so an element carrying both never draws the two cards on top of each other. */
const DERIVED_CARD_OFFSET = {
  x: -NOTE_CARD_SIZE.width / 2,
  y: -NOTE_CARD_SIZE.height - 48,
};

interface CardPlace {
  note: Note;
  at: Point;
  /** Centres of the targets, for the connector arcs. */
  anchors: Point[];
}

/**
 * Where unpinned document-level notes stack: above the content, apart from
 * the left edge where unpinned general remarks sit. A document-level note
 * normally arrives pinned where it was double-clicked; this fallback is for
 * files that carry one without a pin.
 */
function documentFallback(state: AppState, index: number): Point {
  const boxes = Object.values(state.document.layout).filter(isEntityLayout);
  const left = boxes.length === 0 ? 0 : Math.min(...boxes.map((box) => box.x));
  const top = boxes.length === 0 ? 0 : Math.min(...boxes.map((box) => box.y));
  return {
    x: left + index * (NOTE_CARD_SIZE.width + 16),
    y: top - NOTE_CARD_SIZE.height - 60,
  };
}

function placeCards(state: AppState, live?: LiveCentres): CardPlace[] {
  let unpinnedDocumentNotes = 0;
  return allNotes(state.document.model.notes).map((note) => {
    const anchors = note.targets
      .map((target) => rectCentre(state, target, live))
      .filter((point): point is Point => point !== null);

    const pin = state.document.layout[note.id];
    if (pin && 'x' in pin) return { note, at: { x: pin.x, y: pin.y }, anchors };

    if (anchors.length === 0) {
      return { note, at: documentFallback(state, unpinnedDocumentNotes++), anchors };
    }

    const centroid = anchors.reduce(
      (sum, point) => ({ x: sum.x + point.x / anchors.length, y: sum.y + point.y / anchors.length }),
      { x: 0, y: 0 },
    );
    return {
      note,
      at: { x: centroid.x + DERIVED_CARD_OFFSET.x, y: centroid.y + DERIVED_CARD_OFFSET.y },
      anchors,
    };
  });
}

/** The single selected note, if the selection is exactly that. */
function soleSelectedNote(state: AppState): Id | null {
  if (state.selection.length !== 1) return null;
  const id = state.selection[0];
  return id !== undefined && state.document.model.notes[id] ? id : null;
}

function isTyping(target: EventTarget | null): boolean {
  return Boolean((target as HTMLElement | null)?.closest('input, textarea, [contenteditable]'));
}

/**
 * Creates a note on the given elements and opens its card for writing. `at`
 * pins the card there (a document-level note lands where it was
 * double-clicked); without it the card derives its place from its targets.
 */
export function quickAddNote(targets: Id[], at?: Point): void {
  settleOpenNoteCard();
  const id = crypto.randomUUID();
  const result = store.dispatch({ type: 'create-note', id, text: '', targets });
  if (!result.ok) return;
  if (at !== undefined) {
    store.dispatch({
      type: 'move-note',
      id,
      position: { x: at.x - NOTE_CARD_SIZE.width / 2, y: at.y - 12 },
    });
  }
  store.dispatch({ type: 'set-selection', ids: [id] });
  startNoteEdit(id);
}

/**
 * What one click on an element means in notes mode: open its note. The
 * latest note on the element opens for editing, and an element with none
 * gets a fresh card, so pointing at a thing is all writing takes.
 */
export function openElementNote(elementId: Id): void {
  const state = store.getState();
  const existing = notesOn(state.document.model.notes, elementId);
  const latest = existing[existing.length - 1];
  if (latest === undefined) {
    quickAddNote([elementId]);
    return;
  }
  if (getNoteEdit()?.noteId !== latest.id) settleOpenNoteCard();
  store.dispatch({ type: 'set-selection', ids: [latest.id] });
  startNoteEdit(latest.id);
}

/**
 * Ctrl+click while a card is open: the element joins what the note
 * describes, or leaves it when it is already there. Removing the last
 * target turns the note into a document-level one rather than deleting
 * words someone wrote.
 */
export function toggleNoteTarget(noteId: Id, elementId: Id): void {
  const note = store.getState().document.model.notes[noteId];
  if (!note) return;
  const targets = note.targets.includes(elementId)
    ? note.targets.filter((target) => target !== elementId)
    : [...note.targets, elementId];
  store.dispatch({ type: 'set-note-targets', id: noteId, targets });
}

/** Shift+box while a card is open: everything boxed joins the note. */
export function addNoteTargets(noteId: Id, elementIds: Id[]): void {
  const note = store.getState().document.model.notes[noteId];
  if (!note || elementIds.length === 0) return;
  store.dispatch({
    type: 'set-note-targets',
    id: noteId,
    targets: [...new Set([...note.targets, ...elementIds])],
  });
}

export function NoteLayer() {
  const state = useAppState();
  const edit = useNoteEdit();
  const mode = useNotesMode();
  const { screenToFlowPosition } = useReactFlow();

  // The two modes exclude each other: the overlay opening (the toggle, `c`,
  // wherever the command came from) closes notes mode.
  useEffect(() => {
    if (state.commentOverlay) leaveNotesMode();
  }, [state.commentOverlay]);

  // A drag in flight, held locally so the card AND its arcs follow the
  // pointer; the document gets one move-note on release.
  const [liveDrag, setLiveDrag] = useState<{ id: Id; at: Point } | null>(null);
  // The click that ends a drag must not also select the card.
  const justDragged = useRef(false);

  // React Flow owns node positions while a drag is in flight, so the arcs
  // read what it is drawing rather than the document.
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

  // The committed filter hides non-matching cards while reading. Writing
  // outranks it: a note born under a tag filter has no tags yet, and hiding
  // it would close the text box the press just opened.
  const hidden = useMemo(() => (mode ? new Set<Id>() : hiddenNoteIds(state)), [mode, state]);
  const cards = useMemo(() => {
    const placed = placeCards(state, liveCentres).filter((card) => !hidden.has(card.note.id));
    if (liveDrag === null) return placed;
    return placed.map((card) =>
      card.note.id === liveDrag.id ? { ...card, at: liveDrag.at } : card,
    );
  }, [state, hidden, liveDrag, liveCentres]);
  const selectedNote = soleSelectedNote(state);

  /** One keyboard for the feature, mirroring the discussion overlay's. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // `n` is the way to write: it enters notes mode, and with elements
      // selected it opens a fresh note on them in the same stroke.
      if (event.key === 'n') {
        event.preventDefault();
        const current = store.getState();
        const elements = current.document.model.elements;
        const targets = current.selection.filter((id) => elements[id]);
        enterNotesMode();
        if (targets.length > 0) quickAddNote(targets);
        return;
      }

      // Escape (the cancel binding) is handled by the board's one cancel
      // chain in Canvas: gestures first, then the selection, then this mode.

      const selected = soleSelectedNote(store.getState());
      if (selected === null) return;

      // These work in either mode: editing or deleting a note never pulls
      // the reader into notes mode.
      if (event.key === 'Enter') {
        event.preventDefault();
        startNoteEdit(selected);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.dispatch({ type: 'delete-note', id: selected });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * Drags a card, arcs following live; the pin lands as one move-note on
   * release. Only a press on the text box, an input, or a button is left
   * alone, so the caret and the chips keep their own presses.
   */
  const dragCard = useCallback(
    (noteId: Id, from: Point) => (event: React.PointerEvent) => {
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
        setLiveDrag({ id: noteId, at: last });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setLiveDrag(null);
        if (last.x !== from.x || last.y !== from.y) {
          justDragged.current = true;
          store.dispatch({ type: 'move-note', id: noteId, position: last });
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [screenToFlowPosition],
  );

  return (
    <ViewportPortal>
      {/* Arcs under the cards: one card, one line to each thing it describes.
          Solid where the discussion's arcs dash: attachment is a fact here. */}
      <svg className="note-layer__arcs" width="1" height="1">
        {cards.map((card) =>
          card.anchors.map((anchor, index) => (
            <line
              key={`${card.note.id}-${index}`}
              data-testid={`note-arc-${card.note.id}-${index}`}
              x1={card.at.x + NOTE_CARD_SIZE.width / 2}
              y1={card.at.y + NOTE_CARD_SIZE.height - 12}
              x2={anchor.x}
              y2={anchor.y}
              className={`note-layer__arc${selectedNote === card.note.id ? ' is-selected' : ''}`}
            />
          )),
        )}
      </svg>

      {cards.map((card) => (
        <NoteCard
          key={card.note.id}
          card={card}
          mode={mode}
          selected={selectedNote === card.note.id}
          editing={edit?.noteId === card.note.id}
          justDragged={justDragged}
          onDragStart={dragCard(card.note.id, card.at)}
        />
      ))}
    </ViewportPortal>
  );
}

function NoteCard({
  card,
  mode,
  selected,
  editing,
  justDragged,
  onDragStart,
}: {
  card: CardPlace;
  /** True in notes mode, which is when the tag chips take edits. */
  mode: boolean;
  selected: boolean;
  editing: boolean;
  /** Set by a drag ending; the click that follows it must not select. */
  justDragged: React.MutableRefObject<boolean>;
  onDragStart?: (event: React.PointerEvent) => void;
}) {
  const { note } = card;
  const classes = ['note-card', 'nodrag', 'nopan', selected ? 'is-selected' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      data-testid={`note-card-${note.id}`}
      style={{ transform: `translate(${card.at.x}px, ${card.at.y}px)`, width: NOTE_CARD_SIZE.width }}
      onPointerDown={onDragStart}
      onClick={(event) => {
        event.stopPropagation();
        // A drag is a move, never a click: the described element (or the
        // card itself) stays exactly as selected as it was.
        if (justDragged.current) {
          justDragged.current = false;
          return;
        }
        if (editing) return;
        // First click points at the note; a second click opens it.
        if (selected) startNoteEdit(note.id);
        else store.dispatch({ type: 'set-selection', ids: [note.id] });
      }}
    >
      <header className="note-card__meta">
        {note.targets.length === 0
          ? 'whole board'
          : note.targets.length === 1
            ? ''
            : `one note across ${note.targets.length} elements`}
      </header>
      {editing ? (
        <NoteTextBox noteId={note.id} text={note.text} />
      ) : (
        <p className="note-card__text">{note.text || <em>empty note</em>}</p>
      )}
      <NoteTags note={note} editable={mode} />
    </div>
  );
}

/**
 * The note's tags as chips, in the filter's own key=value spelling. In
 * notes mode each chip takes a remove press and a `+ tag` row adds one;
 * outside it they only say what a filter would catch.
 */
function NoteTags({ note, editable }: { note: Note; editable: boolean }) {
  const [adding, setAdding] = useState(false);
  const entries = Object.entries(note.tags);
  if (entries.length === 0 && !editable) return null;

  return (
    <ul className="note-card__tags">
      {entries.map(([key, values]) => (
        <li key={key} className="note-tag-chip" data-testid={`note-tag-${note.id}-${key}`}>
          <span>{values.length === 0 ? key : `${key}=${values.join(', ')}`}</span>
          {editable && (
            <button
              type="button"
              aria-label={`Remove tag ${key}`}
              data-testid={`note-remove-tag-${note.id}-${key}`}
              onClick={(event) => {
                event.stopPropagation();
                store.dispatch({ type: 'remove-note-tag', id: note.id, key });
              }}
            >
              ×
            </button>
          )}
        </li>
      ))}
      {editable && (
        <li className="note-tag-chip note-tag-chip--add">
          {adding ? (
            <NewNoteTag noteId={note.id} onDone={() => setAdding(false)} />
          ) : (
            <button
              type="button"
              data-testid={`note-add-tag-${note.id}`}
              onClick={(event) => {
                event.stopPropagation();
                setAdding(true);
              }}
            >
              + tag
            </button>
          )}
        </li>
      )}
    </ul>
  );
}

/** Several values, comma separated, the spelling element tags use. */
function parseValues(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * The row a new tag is typed into, with the element editor's commit rules:
 * Enter or leaving the row commits, Escape or an empty key abandons it.
 */
function NewNoteTag({ noteId, onDone }: { noteId: Id; onDone: () => void }) {
  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const done = useRef(false);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const key = draftKey.trim();
    if (commit && key !== '') {
      store.dispatch({ type: 'set-note-tag', id: noteId, key, values: parseValues(draftValue) });
    }
    onDone();
  };

  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        finish(true);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
    >
      <input
        data-testid={`note-new-tag-key-${noteId}`}
        aria-label="New tag key"
        placeholder="key"
        autoFocus
        value={draftKey}
        size={Math.max(draftKey.length, 3)}
        onChange={(event) => setDraftKey(event.target.value)}
      />
      <span>=</span>
      <input
        data-testid={`note-new-tag-value-${noteId}`}
        aria-label="New tag value"
        placeholder="value"
        value={draftValue}
        size={Math.max(draftValue.length, 5)}
        onChange={(event) => setDraftValue(event.target.value)}
      />
    </span>
  );
}
