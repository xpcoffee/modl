import { useEffect, useRef, useState } from 'react';
import {
  setMotionPreference,
  useMotionPreference,
  useSystemReducesMotion,
  type MotionPreference,
} from '../preferences/motion.js';
import {
  ACTIONS,
  MAX_COMBOS,
  captureHint,
  captureKeyCombo,
  captureMouseCombo,
  combosFor,
  describeActionCombo,
  gestureMode,
  matchesKey,
  removeCombo,
  resetKeybindings,
  setCombo,
  setGestureMode,
  useKeybindingsVersion,
  type ActionId,
  type GestureMode,
} from '../preferences/keybindings.js';

/**
 * The reader's own settings, behind a gear at the end of the toolbar.
 *
 * Everything here describes the person rather than the document: it follows
 * them across every board they open, stays out of the model and the trace,
 * and persists in the browser. Board and view state belongs on the board —
 * the filter bar and the control cluster — not in this panel.
 *
 * A native `<dialog>` carries the modal behaviour (Escape, the backdrop, and
 * the focus trap), so this only has to keep React's idea of open in step
 * with the element's. The dialog holds one page at a time — the root, or the
 * input bindings — and the breadcrumb in the header walks back up.
 */

const MOTION_CHOICES: { value: MotionPreference; label: string }[] = [
  { value: 'system', label: 'Follow my system setting' },
  { value: 'full', label: 'Always animate' },
  { value: 'reduced', label: 'Never animate' },
];

const MODE_CHOICES: { value: GestureMode; label: string }[] = [
  { value: 'drag', label: 'Drag' },
  { value: 'begin-end', label: 'Begin + end' },
];

type PreferencesPage = 'root' | 'keybindings';

/** A binding slot waiting for a press. */
interface Arming {
  id: ActionId;
  index: number;
}

