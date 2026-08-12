import { useEffect, useRef, useState } from 'react';
import { matchesKey } from '../preferences/keybindings.js';
import { useRingStop, type RingSlot } from './focusRing.js';
import { startHoldRepeat } from './holdRepeat.js';

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
/** How far past the last visible option a step zone keeps catching clicks. */
const ZONE_REACH = 44;
/** Sideways room a step zone offers, in pixels. Wider than any pill's core. */
const ZONE_WIDTH = 160;
/**
 * Accumulated wheel distance spent per turn, in pixels. A mouse wheel notch
 * reports around 100–120 at once; a trackpad reports the same swipe as a
 * stream of small deltas. Stepping once per event turned a notch and a
 * finger-twitch into the same full turn (issue #66), so deltas pool here and
 * a turn costs a notch's worth.
 */
const WHEEL_STEP = 100;
/** Pixels per line, for a wheel that reports lines instead (deltaMode 1). */
const WHEEL_LINE_HEIGHT = 40;

/**
 * A roller menu: a pill that expands on click into a vertical list whose
 * active option sits in the middle, over where the pill was. The scroll
 * bindings (arrow keys out of the box), the mouse wheel, and the zones above
 * and below the list turn the roller; holding a zone or a key keeps it
 * turning. Options slide into place, clicking the middle option chooses it,
 * and clicking a faded option turns the roller to it. A click anywhere else,
 * or Escape, closes the list.
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
  align = 'centre',
  depth = OPACITY_BY_DISTANCE.length - 1,
  focusSlot,
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
   * above: the reader just clicked their way here, so asking for a second
   * click would be asking twice for the same thing.
   */
  startOpen?: boolean;
  /**
   * Where the options sit against the entrance. `centre` puts them over it;
   * `left` and `right` hang them off one of its edges, so a menu placed beside
   * a small element grows away from it rather than across it.
   */
  align?: 'centre' | 'left' | 'right';
  /** How many options sit either side of the active one before they fade out. */
  depth?: number;
  /** The slot this menu holds on the keyboard focus ring (decision 025). */
  focusSlot?: RingSlot;
  testId: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const [active, setActive] = useState(0);
  const menu = useRef<HTMLDivElement>(null);
  const entrance = useRef<HTMLButtonElement>(null);
  const stopHold = useRef<(() => void) | null>(null);
  const wheelDebt = useRef(0);

  useRingStop(focusSlot, menu, entrance, options.length > 0);

  // A level reached without a click (chosen from the level above, or arrived
  // by walking the graph) takes the keys with it: the entrance holds focus so
  // the scroll bindings, Enter, and the cancel binding reach this menu at once.
  useEffect(() => {
    if (startOpen) entrance.current?.focus({ preventScroll: true });
  }, [startOpen]);

  const endHold = (): void => {
    stopHold.current?.();
    stopHold.current = null;
  };
  // Cleanup only: a hold must not outlive the component that started it.
  useEffect(() => () => endHold(), []);

  // Clicking anywhere else shuts the list, which is the way out of it that
  // needs no aim (issue #66); Escape is the other.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (menu.current?.contains(event.target as globalThis.Node)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // A hold belongs to the open list; wheel debt belongs to the turn it was
  // building.
  useEffect(() => {
    if (open) return;
    endHold();
    wheelDebt.current = 0;
  }, [open]);

  // Options changing underneath (a new selection, a hidden peer) restart the
  // roller rather than leaving it pointing at a slot that no longer exists.
  const optionKeys = options.map((option) => option.id).join(' ');
  useEffect(() => {
    endHold();
    wheelDebt.current = 0;
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
  const acrossBy = align === 'right' ? '-100%' : align === 'left' ? '0' : '-50%';

  const step = (by: number): void => {
    if (!open) {
      setOpen(true);
      return;
    }
    setActive((current) => (current + by + options.length) % options.length);
  };

  /** One press turns once; the repeat carries the rest until release. */
  const beginHold = (by: number): void => {
    endHold();
    step(by);
    stopHold.current = startHoldRepeat(() => step(by));
  };

  /**
   * One end of the roller: everything above (or below) the active option is
   * a single press that turns the roller a step towards that end, and
   * holding it keeps turning. A whole stretch rather than a button, so a
   * trackpad hand does not have to land on a 22-pixel target (issue #66).
   * The faded options render on top of it, so a click exactly on one still
   * turns straight to it.
   */
  const zone = (by: number, glyph: string, name: string) => (
    <button
      type="button"
      className={`roller-menu__zone roller-menu__zone--${name}`}
      data-testid={`${testId}-${name}`}
      aria-label={`${name === 'up' ? 'Previous' : 'Next'} option`}
      style={{
        transform: `translate(${acrossBy}, 0)`,
        top: by < 0 ? -(slot / 2 + depth * slot + ZONE_REACH) : slot / 2,
        width: ZONE_WIDTH,
        height: depth * slot + ZONE_REACH,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        beginHold(by);
      }}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
    >
      {glyph}
    </button>
  );

  return (
    <div
      ref={menu}
      className="roller-menu nodrag nopan nowheel"
      data-testid={testId}
      // Two fast presses on a step zone read as a double-click, which the
      // board would take as "create a component here" (issue #67 review).
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => {
        event.stopPropagation();
        if (event.deltaY === 0) return;
        const delta =
          event.deltaMode === 0 ? event.deltaY : event.deltaY * WHEEL_LINE_HEIGHT;
        // Reversing direction forgives the debt: the pooled remainder of an
        // overshoot must not mute the swipe correcting it.
        const carried = Math.sign(wheelDebt.current) === Math.sign(delta) ? wheelDebt.current : 0;
        let pooled = carried + delta;
        while (Math.abs(pooled) >= WHEEL_STEP) {
          step(pooled > 0 ? 1 : -1);
          pooled -= Math.sign(pooled) * WHEEL_STEP;
        }
        wheelDebt.current = pooled;
      }}
      onKeyDown={(event) => {
        const by = matchesKey('scroll-down', event) ? 1 : matchesKey('scroll-up', event) ? -1 : 0;
        if (by !== 0) {
          // The browser's own key repeat is ignored: the hold runs on the
          // same two-speed timer as the zones, not at the OS repeat rate.
          if (!event.repeat) {
            if (open) beginHold(by);
            else step(by);
          }
        } else if (event.key === 'Enter' && open && options[active]) {
          onSelect(options[active].value);
        } else if (matchesKey('cancel', event) && open) {
          setOpen(false);
          // Focus may sit on an option about to unmount; the entrance takes
          // it back, so the next press still speaks to this menu. A press
          // while shut bubbles on instead: the cancel handler above the menu
          // deselects, one level per press (decision 025).
          entrance.current?.focus({ preventScroll: true });
        } else return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyUp={endHold}
      // Focus leaving the menu shuts the list, so the focus ring never leaves
      // an open roller behind. Focus moving within the menu keeps it open.
      onBlur={(event) => {
        if (!open) return;
        if (menu.current?.contains(event.relatedTarget as globalThis.Node | null)) return;
        setOpen(false);
      }}
    >
      <button
        ref={entrance}
        type="button"
        className="roller-menu__entrance"
        data-testid={`${testId}-toggle`}
        aria-label={entranceAriaLabel}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        // The middle option takes the entrance's place while open. Opacity
        // rather than visibility, so a click on the entrance keeps focus and
        // the scroll keys still reach the menu.
        style={open ? { opacity: 0, pointerEvents: 'none' } : undefined}
      >
        {entranceLabel}
      </button>

      {open && (
        <div
          className={`roller-menu__viewport${align === 'centre' ? '' : ` is-${align}`}`}
          data-testid={`${testId}-list`}
        >
          {options.length > 1 && (
            <>
              {zone(-1, '▲', 'up')}
              {zone(1, '▼', 'down')}
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
                  // the step zone behind it.
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
