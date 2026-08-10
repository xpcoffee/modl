import { useEffect, useRef, useState } from 'react';

export interface RollerOption<T> {
  /** Stable key among this menu's options. */
  id: string;
  label: string;
  /** A second line under the label, for what the option is about. */
  sublabel?: string;
  value: T;
  testId?: string;
}

/** One step of the roller, in pixels. Options sit this far apart. */
const SLOT_HEIGHT = 30;
/** A two-line pill needs more room than a one-line one. */
const TALL_SLOT_HEIGHT = 44;
/** Neighbours of the active option stay readable; anything further fades out. */
const OPACITY_BY_DISTANCE = [1, 0.45, 0.12];
/** How far past the last visible option a stepper button sits, in pixels. */
const STEP_GAP = 28;
/**
 * How long the list waits before closing once the pointer leaves it.
 *
 * Turning the roller slides the options, so a stationary pointer can find
 * itself over the gap between two pills for as long as that takes. Closing on
 * the first mouseleave shut the menu out from under a reader who had not
 * moved, and took the level they were on with it.
 */
const CLOSE_DELAY = 250;

/**
 * A roller menu: a pill that expands on hover into a vertical list whose
 * active option sits in the middle, over where the pill was. Arrow keys, the
 * mouse wheel, and the optional stepper buttons turn the roller, options slide
 * into place, and clicking the middle option chooses it. Clicking a faded
 * option turns the roller to it.
 *
 * Generic on purpose: the first consumer pans to a connection, and the same
 * control now also carries a decision's connections (issue #12).
 */
export function RollerMenu<T>({
  entranceLabel,
  entranceAriaLabel,
  options,
  onSelect,
  onActiveChange,
  onOpenChange,
  startOpen = false,
  steppers = false,
  align = 'centre',
  depth = OPACITY_BY_DISTANCE.length - 1,
  testId,
}: {
  entranceLabel: string;
  entranceAriaLabel: string;
  options: RollerOption<T>[];
  onSelect: (value: T) => void;
  /** Fires with the active option while open, and null when shut. */
  onActiveChange?: (value: T | null) => void;
  /** Fires as the list opens and shuts, for a caller drawing around it. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Opens the list on mount, for a level reached by choosing from the level
   * above: the pointer is already over it, so asking for a second hover would
   * be asking twice for the same thing.
   */
  startOpen?: boolean;
  /** Buttons above and below the list, for turning it without a wheel. */
  steppers?: boolean;
  /**
   * Where the options sit against the entrance. `centre` puts them over it;
   * `right` hangs them off its right edge, so a menu placed beside a small
   * element grows away from it rather than across it.
   */
  align?: 'centre' | 'right';
  /** How many options sit either side of the active one before they fade out. */
  depth?: number;
  testId: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const [active, setActive] = useState(0);
  const closing = useRef<number | null>(null);

  const holdOpen = (): void => {
    if (closing.current !== null) window.clearTimeout(closing.current);
    closing.current = null;
    setOpen(true);
  };
  const closeSoon = (): void => {
    if (closing.current !== null) window.clearTimeout(closing.current);
    closing.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  useEffect(() => () => {
    if (closing.current !== null) window.clearTimeout(closing.current);
  }, []);

  // Options changing underneath (a new selection, a hidden peer) restart the
  // roller rather than leaving it pointing at a slot that no longer exists.
  const optionKeys = options.map((option) => option.id).join(' ');
  useEffect(() => {
    setOpen(startOpen);
    setActive(0);
  }, [optionKeys, startOpen]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const activeValue = open ? (options[active]?.value ?? null) : null;
  useEffect(() => {
    onActiveChange?.(activeValue);
    return () => onActiveChange?.(null);
  }, [activeValue, onActiveChange]);

  if (options.length === 0) return null;

  const tall = options.some((option) => option.sublabel !== undefined);
  const slot = tall ? TALL_SLOT_HEIGHT : SLOT_HEIGHT;
  const acrossBy = align === 'right' ? '-100%' : '-50%';

  const step = (by: number): void => {
    if (!open) {
      setOpen(true);
      return;
    }
    setActive((current) => (current + by + options.length) % options.length);
  };

  /**
   * One end of the roller, drawn just past the furthest option still shown.
   * Past it rather than a whole slot further: the slot beyond the last visible
   * option holds a faded one, and a stepper landing on top of it would take
   * the clicks meant for that option once the roller turns.
   */
  const stepper = (by: number, glyph: string, name: string) => (
    <button
      type="button"
      className={`roller-menu__step roller-menu__step--${name}`}
      data-testid={`${testId}-${name}`}
      aria-label={`${name === 'up' ? 'Previous' : 'Next'} option`}
      style={{
        transform: `translate(${acrossBy}, calc(-50% + ${by * (depth * slot + STEP_GAP)}px))`,
      }}
      onClick={(event) => {
        event.stopPropagation();
        step(by);
      }}
    >
      {glyph}
    </button>
  );

  return (
    <div
      className="roller-menu nodrag nopan nowheel"
      data-testid={testId}
      onMouseEnter={holdOpen}
      onMouseLeave={closeSoon}
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
        onClick={holdOpen}
        // The middle option takes the entrance's place while open. Opacity
        // rather than visibility, so a click on the entrance keeps focus and
        // the arrow keys still reach the menu.
        style={open ? { opacity: 0, pointerEvents: 'none' } : undefined}
      >
        {entranceLabel}
      </button>

      {open && (
        <div
          className={`roller-menu__viewport${align === 'right' ? ' is-right' : ''}`}
          data-testid={`${testId}-list`}
        >
          {steppers && options.length > 1 && (
            <>
              {stepper(-1, '▲', 'up')}
              {stepper(1, '▼', 'down')}
            </>
          )}
          {options.map((option, index) => {
            const offset = index - active;
            return (
              <button
                type="button"
                key={option.id}
                className={`roller-menu__option${tall ? ' is-tall' : ''}${offset === 0 ? ' is-active' : ''}`}
                {...(option.testId ? { 'data-testid': option.testId } : {})}
                style={{
                  transform: `translate(${acrossBy}, calc(-50% + ${offset * slot}px))`,
                  opacity: Math.abs(offset) > depth ? 0 : (OPACITY_BY_DISTANCE[Math.abs(offset)] ?? 0),
                  // A fully faded option would still catch clicks meant for
                  // the board behind it.
                  pointerEvents: Math.abs(offset) > depth ? 'none' : 'auto',
                }}
                // No hover-to-activate: turning the roller slides the options,
                // so activating whatever the pointer crosses would spin it
                // out from under the cursor. A click on a faded option turns
                // to it deliberately.
                onClick={() => (offset === 0 ? onSelect(option.value) : setActive(index))}
              >
                <span className="roller-menu__label">{option.label}</span>
                {option.sublabel !== undefined && (
                  <span className="roller-menu__sublabel">{option.sublabel}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