export function Preferences() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<PreferencesPage>('root');
  const [arming, setArming] = useState<Arming | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Whether the click that follows a captured press should be swallowed
  // before it reaches whatever control it landed on.
  const swallowClick = useRef(false);
  // Whether the press that opened the current click landed on the backdrop:
  // a drag released over the backdrop must not read as a click outside.
  const pressOnBackdrop = useRef(false);
  const preference = useMotionPreference();
  const systemReduces = useSystemReducesMotion();
  useKeybindingsVersion();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // While a binding slot is armed, the next press anywhere is the answer.
  // The listeners ride the capture phase and stop the event, so the press
  // being recorded cannot also act on the board or the panel.
  useEffect(() => {
    if (arming === null) return;
    const { id, index } = arming;

    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesKey('cancel', event)) {
        // preventDefault also keeps the dialog's own Escape from closing it.
        event.preventDefault();
        event.stopPropagation();
        setArming(null);
        return;
      }
      const combo = captureKeyCombo(id, event);
      // Half a combo (a modifier alone) or a key on a mouse-only action:
      // keep waiting.
      if (combo === null) return;
      event.preventDefault();
      event.stopPropagation();
      setCombo(id, index, combo);
      setArming(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      pressOnBackdrop.current = false;
      const target = event.target as HTMLElement | null;
      // A bare left click on one of the panel's own controls is the reader
      // using the panel, so it disarms instead of binding; bare left binds
      // from anywhere else (the panel background, the backdrop, the board).
      const bare = event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
      const onPanelControl = target?.closest('.preferences__panel :is(button, input, label)') != null;
      const combo = bare && onPanelControl ? null : captureMouseCombo(id, event);
      if (combo === null) {
        // The press cannot bind this slot, so it is a click somewhere else.
        // On the armed button itself the click that follows would arm it
        // straight back.
        const armedButton = `[data-testid="binding-${id}-${index}"], [data-testid="add-binding-${id}"]`;
        if (target?.closest(armedButton)) swallowClick.current = true;
        setArming(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      swallowClick.current = true;
      setCombo(id, index, combo);
      setArming(null);
    };

    const onClick = (event: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    // A right button being captured must not also open the browser's menu.
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [arming]);

  return (
    <>
      <button
        type="button"
        className="toolbar__gear"
        data-testid="open-preferences"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Preferences"
        aria-label="Preferences"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7zm7.4-2.6a7.6 7.6 0 0 0 0-1.8l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-1.6-.9L15.1 3H8.9l-.4 2.3a7.5 7.5 0 0 0-1.6.9l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 1.8l-2 1.5 2 3.4 2.3-1c.5.4 1 .7 1.6.9l.4 2.3h6.2l.4-2.3c.6-.2 1.1-.5 1.6-.9l2.3 1 2-3.4-2-1.5z" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        className="preferences"
        data-testid="preferences"
        aria-label="Preferences"
        onClose={() => {
          setOpen(false);
          setPage('root');
          setArming(null);
        }}
        // The backdrop is part of the dialog's own box, so a press that lands
        // on the element itself landed outside the panel drawn inside it. The
        // click only dismisses when its press also started out there: a drag
        // released over the backdrop stays inside.
        onPointerDown={(event) => {
          pressOnBackdrop.current = event.target === dialogRef.current;
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current && pressOnBackdrop.current) setOpen(false);
        }}
      >
        <div className="preferences__panel">
          <header className="preferences__header">
            {page === 'root' ? (
              <h2>Preferences</h2>
            ) : (
              <nav className="preferences__breadcrumbs" aria-label="Preferences pages">
                <button
                  type="button"
                  data-testid="breadcrumb-preferences"
                  onClick={() => {
                    setPage('root');
                    setArming(null);
                  }}
                >
                  Preferences
                </button>
                <span aria-hidden="true">›</span>
                <h2>Input bindings</h2>
              </nav>
            )}
            <button
              type="button"
              data-testid="close-preferences"
              aria-label="Close preferences"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          {page === 'root' && (
            <>
              <fieldset className="preferences__group">
                <legend>Motion</legend>
                <p className="preferences__note">
                  The board answers clicks, arrivals, and deletions with gravity waves through the
                  dot grid.
                </p>
                {MOTION_CHOICES.map((choice) => (
                  <label key={choice.value} className="preferences__choice">
                    <input
                      type="radio"
                      name="motion"
                      data-testid={`motion-${choice.value}`}
                      checked={preference === choice.value}
                      onChange={() => setMotionPreference(choice.value)}
                    />
                    <span>
                      {choice.label}
                      {choice.value === 'system' && (
                        <em data-testid="motion-system-state">
                          {systemReduces
                            ? ' — currently asking for no motion'
                            : ' — currently allowing motion'}
                        </em>
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="preferences__group">
                <legend>Input</legend>
                <p className="preferences__note">
                  Every gesture on the board can move to a different key or button.
                </p>
                <button
                  type="button"
                  className="preferences__page-link"
                  data-testid="open-keybindings"
                  onClick={() => setPage('keybindings')}
                >
                  Input bindings <span aria-hidden="true">›</span>
                </button>
              </fieldset>
            </>
          )}

          {page === 'keybindings' && (
            <fieldset className="preferences__group">
              <legend>Input bindings</legend>
              <p className="preferences__note">
                Click a binding, then press the key or button it should answer to, with any
                modifiers held. Cancel (Escape) backs out of a press. Changes apply as they are
                made.
              </p>
              {ACTIONS.map((action) => {
                const combos = combosFor(action.id);
                return (
                  <div key={action.id} className="preferences__row">
                    <span className="preferences__action">
                      {action.label}
                      {action.beginEnd && (
                        <span
                          className="preferences__modes"
                          role="radiogroup"
                          aria-label={`${action.label} runs as`}
                        >
                          {MODE_CHOICES.map((choice) => (
                            <button
                              key={choice.value}
                              type="button"
                              data-testid={`mode-${action.id}-${choice.value}`}
                              aria-pressed={gestureMode(action.id) === choice.value}
                              className={
                                gestureMode(action.id) === choice.value ? 'is-active' : undefined
                              }
                              onClick={() => {
                                setGestureMode(action.id, choice.value);
                                setArming(null);
                              }}
                            >
                              {choice.label}
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="preferences__combos">
                      {combos.map((combo, index) => (
                        <span key={index} className="preferences__chip">
                          <button
                            type="button"
                            className={`preferences__binding${
                              arming?.id === action.id && arming.index === index
                                ? ' is-armed'
                                : ''
                            }`}
                            data-testid={`binding-${action.id}-${index}`}
                            onClick={() =>
                              setArming(
                                arming?.id === action.id && arming.index === index
                                  ? null
                                  : { id: action.id, index },
                              )
                            }
                          >
                            {arming?.id === action.id && arming.index === index
                              ? captureHint(action.id)
                              : describeActionCombo(action.id, combo)}
                          </button>
                          <button
                            type="button"
                            className="preferences__remove"
                            data-testid={`remove-${action.id}-${index}`}
                            aria-label={`Remove ${action.label} binding`}
                            onClick={() => {
                              removeCombo(action.id, index);
                              setArming(null);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {combos.length < MAX_COMBOS && (
                        <button
                          type="button"
                          className={`preferences__binding preferences__add${
                            arming?.id === action.id && arming.index === combos.length
                              ? ' is-armed'
                              : ''
                          }`}
                          data-testid={`add-binding-${action.id}`}
                          aria-label={`Add ${action.label} binding`}
                          onClick={() =>
                            setArming(
                              arming?.id === action.id && arming.index === combos.length
                                ? null
                                : { id: action.id, index: combos.length },
                            )
                          }
                        >
                          {arming?.id === action.id && arming.index === combos.length
                            ? captureHint(action.id)
                            : '+'}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
              <button
                type="button"
                className="preferences__reset"
                data-testid="reset-keybindings"
                onClick={() => {
                  resetKeybindings();
                  setArming(null);
                }}
              >
                Reset to defaults
              </button>
            </fieldset>
          )}
        </div>
      </dialog>
    </>
  );
}
