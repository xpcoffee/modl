import { useEffect, useState } from 'react';

export interface RollerOption<T> {
  /** Stable key among this menu's options. */
  id: string;
  label: string;
  value: T;
  testId?: string;
}

/** One step of the roller, in pixels. Options sit this far apart. */
const SLOT_HEIGHT = 30;
/** Neighbours of the active option stay readable; anything further fades out. */
const OPACITY_BY_DISTANCE = [1, 0.45, 0.12];

/**
 * A roller menu: a pill that expands on hover into a vertical list whose
 * active option sits in the middle, over where the pill was. Arrow keys and
 * the mouse wheel turn the roller, options slide into place, and clicking the
 * middle option chooses it. Clicking a faded option turns the roller to it.
 *
 * Generic on purpose: the first consumer pans to a connection, and the same
 * control can later carry any pick-one-of-N action beside an element.
 */
export function RollerMenu<T>({
  entranceLabel,
  entranceAriaLabel,
  options,
  onSelect,
  onActiveChange,
  testId,
}: {
  entranceLabel: string;
  entranceAriaLabel: string;
  options: RollerOption<T>[];
  onSelect: (value: T) => void;
  /** Fires with the active option while open, and null when shut. */
  onActiveChange?: (value: T | null) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Options changing underneath (a new selection, a hidden peer) restart the
  // roller rather than leaving it pointing at a slot that no longer exists.
  const optionKeys = options.map((option) => option.id).join(' ');
  useEffect(() => {
    setOpen(false);
    setActive(0);
  }, [optionKeys]);

  const activeValue = open ? (options[active]?.value ?? null) : null;
  useEffect(() => {
    onActiveChange?.(activeValue);
    return () => onActiveChange?.(null);
  }, [activeValue, onActiveChange]);

  if (options.length === 0) return null;

  const step = (by: number): void => {
    if (!open) {
      setOpen(true);
      return;
    }
    setActive((current) => (current + by + options.length) % options.length);
  };

  return (
    <div
      className="roller-menu nodrag nopan nowheel"
      data-testid={testId}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onWheel={(event) => {
        event.stopPropagation();
        if (event.deltaY !== 0) step(event.deltaY > 0 ? 1 : -1);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') step(1);
        else if (event.key === 'ArrowUp') step(-1);
        else if (event.key === 'Enter' && open && options[active]) onSelect(options[active].value);
        else if (event.key === 'Escape') setOpen(false);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="roller-menu__entrance"
        data-testid={`${testId}-toggle`}
        aria-label={entranceAriaLabel}
        aria-expanded={open}
        // Hover already opened the list, so a click closing it again would
        // undo the hover. Leaving closes it; Escape does too.
        onClick={() => setOpen(true)}
        // The middle option takes the entrance's place while open. Opacity
        // rather than visibility, so a click on the entrance keeps focus and
        // the arrow keys still reach the menu.
        style={open ? { opacity: 0, pointerEvents: 'none' } : undefined}
      >
        {entranceLabel}
      </button>

      {open && (
        <div className="roller-menu__viewport" data-testid={`${testId}-list`}>
          {options.map((option, index) => {
            const offset = index - active;
            return (
              <button
                type="button"
                key={option.id}
                className={`roller-menu__option${offset === 0 ? ' is-active' : ''}`}
                {...(option.testId ? { 'data-testid': option.testId } : {})}
                style={{
                  transform: `translate(-50%, calc(-50% + ${offset * SLOT_HEIGHT}px))`,
                  opacity: OPACITY_BY_DISTANCE[Math.abs(offset)] ?? 0,
                  // A fully faded option would still catch clicks meant for
                  // the board behind it.
                  pointerEvents: Math.abs(offset) >= OPACITY_BY_DISTANCE.length ? 'none' : 'auto',
                }}
                // No hover-to-activate: turning the roller slides the options,
                // so activating whatever the pointer crosses would spin it
                // out from under the cursor. A click on a faded option turns
                // to it deliberately.
                onClick={() => (offset === 0 ? onSelect(option.value) : setActive(index))}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
