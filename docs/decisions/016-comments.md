# 016: Comments live beside the model, and attach to elements

**Status**: accepted · **Date**: 2026-08-10

## Context

There is no way to comment on a diagram, and commenting is how a diagram is iterated on (issue #37). A remark like "is this still true?" is not a claim about the domain: putting it in an element's `description` corrupts the model a consumer reads, and putting it in `layout` claims it is geometry. The issue asks for a comment entity attached to one or more elements, held apart from both the model and the view, compact on the board until read, and searchable through a filter.

The tension is between making discussion first-class enough to attach, select, and search, and keeping it out of the structure producers generate and consumers read.

## Decision

**Comments are a third top-level map in the document.** `Document.comments: Record<Id, Comment>`, with `Comment = {id, text, targets: Id[]}`, beside `model` and `layout`. A consumer reading structure ignores it; a producer regenerating a subsystem never touches it. `formatVersion` goes to 7, so a version 6 build refuses the file rather than dropping the discussion on save.

**A comment attaches to elements, or to nothing, and an attached one dies with its last target.** An empty target list is a general remark about the whole document, which is how discussion that belongs to no single box gets written (PR #39 review). Deleting an element strips it from every comment's targets, cascades included, and a comment that had targets and lost the last one is deleted, the same rule a connection follows when it loses an endpoint: it was written against that thing. A general comment was written against nothing in particular and lives until deleted.

**Creation time rides the command.** `create-comment` carries an optional ISO 8601 `createdAt`, supplied by the caller, so the reducer stays pure and a trace replays identically. The feed orders by it, with ids breaking ties and untimed comments first.

**Comment ids share the selection's id space with elements.** The issue says a comment's text shows when "it or one of the components they are attached to is selected", which makes a comment selectable. Reusing `selection` keeps that one gesture: `set-selection` accepts either kind of id, and the emphasis rule reads a selected comment as its targets, so pointing at a remark highlights what it discusses. A validation error (`id-collision`) keeps the two namespaces from overlapping.

**Four commands: `create-comment`, `set-comment-text`, `set-comment-targets`, `delete-comment`.** All document changes, all undoable by the refold, all replayable from a trace. Duplicating elements does not copy comments: a remark is about the specific thing it was written against, not about anything shaped like it.

**The filter key `comment` is reserved, and a quoted key escapes it.** `comment` matches every element with a comment attached; `comment=text` narrows to comments containing the text, matched as a case-insensitive substring rather than fuzzily, because comment text is prose and a fuzzy match across a sentence catches far more than anyone typed. Quotes hold a space inside one term (`comment="fix this"`). The search menu offers both forms, which is how a comment is found from its words. A tag key literally named "comment" is written with a quoted key (`"comment"=todo`, or `"comment"=*` for any value), which the parser always reads as a literal tag, so the tag filter and the comment filter coexist and the search menu offers both, told apart by their kind glyphs.

**On the board, a comment is a badge until it is read.** Each target draws a small badge; the text opens only while the comment or a target is selected. The single-element editor writes, edits, and deletes comments in place, and the multi-selection panel is where a comment across several elements is written. Emptying a comment's text deletes it, so there is one way a resolved remark leaves the board.

## Rejected

**Comments inside `model.elements` as a fourth element kind.** They would ride along with every consumer and every paradigm rule for free, and that is the problem: a codebase scan regenerating the model would have to know to preserve them, and validation would have to exempt them from orphan and paradigm checks. Discussion is not structure.

**Comment text in `description`, by convention.** No attachment to several elements, no lifecycle, nothing to select or filter, and the first consumer that renders descriptions shows the discussion as if it were the domain.

**A stored board position per comment.** The issue keeps comments out of `layout`, and a position is derivable: a comment shows where its targets are. A stored position would also dangle when targets move or die. *Reversed by [decision 017](017-discussion-overlay.md)*: the discussion overlay lets a reader arrange its cards, and an arranged card's pin is geometry, which is exactly what `layout` holds.

**Fuzzy matching for `comment=text`.** Consistent with how titles are searched, but titles are names and comments are sentences; subsequence matching over a sentence matches almost any short query.

**Keeping an orphaned comment with a warning.** Symmetric with `label-unattached`, but a label names prose against a structural pair that still half-exists, while a comment with zero targets has lost every anchor it had; there is nowhere to draw it and no gesture that reaches it.
