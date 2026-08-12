# 014: A junction labels its branches, and the labels live on the junction

**Status**: accepted · **Date**: 2026-08-09 · **Revised**: 2026-08-12 for issue #66, which removed the close delay along with hover-to-open (see [decision 023](023-roller-menu-input.md))

## Context

A decision node says which way a flow can go; it does not say *why* it goes one way rather than another (issue #12). A reader looking at two lines leaving a diamond has to infer the condition, or write it into each connection's title, which then reads as the name of the line rather than the answer to the question. The issue asks for labels per connection on decision types, shown while the decision or the line is being read, and edited from a new connections menu beside the junction.

The tension is where a label belongs, and what the menu is for. A label is about a pair — this junction, that branch — and neither end owns it outright.

## Decision

**Labels live on the connection node, keyed by connection id.** `ConnectionNode.labels: Record<Id, string>`, so a junction carries the answers to its own question, matching the existing split where the title carries the question. A line running between two decisions answers both, and keying by connection id lets it hold one answer per end without a second field or a pair table. `formatVersion` goes to 6; a version 5 build refuses the file rather than dropping the sentences someone wrote.

**Shape does not gate the field.** Any connection node may carry labels, not only diamonds. `shape` is presentation and "carries no meaning the model reads" (docs/domain-model.md); making a model field appear and disappear with it would contradict that, and a plain junction is welcome to explain its branches.

**A stale key warns rather than fails.** `label-unattached` fires when a label names something that is not a connection touching the node. Loading still succeeds: prose a reader wrote is worth keeping until they say otherwise, unlike a `from` that names nothing, which leaves a line with no end. The reducer keeps the model tidy from the inside instead — deleting a connection, or dragging its end off the junction, takes the label with it, and a copy of a junction with its branch carries the label onto the copy.

**One `set-connection-label` command, and an empty label removes the key.** There is one way to say "nothing to add", so a cleared label leaves no empty string in the file. The command refuses a connection that does not touch the node: an answer against a line that is not there means nothing.

**A label is part of the drawing, not something to go looking for.** Every answer is drawn at the junction's end of the line it belongs to. An unlabelled branch and a branch whose answer is hidden look the same, and a reader deciding which way to follow a flow should not have to click first. Selecting the junction, or the line, brings its answers forward rather than revealing them. Labels sit out along the line from the junction they belong to, which is what makes a label at each end of one line readable.

**Labelling extends the relations menu rather than adding a second control.** The roller beside a selected element already lists everything it connects to; on a junction, choosing a relation now branches into *go to* and *label* instead of panning straight away. Everywhere else it still pans, because nothing else has an answer to give. Two rollers beside one element, both listing the same connections and differing only in what choosing one does, is a menu split down the middle. `RollerMenu` gained two-line pills, stepper buttons, an option depth, and an opening level for this, and it stays generic: components get connection points of their own in issue #6, and the same control will carry them.

**The list closes on a delay.** Turning the roller slides its options, so a stationary pointer can find itself over the gap between two pills. Closing on the first mouseleave shut the menu out from under a reader who had not moved, and took the level they were on with it. *(Superseded by decision 023: the roller now opens on click and closes on a click elsewhere, so there is no mouseleave to soften.)*

**A junction anchors its branches at its vertices, not at its centre.** Four contact points instead of one. With every line leaving the same point, two answers to the same question are drawn on top of each other, and there is nowhere for a reader to aim when they want *that* branch. Which vertex a line uses stays layout, chosen by geometry and overridable by dragging, the same rule a box's sides follow.

## Rejected

**Labels on the connection, keyed by node id.** Symmetric with the choice made, and it puts a decision's answers on elements that know nothing about the question. Reading "what does this decision say" would then mean scanning every connection in the document rather than one lookup.

**One label field on the connection.** Cheaper, until a line runs between two decisions and the two answers fight over the field. The issue asks for both to show.

**A `decision` element kind, or gating labels on `shape === 'diamond'`.** Both make presentation load-bearing, and a document generated by a producer that ignores shape would lose its labels.

**`unknown-reference` as an error for a stale label.** Refusing to load a whole document because one annotation outlived its line is out of proportion to the damage.

**A second menu of its own beside the junction.** How this was first built: a connections roller on the left, pan-to-relation on the right. It put two lists of the same connections beside one element, and made the reader learn which corner meant which verb.

## What would reverse this

- Connection points on components (issue #6) needing labels of their own. That would move `labels` up to `ElementBase`, or introduce a shared "annotation" map, rather than duplicating the field per kind.
- Readers wanting a label visible permanently, as part of the drawing rather than something read on demand. That would make visibility a stored choice per label instead of a function of what is selected or hovered.
- Labels growing past a phrase into prose. That would make them elements in their own right, with tags and sources, rather than strings in a map.
