# 017: Discussion is a temporary overlay, and its cards pin in layout

**Status**: accepted · **Date**: 2026-08-10

## Context

Comments needed a way to be read through as a discussion, written without hunting for an editor, and understood when one remark spans several elements (PR #39 review). Three UI directions were explored on the PR; the review chose the map-mode lens (proposal 3) and specified its behaviour: a temporary overlay entered with `c` and left with Escape or a mode toggle, a vertical timeline walked with the arrow keys, quick-adding by clicking a selected element, comment cards that can be repositioned, and interaction gated by the active filter.

The tensions: where the mode lives (component state or the bus), and where a card's position lives, since decision 016 had rejected storing one.

## Decision

**The overlay is session state on the command bus.** `AppState.commentOverlay`, flipped by `set-comment-overlay`, staying out of the undo history like the other viewing tools: Ctrl+Z after opening the overlay undoes the last edit. On the bus rather than in a React component so traces show the mode changing, headless tests drive it, and a replay reproduces what the reader saw.

**The overlay reads and discusses; the model underneath holds still.** Nodes stop being draggable and connectable, double-click stops creating, and Delete stops deleting elements while it is open. The board dims to a dashed blueprint and the selection highlight stands down, so emphasis follows the filter alone, which is also what gates interaction: an element the filter mutes cannot be hovered, selected, or commented on.

**A card pins in `layout` under the comment id.** Decision 016 rejected a stored position when a card had nowhere to be but near its targets; the review asked for cards a reader arranges, which is geometry, and geometry lives in `layout`. This amends 016. An unpinned card derives its place from its targets' centroid; an unpinned general remark docks at the board edge until dragged, and dragging dispatches one `move-comment` on release. The pin is deleted with its comment, cascade included.

**One writing gesture: click what is selected.** In the overlay, the first click on an element points at it and the second opens a fresh card, targeting the whole selection when the element is part of one. Clicking off an empty card abandons it, which is also the cancel; clicking off a card with words keeps it, since every keystroke already travelled as `set-comment-text`. The same click-select, click-again-edit, Delete-removes grammar applies to bubbles in model mode, and none of it changes the mode: editing a comment never pulls the reader into the overlay.

**Chronology is the reading order everywhere.** The vertical timeline, the up and down keys, and `allComments` all follow `createdAt`, so the discussion reads the same however it is walked.

## Rejected

**Overlay state in a React store (like `editing.ts`).** Cheaper, but the mode changes what every board interaction means, and a trace that cannot see it cannot explain why a click wrote a comment instead of selecting.

**A modifier or toolbar-only entry.** `c` is reachable mid-thought and matches how the games the design borrows from switch map modes; the toggle remains for discoverability, and Escape leaves without knowing anything.

**Keeping 016's no-position rule and auto-laying cards out.** Cards that reposition themselves whenever targets move fight the reader who arranged them; a discussion someone laid out spatially is worth keeping where they put it.

**Gating interaction on the selection highlight rather than the filter.** The highlight follows what is selected moment to moment; the review names the filter, which is a deliberate narrowing, as what decides what the overlay may touch.
