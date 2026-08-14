# 031: Focus mode hides attachments through the one hidden set

**Status**: accepted · **Date**: 2026-08-14

## Context

Issue #102: with focus mode on and a filter active, the elements the filter removed left the board (decision 027), but the comments attached to them kept rendering as cards and as timeline entries. Notes had the same hole. The issue fixes the ground rule: focus mode hides elements and everything attached to them by default, through one derivation, rather than each renderer implementing its own attachment check for every type that can point at an element.

## Decision

**`focusHiddenIds` lists everything focus mode removes: elements and attachments.** The set already told the node and edge renderers which elements left the board. It now also holds each comment and note whose targets have all left, computed by one rule over both maps, so a future attachment type joins by adding its map to that list. Renderers keep asking the one question they already asked: is this id in the set. The comment layer (cards and timeline) and the note layer filter their cards against it, in every mode, so the discussion overlay and notes mode draw the board focus mode left rather than cards anchored to nothing.

**One standing target keeps a card.** An attachment across several elements hides only when every element it targets has left the board. This matches the existing multi-target semantics: `visibleNoteIds` reveals a note when any target is selected, and a selected card stands for all of its targets in `boardEmphasis` and `focusHiddenIds` itself. An attachment whose target list names no live elements scopes to the whole document, which no filter removes, so general remarks and document-level notes stay.

**A target is judged where it lands on the board.** A target inside a kept collapsed group counts as the group standing in for it, the rule `suppressedConnectionIds` set for lines into collapsed groups, so its card stays while the group does. A connection target counts as gone when its line draws nowhere: every `from` anchor or every `to` anchor was removed.

## Consequences

A card the mode hides cannot be selected while hidden, so the selection escape hatch (a selected card keeps its targets on the board) only applies to cards selected before they hide or reached another way. Leaving focus mode, or widening the filter, brings the cards back; nothing is written, matching 027's transient-view rule.

Arcs from a visible multi-target card to its hidden targets still draw to the targets' saved positions. Cards already stay at pinned positions while the pack moves elements (027's known gap), so this changes nothing today; wiring card anchors through the overlaid layout would fix both at once if it bothers anyone in practice.

## Rejected

**Per-renderer target checks.** Each card layer could filter by its own targets against the element set, but that is one rule copied into every renderer, and the next attachment type starts hidden from none of them. The issue asks for the opposite: one derivation, consumed everywhere.

**A separate `focusHiddenAttachmentIds` export.** Two sets means every renderer must know which set its id belongs in. Ids share one space (decision 002), so one set answers for everything.
