# 009: Viewing tools are session state, composed by one emphasis rule

**Status**: accepted · **Date**: 2026-08-04 · **Revised**: 2026-08-05 after review on PR #16, again for issue #18 (group selection highlights members), again for issue #33, which removed the filter bar these controls used to live on (see [decision 015](015-search-and-filter-menu.md)), and again for issue #66, which reworked how the roller opens and turns (see [decision 023](023-roller-menu-input.md)), and again for issue #68, which opens the destination's roller on arrival (see [decision 025](025-menu-focus.md)), and again for issue #87, which keeps the roller's list to what focus mode leaves on the board

## Context

A board with many connections stops reading (issue #6). Three tools address that: hiding elements, highlighting the selection's neighbourhood, and panning to a related element. Each one changes what the board shows without changing what the document says, and the board already had one such tool: the tag filter, which fades non-matching elements. The tension is between adding three independent features and keeping one coherent answer to "why is this element faded?".

## Decision

**"Hide" mutes the element and removes its connections.** A hidden element stays on the board, faded, so the reader can still see it exists and select it to bring it back. Its connections are not drawn at all, because connections are the clutter the tool exists to cut. The word is *hide*: "ignore" suggests the model stops counting it, and it only stops being drawn in full.

**Only non-connection elements can be hidden.** A hidden connection would leave no visible remnant to find it by, so the reducer rejects `set-hidden` on a connection (`wrong-kind`) and the UI offers no toggle for one. Connections leave the board only as a side effect of an endpoint hiding, which always leaves a faded element to bring everything back from. A connection id in the hidden set from an old trace is ignored rather than honoured.

**Hiding deselects what it takes off the board.** The hidden element, everything hidden with it inside a group, and the connections that leave with them all drop out of the selection. Without this, hiding a selected element left the highlight running on an invisible neighbourhood, which muted the whole rest of the board: the opposite of the intent. A hidden element can still be re-selected afterwards, which is how its editor offers Show.

**The hidden set is session state, like expansion.** What a reader has put away is their view of the domain, not a property of the domain, so it never reaches the saved file (decision 004 makes the same call for expanded groups). It still travels through the command bus as `set-hidden`, so a trace shows what the reader hid and a replay reproduces the view.

**One function decides emphasis.** `boardEmphasis` in `packages/core/src/query/view.ts` takes the whole session state and returns two sets: `muted` (drawn faded) and `suppressed` (connections not drawn). Three muting sources compose by precedence rather than by union:

1. **Hidden** beats everything: a hidden element is muted even inside a highlighted neighbourhood, and its connections stay off the board. Hiding is the reader's most explicit act.
2. **Selection highlight** beats the filter: while anything is selected, the selection, its drawn connections, and the elements at their other ends render normal, and everything else is muted. A selected group counts its members, at every depth, as selected (issue #18): expanding it therefore lights the members, their connections among themselves, and their connections outward; collapsed, the members are not drawn and the connections re-pointed at the group light up as before. A hidden member still mutes, per rule 1. The issue asks for the neighbourhood "as normal", so a filter mute inside it is lifted; a filter that still applied would make the highlight unreadable exactly when both tools are in use. Not every reader wants this, so a button in the board's control cluster, beside the interaction lock, turns it off. The preference travels through the bus as `set-selection-highlight` and, unlike the rest of the session, survives a document load: it is a preference about reading, not a view of one document.
3. **The tag filter** applies only when nothing is selected, muting non-matches as before. A group above a match counts as a match itself, at any depth (issue #19): a collapsed group would otherwise mute while holding the very element the reader is filtering for, with nothing on the board saying where it went. A collapsed group also shows a badge counting the matches it hides, styled like its member-count pill. A hidden match stays silent, per rule 1: it neither unmutes nor counts towards the groups above it. The board count in the toolbar keeps counting direct matches only, since the groups above a match contain it rather than match it.

One exception: a directly selected element is never muted, even hidden, because the reader is pointing at it and the editor attached to it is how a hidden element is shown again.

**Hiding is judged where the connection lands on the board.** A connection is suppressed when any of its *visible anchors* is hidden, not any raw endpoint. Hiding a member of a collapsed group therefore does not take down the line pointing at the group that stands in for it, which is what the reader sees and expects.

**Unhiding lives in three places.** The editor of a re-selected hidden element carries Show, a multi-selection holding hidden elements offers "Show N" beside "Hide N" (each counting only what it touches), and a strip over the top-left of the board lists every hidden element with a chip to bring it back.

**Pan-to-relation is a roller menu, and the roller is a component of its own.** A single selected element with drawn connections shows a pill naming the count (`2 →`) beside it. A click opens it into a vertical list whose active option sits in the middle, over where the pill was; neighbours above and below fade with distance (hover used to open it too; issue #66 removed that, see decision 023). The scroll bindings and the mouse wheel turn the roller (wrapping), options slide to their new slots, and the active option's connection is emphasised on the board. Clicking the middle option pans the camera to the peer, keeping the current zoom, and selects the peer: the reader's focus moved with the camera, so the highlight and the roller follow it to the destination (the destination's roller arrives open and holding focus, so the walk continues; decision 025 revised the earlier closed arrival, whose reason left with hover-to-open). Clicking a faded option turns the roller to it instead of acting, because activating whatever the pointer crosses would spin the roller out from under the cursor. The mechanism lives in `RollerMenu` (`packages/app/src/canvas/RollerMenu.tsx`), generic over its option values, with pan-to-relation as its first consumer: the review sketch notes the same control can later trigger other actions or open a further menu beside an element. The list keeps to the board the reader sees: a peer focus mode removed is not offered, so every option can be emphasised and walked to (issue #87; see [decision 027](027-filter-focus-compaction.md)).
**The pan is a `set-view` command, and the camera follows the bus.** Choosing a relation dispatches `set-view` with the computed pan, and the canvas applies any `set-view` it did not initiate to the React Flow viewport. The trace then records where the reader went, a replay follows, and an agent can drive the camera through the same command. Hand-panning still never dispatches `set-view`, so nothing fights the pointer.

## Rejected

**Persisting the hidden set in the document.** Same reasoning as expansion in 004: it turns a reading preference into a shared edit, and two readers of one file would fight over it. What would reverse this reverses that decision too.

**Deleting hidden elements from the board entirely.** An element that vanishes cannot be found or restored from the canvas, and the count of what exists stops matching what is drawn. Muting keeps the model's shape visible.

**Union semantics for the three muting sources.** Muting an element when *any* source says so reads simpler but breaks the highlight: with a filter active, selecting an element would leave its filtered-out peers muted, and the feature's whole point is seeing the neighbourhood.

**Tracing the roller's active-option highlight.** Which option the roller rests on is ephemeral focus, like the rename focus in `editing.ts`, so it stays out of the trace. The chosen pan is the durable act, and that is the command.

**A `hide` command per direction (`hide-element` / `show-element`).** `set-hidden {id, hidden}` matches `set-expanded` and replays idempotently.

**Hiding connections directly.** The first version allowed it and kept the filter-bar list as the only way back. Review called it out: a control whose effect has no visible remnant strands the reader, and the list is a poor place to discover that. Suppression through endpoints covers the need.

**A local React state for the highlight preference.** Given `expanded` and `hidden` already ride the bus, a preference that silently changed rendering without a trace entry would be the one viewing tool a replay could not reproduce.

## What would reverse this

- Wanting a curated "presentation" of a document to be shareable: a saved view with its own hidden set and camera. That moves hidden (and expansion) into a named, versioned view object beside the document, rather than into the document itself.
- The precedence rule confusing readers in practice, for example expecting the filter to keep applying inside a highlighted neighbourhood. That would swap rule 2 for union semantics.
