# 024: Selection menus dock at the bottom centre when their anchors fail

**Status**: accepted · **Date**: 2026-08-12

## Context

The selection menus anchor to the selected content: the expansion roller at the selection's top-left corner, the edit and style panel under its bottom edge, the relations roller at its right. Anchoring keeps the controls where the reader is looking, and it fails whenever the anchor itself is out of reach (issue #68). A select-all can span elements far outside the viewport, so the panel under the selection's bottom edge renders somewhere off screen. A single element panned away, or a group larger than the viewport, does the same to all three menus.

The tension: menus on the element are where the eye is, and menus on the screen are always reachable. Splitting the difference per menu would leave the three disagreeing about where they live.

## Decision

**One predicate decides docking for every selection menu.** A multi-selection always docks: there is no single element for three menus to sit on, and its bounding box can be any size. A single selection docks while its box does not sit fully inside the viewport; fully inside, because each menu anchors to a different edge of the box, so a corner off screen is a menu off screen. The predicate is computed once (`canvas/docking.ts`, published by a `DockSentinel` component inside the flow) and every menu reads the same answer.

**The dock is the bottom centre of the screen, one slot per menu.** The panel hangs upward from near the bottom edge; the expansion roller sits to its left and the relations roller to its right, high enough that an opened roller's options and step zones stay on screen. The menus keep rendering inside React Flow's viewport portal: a docked menu's slot is converted from screen to flow coordinates each frame and the viewport's zoom is countered (`scale(1/zoom)`), so it holds its place and size on screen while everything attached keeps panning for free.

**Re-attaching asks for a margin.** Docking triggers the moment any edge of the selection leaves the screen; re-attaching waits until the whole selection sits at least 24 screen pixels inside. Without the gap, a selection resting exactly on the edge would flap between the two states on every pan frame.

**The transition travels.** Anchor and dock positions are both transforms on the same element, so a dock flip plays as one CSS transition (300ms) carrying translation and counter-zoom scale together: pan away and the menus glide to the dock, pan back and they glide home. The single-selection editor lives inside its node while attached; while docked (or still travelling) the node's copy stands down and `DockedEditor` renders the same `ElementEditor` at the panel slot, entering from the element's own anchor so it travels like the rollers. Reduced motion (`data-motion='reduced'`, decision 010) swaps instantly: the travelling flag never raises and the CSS transition is off.

**Typing pins the editor's home.** A dock flip re-homes the single-selection editor between its node and the dock, and the two homes are different DOM: a remount destroys a tag draft and drops keyboard focus mid-word, which wheel-panning while typing can reach (PR #69 review). While focus sits inside the editor panel the whole cluster holds its current state, docked or attached, and the deferred flip lands when focus leaves. Deferring beats preserving state across the remount: the draft fields, the open pickers, the focus target, and the caret would each need carrying by hand, and any one missed is the same data loss.

**The dock is presentation.** Nothing about it enters the document, the trace, or the command bus. Docked menus are the same components with the same behaviour: the rollers turn, choose, and hold-repeat as decision 023 shaped them, and the panel edits the same selection.

## Consequences

- A selected connection never docks: it has no box of its own to judge against the viewport, so its editor stays on the line even when the line is off screen. The next anchor-shaped thing (the label's midpoint) can pick this up if it earns its keep.
- A multi-selection of connections alone now gets the actions panel; before, with nothing to anchor to, it rendered no panel at all.
- The multi-selection panel no longer follows a drag; it holds the dock, which is the point.

## Rejected

**Per-menu predicates** (each menu docks when its own anchor leaves the screen). The cluster would split, with one roller docked and the panel still on the element, and the reader would have to check two places for one selection's controls.

**Rendering docked menus in a screen-space layer outside the viewport portal.** It puts the dock in its natural coordinates, and it re-homes the DOM on every flip, so nothing can transition between the two states; it also changes how attached menus scale under zoom, which this issue never asked to touch.

**Clamping menus to the viewport edge** (sliding along the edge nearest the anchor). Keeps them near the content, and a menu pinned to an arbitrary edge mid-pan is a moving target; the mock in issue #68 asks for one predictable place.

**Dock state on the command bus.** It would write camera-dependent presentation into the trace, and a replay on a different window size would disagree with it.

## What would reverse this

- Readers losing track of controls that jump to the dock in practice; the dock would then need an affordance pointing back at the selection, or the clamped-edge variant a fresh look.
- The keyboard-focus cycling half of issue #68 landing with a different top-level menu model; the slots would move but the predicate should hold.
- The per-frame flow-coordinate conversion for docked menus costing visible jank on pan; a screen-space layer with a hand-rolled travel animation would replace the portal trick.
