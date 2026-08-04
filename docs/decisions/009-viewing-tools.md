# 009: Viewing tools are session state, composed by one emphasis rule

**Status**: accepted · **Date**: 2026-08-04

## Context

A board with many connections stops reading (issue #6). Three tools address that: hiding elements, highlighting the selection's neighbourhood, and panning to a related element. Each one changes what the board shows without changing what the document says, and the board already had one such tool: the tag filter, which fades non-matching elements. The tension is between adding three independent features and keeping one coherent answer to "why is this element faded?".

## Decision

**"Hide" mutes the element and removes its connections.** A hidden element stays on the board, faded, so the reader can still see it exists and select it to bring it back. Its connections are not drawn at all, because connections are the clutter the tool exists to cut. The word is *hide*: "ignore" suggests the model stops counting it, and it only stops being drawn in full.

**The hidden set is session state, like expansion.** What a reader has put away is their view of the domain, not a property of the domain, so it never reaches the saved file (decision 004 makes the same call for expanded groups). It still travels through the command bus as `set-hidden`, so a trace shows what the reader hid and a replay reproduces the view.

**One function decides emphasis.** `boardEmphasis` in `packages/core/src/query/view.ts` takes the whole session state and returns two sets: `muted` (drawn faded) and `suppressed` (connections not drawn). Three muting sources compose by precedence rather than by union:

1. **Hidden** beats everything: a hidden element is muted even inside a highlighted neighbourhood, and its connections stay off the board. Hiding is the reader's most explicit act.
2. **Selection highlight** beats the filter: while anything is selected, the selection, its drawn connections, and the elements at their other ends render normal, and everything else is muted. The issue asks for the neighbourhood "as normal", so a filter mute inside it is lifted; a filter that still applied would make the highlight unreadable exactly when both tools are in use.
3. **The tag filter** applies only when nothing is selected, muting non-matches as before.

One exception: a directly selected element is never muted, even hidden, because the reader is pointing at it and the editor attached to it is how a hidden element is shown again.

**Hiding is judged where the connection lands on the board.** A connection is suppressed when any of its *visible anchors* is hidden, not any raw endpoint. Hiding a member of a collapsed group therefore does not take down the line pointing at the group that stands in for it, which is what the reader sees and expects.

**Unhiding lives in two places.** The editor of a selected element carries a Hide/Show toggle, and the filter bar lists every hidden element with a chip to bring it back. The list is load-bearing for connections: a hidden connection is not drawn, so the list is the only place it can be reached.

**Pan-to-relation is a count that opens into a list.** A single selected element with drawn connections shows a small `⇢ N` beside it. Hover or click opens a vertical list of entries, one per connection, labelled with the peer's title and the connection's title. Hovering or arrow-keying an entry emphasises that connection on the board; Enter or click pans the camera to the peer, keeping the current zoom. Arrow keys wrap, and the list scrolls past four entries. This follows the issue's sketch (button, pills, cycle, highlight, pan) with one simplification: no separate scroll affordance, since the list itself scrolls and the keys cycle.

**The pan is a `set-view` command, and the camera follows the bus.** Choosing a relation dispatches `set-view` with the computed pan, and the canvas applies any `set-view` it did not initiate to the React Flow viewport. The trace then records where the reader went, a replay follows, and an agent can drive the camera through the same command. Hand-panning still never dispatches `set-view`, so nothing fights the pointer.

## Rejected

**Persisting the hidden set in the document.** Same reasoning as expansion in 004: it turns a reading preference into a shared edit, and two readers of one file would fight over it. What would reverse this reverses that decision too.

**Deleting hidden elements from the board entirely.** An element that vanishes cannot be found or restored from the canvas, and the count of what exists stops matching what is drawn. Muting keeps the model's shape visible.

**Union semantics for the three muting sources.** Muting an element when *any* source says so reads simpler but breaks the highlight: with a filter active, selecting an element would leave its filtered-out peers muted, and the feature's whole point is seeing the neighbourhood.

**Tracing the pan-control's hover highlight.** Which entry the pointer is over is ephemeral focus, like the rename focus in `editing.ts`, so it stays out of the trace. The chosen pan is the durable act, and that is the command.

**A `hide` command per direction (`hide-element` / `show-element`).** `set-hidden {id, hidden}` matches `set-expanded` and replays idempotently.

## What would reverse this

- Wanting a curated "presentation" of a document to be shareable: a saved view with its own hidden set and camera. That moves hidden (and expansion) into a named, versioned view object beside the document, rather than into the document itself.
- The precedence rule confusing readers in practice, for example expecting the filter to keep applying inside a highlighted neighbourhood. That would swap rule 2 for union semantics.
