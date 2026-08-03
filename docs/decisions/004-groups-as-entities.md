# 004: A group is an entity others point at, sized by its own box

**Status**: accepted · **Date**: 2026-08-03

## Context

Groups are how zooming works: a set of elements collapses into one, and expanding it shows the detail again. This is the differentiating idea, so the model behind it has to stay simple enough to query and generate.

## Decision

**No group type.** An entity becomes a group as soon as something names it in `groupId`. There is no separate kind and no flag to keep in step with membership, so a group cannot disagree with its own contents.

**A container is sized by its own rectangle**, which the reader resizes, and membership follows that box: dropping an element inside joins it, dragging one past the edge takes it out.

This is the load-bearing part. Sizing a container from the bounding box of its members reads better and breaks twice: moving the container changes nothing, because it snaps back to where its contents are, and a member dragged away carries the box along and can never leave. The box has to be independent of what is in it.

**Expansion is session state, not document state.** Which groups a reader has open is their view of the domain. Two people reading one file should not fight over it.

**Deleting a group lifts its members** to whatever contained the group. Nothing is left pointing at an id that no longer exists, and a slip does not destroy work.

**Cycles are rejected by the reducer**, so a loop is unreachable through the UI, and validation still catches one in a hand-authored file.

## Consequences

A saved file does not remember how it was left. Reopening starts collapsed.

`group-elements` sizes its own box around the members it takes in. Leaving the geometry to the caller produced a container sitting on top of its first member with the header behind it, and every caller had to redo the same arithmetic.

An empty container is allowed and useful: it draws as a box to drag elements into, and an entity that never gains a member stays an ordinary entity once collapsed.

A connection re-points at the outermost collapsed group hiding its endpoint. A connection with both ends inside one collapsed group is dropped, because it says nothing at that zoom level.

## Rejected

**A distinct `group` kind.** A second source of truth about membership, and a group that could be empty in one place and populated in another.

**Auto-sizing containers to their members.** See above: it makes moving and leaving impossible.

**Persisting expansion in the document.** It turns a reading preference into a shared edit.

## What would reverse this

Wanting a saved file to reopen the way it was left. That is expansion in the document, and it needs a rule for whose view wins.
