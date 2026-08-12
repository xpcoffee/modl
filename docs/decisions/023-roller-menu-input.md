# 023: The roller menu opens on click and turns under held input

**Status**: accepted · **Date**: 2026-08-12

## Context

The roller menu was built around a mouse: hover opens it, and each wheel event turns it one step (decision 009). On a laptop trackpad both halves fail (issue #66). A two-finger scroll reports the same gesture as a stream of small deltas, so one swipe fired dozens of wheel events and spun the roller across its whole list. And holding the cursor over the pill while also scrolling asks one hand to do two precise things at once.

The tension: wheel scrolling on the open roller is worth keeping, but the DOM does not say whether a wheel event came from a notched wheel or a trackpad, so the same handler must feel right for both. And every gesture the cursor no longer spends on hovering can be spent on turning.

## Decision

**A click opens the roller; a click anywhere else, or Escape, closes it.** Hover no longer opens or holds the list, so the cursor is free to leave, scroll, and come back. This removes the 250ms close delay (decision 014): the delay existed to survive pills sliding out from under a stationary pointer, and with no hover there is nothing to survive. Levels reached by choosing from the level above still open at once (`startOpen`); closing one steps back, as leaving it used to.

**Wheel deltas pool, and a turn costs one notch's worth.** A mouse notch reports roughly 100–120 pixels in one event; a trackpad swipe reports the same distance across many events. The handler accumulates `deltaY` and spends 100 pixels per turn, so a notch still turns exactly once and a swipe turns in proportion to how far the fingers travelled. Reversing direction forgives the pooled remainder, so an overshoot's leftovers cannot mute the swipe correcting it. A wheel reporting lines (`deltaMode` 1) counts 40 pixels per line.

**The stepper buttons grow into step zones.** Everything above the active option is one press that turns the roller up, everything below turns it down, sized from the component's own geometry rather than a 22-pixel button. The faded pills draw on top of their zone, so a click exactly on one still turns straight to it. Held down, a zone keeps turning on a two-speed clock: a step every half-second for the first three seconds, then three per second (`canvas/holdRepeat.ts`; the issue proposed a full second, which review on PR #67 found too slow). Slow first, so a reader who overshot has time to let go; fast after, so a long list does not take a minute to cross. The zones render on every roller, not behind a `steppers` flag: they are invisible until hovered, and every roller has ends.

**Scrolling joins the bindings table.** `scroll-up` and `scroll-down` are actions like any other, defaulting to the arrow keys, remappable from the preferences submenu (decision 018). The roller and the comment timeline consume them through `matchesKey`. On the roller a held key repeats on the same two-speed clock as the zones, ignoring the browser's own key repeat, whose rate is a system setting the app cannot pace. This revises 018's line that arrows in the roller stay hard-coded; arrows in the search list still do, because that control is a focused text input and a printable key bound to scroll would collide with typing into it. The timeline keeps the browser's own key repeat rather than the two-speed clock: each of its steps jumps to another comment and pans the camera, not a slot on a dial, so pacing it is the reader's business.

## Rejected

**Detecting trackpads and keeping per-event stepping for mice.** There is no reliable signal on a wheel event saying what sent it; heuristics over delta sizes misfire across browsers and OS settings. Pooling gives both devices the right feel from one rule.

**Keeping hover-to-open beside click-to-open.** Two opening gestures fight: a menu that opens under a passing cursor still steals the scroll that follows, which is the trackpad complaint restated. The freed cursor is what makes the step zones usable.

**The browser's key auto-repeat for held arrows.** It starts after an OS-chosen delay and repeats at an OS-chosen rate, so the ramp the issue asks for (slow, then fast) cannot be expressed with it.

**A gesture mode for scroll actions.** Scroll is a press, repeated while held; the hold and begin+end machinery exists for drags and buys nothing here.

## What would reverse this

- Browsers exposing the input device on wheel events. Per-device calibration would replace pooling, and a notched wheel could go back to stepping per event.
- Readers missing hover-to-open in practice. It would return behind a preference rather than as the default, keeping the freed cursor for those who need it.
- A third consumer of the two-speed hold with different timing needs. The constants in `holdRepeat.ts` would become per-caller parameters.
