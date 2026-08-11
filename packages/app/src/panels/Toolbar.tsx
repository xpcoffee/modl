import { useEffect, useRef, useState } from 'react';
import { fileStem, isGroup, parseDocument, selectIds } from '@modl/core';
import { store } from '../store/store.js';
import { ElementIcon } from '../canvas/ElementIcon.js';
import { PLACEABLE, arm, usePending } from '../canvas/placement.js';
import {
  download,
  pickDocumentFile,
  saveDocumentFile,
  saveDocumentFileAs,
  type SaveResult,
} from '../files/fileAccess.js';
import { rememberFile, useFileContext } from '../files/fileContext.js';
import { matchesKey } from '../preferences/keybindings.js';
import { useAppState } from '../store/useStore.js';
import { Preferences } from './Preferences.js';

/**
 * How long each save-feedback phase holds, so a near-instant save still
 * reads as started, then done (issue 47).
 */
const FEEDBACK_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A spinner while the save runs, then a checkmark, over the button. */
function SaveFeedback({ phase }: { phase: 'saving' | 'saved' }) {
  return (
    <span className="save-feedback" data-testid="save-feedback" data-phase={phase} aria-hidden="true">
      {phase === 'saving' ? (
        <span className="save-feedback__spinner" />
      ) : (
        <svg viewBox="0 0 12 12" width="12" height="12">
          <path
            className="save-feedback__check"
            d="M2 6.5 L5 9.5 L10 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

export function Toolbar() {
  const state = useAppState();
  const file = useFileContext();
  const fileInput = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const saveRunRef = useRef(0);
  const [feedback, setFeedback] = useState<{
    button: 'save' | 'save-as';
    phase: 'saving' | 'saved';
  } | null>(null);
  const [message, setMessage] = useState('');
  const pending = usePending();
  const [picking, setPicking] = useState(false);

  const visible = selectIds(state.document.model.elements, state.filter, state.document.comments).size;
  const total = Object.keys(state.document.model.elements).length;

  /**
   * Starts a container around whatever is selected, or an empty one when
   * nothing is. It opens expanded so there is a box to drag elements into,
   * and an entity that never gains a member stays an ordinary entity.
   */
  const groupSelected = () => {
    const positions = state.selection
      .map((id) => state.document.layout[id])
      .filter((entry): entry is { x: number; y: number; width: number; height: number } =>
        entry !== undefined && 'x' in entry,
      );
    // group-elements sizes the box around its members itself.
    const position =
      positions.length > 0
        ? { x: positions[0]!.x, y: positions[0]!.y }
        : { x: 60, y: 60 };

    const id = crypto.randomUUID();
    store.dispatch({
      type: 'group-elements',
      id,
      title: 'New group',
      memberIds: state.selection,
      position,
    });
    store.dispatch({ type: 'set-expanded', id, expanded: true });
  };

  const ungroupSelected = () => {
    for (const id of state.selection) store.dispatch({ type: 'ungroup', id });
  };

  const canUngroup = state.selection.some((id) =>
    isGroup(state.document.model.elements, id),
  );

  const openFile = async (file: File, handle: FileSystemFileHandle | null) => {
    const result = parseDocument(await file.text());
    if (!result.ok) {
      setMessage(`Could not load: ${result.errors.map((e) => e.message).join('; ')}`);
      return;
    }
    const applied = store.dispatch({ type: 'load-document', document: result.document });
    if (applied.ok) rememberFile({ handle, name: file.name });
    setMessage(applied.ok ? `Loaded ${file.name}` : applied.error.message);
  };

  const load = async () => {
    const picked = await pickDocumentFile();
    if (picked.outcome === 'unsupported') {
      fileInput.current?.click();
      return;
    }
    if (picked.outcome === 'canceled') return;
    if (picked.outcome === 'failed') {
      setMessage(`Could not open: ${picked.message}`);
      return;
    }
    await openFile(picked.file, picked.handle);
  };

  const save = async (as: boolean) => {
    // A save already writing, or holding a picker open, swallows the press;
    // the feedback tail below does not, so a quick follow-up save still runs.
    if (savingRef.current) return;
    savingRef.current = true;
    const run = ++saveRunRef.current;
    const button = as ? 'save-as' : 'save';
    setFeedback({ button, phase: 'saving' });
    const started = performance.now();
    let result: SaveResult;
    try {
      const text = store.serialize();
      const title = store.getState().document.title;
      result = as ? await saveDocumentFileAs(text, title) : await saveDocumentFile(text, title);
    } finally {
      savingRef.current = false;
    }
    if (result.outcome === 'failed') setMessage(`Could not save: ${result.message}`);
    if (result.outcome !== 'saved') {
      if (saveRunRef.current === run) setFeedback(null);
      return;
    }
    setMessage(`Saved ${result.name}`);
    // The spinner holds a beat even when the save is instant, then the
    // checkmark; a newer save owns the feedback from here on.
    await delay(Math.max(0, FEEDBACK_MS - (performance.now() - started)));
    if (saveRunRef.current !== run) return;
    setFeedback({ button, phase: 'saved' });
    await delay(FEEDBACK_MS);
    if (saveRunRef.current !== run) return;
    setFeedback(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const saveAs = matchesKey('save-as', event);
      const plain = !saveAs && matchesKey('save', event);
      if (!saveAs && !plain) return;
      // ctrl+s inside a field still means the document, and the default
      // would open the browser's own save dialog.
      event.preventDefault();
      void save(saveAs);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="toolbar" data-testid="toolbar">
      <strong className="toolbar__brand">
        <img src="./modl.svg" alt="" width="20" height="20" />
        modl
      </strong>
      {file.name && (
        <span className="toolbar__file" data-testid="file-name" title={file.name}>
          {fileStem(file.name)}
        </span>
      )}

      <div className="toolbar__add">
        <button
          type="button"
          data-testid="add-element"
          aria-expanded={picking}
          className={pending ? 'is-on' : undefined}
          onClick={() => setPicking((open) => !open)}
        >
          Add{pending ? `: ${PLACEABLE.find((entry) => entry.type === pending)?.label}` : ''}
        </button>

        {picking && (
          <ul className="toolbar__types" data-testid="add-types">
            {PLACEABLE.map((entry) => (
              <li key={entry.type}>
                <button
                  type="button"
                  data-testid={`add-type-${entry.type}`}
                  onClick={() => {
                    arm(entry.type);
                    setPicking(false);
                  }}
                >
                  <ElementIcon
                    elementType={
                      entry.type === 'connection-node'
                        ? 'connection node'
                        : entry.type === 'decision'
                          ? 'decision'
                          : entry.type
                    }
                  />
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pending && (
        <span className="toolbar__hint" data-testid="placement-hint">
          click to place, or drag to size it
        </span>
      )}

      <button
        type="button"
        data-testid="group-selected"
        onClick={groupSelected}
        title="Start a group around the selection, or an empty one"
      >
        Group
      </button>
      <button
        type="button"
        data-testid="ungroup-selected"
        onClick={ungroupSelected}
        disabled={!canUngroup}
        title="Lift the members of the selected group out of it"
      >
        Ungroup
      </button>

      <span className="toolbar__divider" />

      <button
        type="button"
        data-testid="save"
        className="toolbar__save"
        title={file.name ? `Save to ${file.name}` : 'Save'}
        onClick={() => void save(false)}
      >
        Save
        {feedback?.button === 'save' && <SaveFeedback phase={feedback.phase} />}
      </button>
      <button
        type="button"
        data-testid="save-as"
        className="toolbar__save"
        title="Save to a new file"
        onClick={() => void save(true)}
      >
        Save as
        {feedback?.button === 'save-as' && <SaveFeedback phase={feedback.phase} />}
      </button>
      <button type="button" data-testid="load" onClick={() => void load()}>
        Load
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        data-testid="file-input"
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) void openFile(picked, null);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        data-testid="export-trace"
        onClick={() => download('session.trace.json', `${JSON.stringify(store.getTrace(), null, 2)}\n`)}
      >
        Export trace
      </button>

      <span className="toolbar__spacer" />
      <span className="toolbar__count" data-testid="element-count">
        {visible === total ? `${total} elements` : `${visible} of ${total} elements`}
      </span>
      {message && (
        <span className="toolbar__message" data-testid="toolbar-message">
          {message}
        </span>
      )}
      <Preferences />
    </header>
  );
}
