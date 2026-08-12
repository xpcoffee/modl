# 023: Resolving a comment deletes it, and version control keeps the history

**Status**: accepted · **Date**: 2026-08-12

## Context

Comments carry review discussion (decision 016), and nothing said what happens when a remark is dealt with. Applying a review therefore mutated the reviewer's words: one round replaced comments with "resolved" notes, the next deleted them and told the story outside the model (issue #57). The document-structure proposal offered a `resolvedAt` timestamp with a hide-resolved board as the alternative.

## Decision

Resolution is deletion, through the existing `delete-comment` command. The document holds open discussion only; a comment that has served its purpose leaves the file, and the file's version control keeps the history, so going back in time to see previous comments is a checkout rather than a format feature. Within one session the trace records the deletion too.

This is a convention, recorded in docs/domain-model.md's Comments section, and it costs no format change.

## Consequences

An audit view reads the file's history rather than the file. A producer applying a review deletes each comment as it resolves and tells the story in the commit or pull request that carries the change. A document kept outside version control loses resolved discussion permanently; that is the accepted price of a file that never accumulates a closed-comment graveyard.

## Rejected

**`resolvedAt` on the comment, with resolved comments hidden by default.** The file then maintains an ever-growing comment history that every consumer carries and no one reads in place; version control already stores exactly that history for free.

**Reply threads (`parentId`) plus a status field.** Nothing yet demands threads; two full review rounds worked with flat comments. The first session where a comment genuinely needs a reply reopens this.

## What would reverse this

Documents routinely living outside version control: the history argument collapses, and resolution state would need a home in the file after all.
