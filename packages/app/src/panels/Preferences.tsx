import { useEffect, useRef, useState } from 'react';
import {
  setMotionPreference,
  useMotionPreference,
  useSystemReducesMotion,
  type MotionPreference,
} from '../preferences/motion.js';

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
 * with the element's.
 */

const MOTION_CHOICES: { value: MotionPreference; label: string }[] = [
  { value: 'system', label: 'Follow my system setting' },
  { value: 'full', label: 'Always animate' },
  { value: 'reduced', label: 'Never animate' },
];

export function Preferences() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const preference = useMotionPreference();
  const systemReduces = useSystemReducesMotion();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

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
        onClose={() => setOpen(false)}
        // The backdrop is part of the dialog's own box, so a press that lands
        // on the element itself landed outside the panel drawn inside it.
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
      >
        <div className="preferences__panel">
          <header className="preferences__header">
            <h2>Preferences</h2>
            <button
              type="button"
              data-testid="close-preferences"
              aria-label="Close preferences"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

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
                      {systemReduces ? ' — currently asking for no motion' : ' — currently allowing motion'}
                    </em>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </dialog>
    </>
  );
}
