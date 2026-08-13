# 029: Notes are taggable context inside the model, held apart from discussion

**Status**: proposed (proof of concept, issue #83) · **Date**: 2026-08-13

## Context

Some information about a component only matters in a specific situation. Folding every situation into the element's `description` produces one large blob that is mostly context the current reader does not need, and nothing in the format says which sentence belongs to which situation (issue #83). The issue asks for bits of information marked with a context, filterable in the domain model and in the visual tool.

The document already has comments, and [decision 016](016-comments.md) keeps them beside the model because discussion is opinion about the model. The new thing is the opposite case: a claim about the domain that a consumer should read, like a code comment against a PR comment. The tension is between reusing the comment machinery, which already solved attachment, selection, cascade, and filtering, and keeping the boundary of decision 016 sharp: what a producer regenerates and a consumer reads must stay separable from what people say about it.

## Decision

**A note is a map inside `model`.** `model.notes: Record<Id, Note>`, with `Note = {id, text, targets: Id[], tags}`, beside `model.elements`. Placement is the whole point: a note is domain knowledge, so it lives where consumers read and producers write, while `Document.comments` stays beside the model and keeps the separation decision 016 drew. `formatVersion` goes to 9, so an older build refuses the file rather than dropping model content on save.

**A note carries element tags, and the filter reads them both ways.** `tags` has the same `{key: [values]}` shape as element tags, so one filter grammar covers both. An element matches a tag filter when one of its notes carries the tag, so filtering to a context lights up the elements that context touches, and the same tag filter is what puts the notes for that context on the board.

**A note card is revealed; the badge is the part that is always there.** Outside notes mode the board draws a note card only when the reader points at the note, meaning the note or one of the elements it describes is selected, or when a committed filter names a tag the note's tags satisfy (issue #83 review). Every element a note describes carries a sticky-note badge whichever way, so a reader sees that context exists and can ask for it. Notes mode draws every card, because that is the layer notes are written in. Only tags reveal: a text term, a bare `note`, and `note=text` pick elements rather than name a context, and the filter needs at least one non-negated tag term, so an expression of exclusions alone reveals nothing.

**Attachment, cascade, selection, and pins mirror comments.** Targets list the elements a note describes, an empty list describes the whole document, a note that had targets dies with its last one, note ids share the selection id space, and an arranged card's pin lives in `layout`. These rules were argued once in decisions 016 and 017 and hold for the same reasons here; the two objects differ in where they live and who reads them.

**The filter key `note` is reserved, alongside `comment`.** Bare `note` matches elements with a note attached; `note=text` matches note text as a case-insensitive substring. A tag key literally named "note" is written with a quoted key, the same escape decision 016 reserved for "comment".

## Rejected

**A `tags` field per sentence inside `description`.** No structure to parse, no lifecycle, no multi-element attachment, and the format would be promising filterability it cannot check.

**A per-element list (`element.notes: [{text, tags}]`).** Keeps each note under its owner, but loses multi-target notes, needs new selection and pin machinery, and breaks the flat-model rule ([decision 002](002-flat-model.md)) that everything addressable sits in one id space.

**Extending `Comment` with tags and a `kind` flag.** One map, two audiences: every consumer would have to filter comments by kind to find the model content, and the "regenerate the model, never touch the discussion" rule of decision 016 stops being a map boundary and becomes a convention.

**A card on the board at all times.** The first cut drew every note card whatever the reader was doing, on the argument that a note is model content and model content is simply there. Cards that are always on crowd the layers a reader came for: the structure in the model layer and the discussion in the overlay both end up read around a set of notes written for some other situation. The badge carries the "there is context here" job at a fraction of the space, and selection or a tag filter asks for the rest.

## What would reverse this

This is a proof of concept. Feedback on issue #83 decides whether the name and the placement inside `model` survive; a reversal before acceptance costs one migration.
