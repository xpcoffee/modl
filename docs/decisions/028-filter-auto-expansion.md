# 028: A committed filter opens the groups above its matches, and clearing restores the reader's set

**Status**: accepted · **Date**: 2026-08-13

## Context

A filter that matches an element inside a collapsed group marks the group with a match-count badge, and the element itself stays off the board (decision 009). On a board nested two or three groups deep the reader expands each level by hand to reach every match, which issue #77 asks to remove. Expansion is session state (`expanded: Id[]`), one reader's view of the domain, and never writes to the file (decision 021). The search menu previews a filter while the reader types without dispatching anything; only a committed term reaches the `set-filter` command.

## Decision

The `set-filter` reducer owns the behaviour, so the app, the CLI, and a replayed trace all see the same board. Three rules:

1. **Applying a filter takes a snapshot and opens paths.** The first commit of a non-empty expression stores the current `expanded` list in a new session field, `expandedBeforeFilter`. Every commit while a filter is active derives `expanded` afresh: the snapshot, plus the group chain (`ancestorsOf`) above each match. Matches come from `selectIds`; matches the reader has hidden drive no expansion, because hiding beats filtering (decision 009).
2. **Clearing the filter restores the snapshot.** A committed expression with no terms puts `expanded` back to `expandedBeforeFilter`, pruned of ids deleted in the meantime, and clears the field. A search never permanently unfolds the board.
3. **Manual collapse wins until the next filter commit.** `set-expanded` is untouched: a reader who collapses a group while a filter is active sees it stay collapsed, with the match-count badge still pointing at what is inside. The next committed filter change re-derives from the snapshot and opens the path again, because editing the filter restates "show me the matches".

Deriving each commit from the snapshot rather than from the current `expanded` keeps filter edits from stacking: the board under a filter is a function of (snapshot, expression), so narrowing an expression folds the paths that no longer hold matches, and a trace replays to the same set. The cost is that manual expand and collapse made during a filter lasts only until the next commit; the badge covers the collapsed case, and the reader's pre-filter set survives regardless.

`expandedBeforeFilter` is session state like `expanded`: it never serialises into the document, `load-document` resets it with the filter, and an undo refold carries it over pruned to elements that still exist, the same treatment `expanded` gets.

## Consequences

Every match is on the board the moment a filter commits, at any nesting depth, and clearing the filter hands back exactly the board the reader had. The match-count badge now appears only on groups the reader keeps collapsed under a filter (a manual collapse, or a group whose only matches are hidden). `set-filter` emits one `expansion-changed` event per group it opens or folds, so the trace and any animation react as they do to `set-expanded`.

## Rejected

**Expanding in the search menu by dispatching `set-expanded` per group.** The behaviour would exist only in the app: a CLI or trace replay would filter without expanding, and the restore-on-clear bookkeeping would live in a component instead of the reducer.

**Deriving each commit from the current `expanded` set (additive only).** Preserves manual toggles made during a filter, but narrowing an expression would leave stale paths open, and the board would depend on the order of edits rather than on the expression.

**Re-asserting expansion on every `set-expanded` while a filter is active.** Fighting the reader's collapse takes away their only way to put a noisy subtree aside mid-search; the badge already signposts what a collapsed group holds.

## What would reverse this

Readers losing deliberate mid-filter expansion work to a filter edit in practice. The derivation would then move from the snapshot to the current set, accepting stale open paths as the price of preserving manual toggles.
