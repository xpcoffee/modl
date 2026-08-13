# 025: Tab moves real DOM focus: a ring over the selection menus, a soft focus over the board

**Status**: accepted · **Date**: 2026-08-12

## Context

The selection menus are pointer-first: the rollers open on click (decision 023), the panel's fields want a click each, and a reader without a pointer cannot reach any of them. Issue #68 asks for keyboard focus: with an element selected, a way to reach each of its menus and work inside them; with nothing selected, a way to reach the elements themselves. The menus now live in two homes (anchored or docked, decision 024), so whatever carries focus has to work identically in both.

The tension: a synthetic focus system (an index held in state, drawn as a highlight) is easy to steer precisely, and it is invisible to the browser, so screen readers, `:focus-visible`, and native button activation all say nothing. Real DOM focus brings those for free, and it comes with the browser's whole-page tab order, which would send Tab through the toolbar and every panel control before reaching a second menu.

## Decision

**Tab moves real DOM focus, intercepted only where the ring must loop.** One capture-phase handler (`canvas/focusRing.ts`) takes Tab over exactly when focus rests on the board or in a selection menu; focus in the toolbar, the search menu, or a dialog keeps the browser's own order. Each menu is a registered stop holding its box and its focus target, so the handler moves focus to real elements: the roller entrances (buttons) and the panel's root. Screen readers and `:focus-visible` follow along, and Enter on a roller entrance is a native button click, which is precisely how decision 023 says a roller opens.

**Tab stays literal Tab, outside the keybindings table.** The table's actions (decision 018) are the board's own gestures; Tab is the web's focus key, and rebinding it would detach the app from the platform convention the whole design leans on. The keys the table already owns are reused unchanged: `scroll-up`/`scroll-down` turn a focused roller and `cancel` steps out, through the same `matchesKey` calls as everywhere else.

**With a selection, Tab cycles the top-level menus and Enter goes one level in.** The ring runs left roller, bottom panel, right roller (`expansion`, `panel`, `relations`), wrapping at the ends, in both menu homes: the stops are the same components anchored or docked. Enter on a roller opens it (a click); Enter on the panel moves focus to its first control, and only then does Tab cycle the panel's controls, wrapping inside it. A roller whose focus leaves closes itself, so the ring never walks away from an open list.

**The cancel binding steps out one level per press, and each level answers it itself.** There is no central escape switch: an open roller closes and hands focus back to its entrance (the same close decision 023 gave Escape); a control inside the panel steps focus back to the panel's root; and at the top level the press bubbles through to the cancel handler in Canvas that already deselects. A level that spends the press marks it consumed (`preventDefault`), so a tag draft abandoning itself does not also throw the reader out of the panel.

**With nothing selected, Tab soft-focuses elements in reading order.** Focus moves across the rendered non-connection elements sorted top to bottom, then left to right, by layout origin, with ids breaking ties: boards are laid out like text often enough that spatial order beats creation order, and the tie-break keeps the walk stable. The focused element is the React Flow node itself, wearing a dashed outline: visibly not the selection's solid border and glow, because soft focus is presentation only. It never dispatches `set-selection` and never mutes the rest of the board (decision 009's highlight stays a selection affair). Enter, or a click, selects the element through the bus like any other selection.

**Choosing through the relations roller arrives ready to keep walking.** Selecting a peer from the roller opens the destination's own relations roller with focus in it, so a reader traverses the graph pressing only the scroll keys and Enter. This revises decision 009's closed arrival, which existed so nothing popped open under a hovering cursor; hover-to-open is gone (decision 023), so the pop-open no longer has a cursor to surprise.

**Focus is presentation, never document or trace state.** No focus movement dispatches a command. The durable acts, selection and the pan, still travel the bus exactly as before.

## Consequences

- While focus is on the board, Tab cannot reach the toolbar: the ring and the soft focus both wrap. The toolbar stays reachable by pointer and by tabbing before entering the board; a dedicated leave-the-board key can come later if readers ask.
- The panel's internal Tab order is its DOM order (type chip, arrows, styles, description, tags, footer), and it wraps, so a keyboard reader can circle the panel without falling out the bottom.

## Rejected

**A synthetic focus index drawn as a highlight.** It duplicates what the browser already does, and assistive tech cannot see it. The one thing it buys, full control of order, the interception gives anyway.

**A `focus-next` action in the keybindings table.** Every other action names a board gesture a reader might want on a different key; moving focus is the platform's gesture, already on Tab in every application they use. Putting it in the table invites rebinding it apart from the platform for no gain.

**Soft focus by id or creation order.** Stable, but it teleports focus across the board on every press; the point of a cycle order is that the eye can follow it.

**Soft focus as a muting highlight (like the selection neighbourhood).** Muting everything else on every Tab press makes the board flash while the reader is merely looking around; decision 009's emphasis rule stays reserved for selection.

**Letting Tab fall through to the browser at the ring's end.** It reaches the toolbar, but it makes the ring's size invisible: the reader cannot know whether the next press cycles or leaves. Wrapping keeps the ring a ring.

## What would reverse this

- Readers needing to reach the toolbar from the board by keyboard; that adds an explicit leave key (or lets Shift+Tab escape upward) rather than un-wrapping the ring.
- A menu whose top-level control is not a native button; Enter would stop opening it for free, and entering would need handling per menu kind, like the panel's.
- Boards in practice not reading top-to-bottom (radial layouts, say); the soft-focus order would follow the reflow command's notion of order instead of raw geometry.
