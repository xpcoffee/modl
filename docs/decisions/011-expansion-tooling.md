# 011: Expansion tooling batches set-expanded over a scope of items

**Status**: accepted · **Date**: 2026-08-05

## Context

Opening a deeply nested diagram one group at a time is slow (issue #20): reaching the third level of a five-group document takes a click per group per level. The issue asks for a roller menu on the selected group offering batch operations: expand, collapse, expand next level, collapse next level, expand all, collapse all, with the same behaviour on a multi-selection. The tension is between a menu of five special-cased UI actions and one model that decides, for any anchor, which groups each operation touches, what the default is, and which options apply.

## Decision

**Each operation is a pure query over a scope of items.** Four helpers in `packages/core/src/query/expansion.ts` take `(elements, expanded, itemIds)` and return the group ids to touch, in dispatch order. `itemIds` is the contents of the group the operation reads: a single open group passes its members, a single collapsed group passes itself, and a multi-selection passes the selected ids. This is the whole of the multi-select rule: a selection behaves as one open group holding the selected items, without any group existing. The UI (`packages/app/src/canvas/ExpansionMenu.tsx`) only picks the scope and dispatches.

**The four sweeps are defined by what the reader can see.**

- *Expand next level* expands the collapsed groups the reader can currently see: collapsed items, and collapsed groups sitting inside a run of expanded ones. It never reaches through a collapsed group, so nothing expands out of sight.
- *Collapse next level* collapses the "leaf" expanded groups: expanded groups with no expanded group below them. That puts away the deepest open level while every level above stays open, the inverse of one expand-next-level.
- *Expand all* expands every collapsed group in the scope, at any depth.
- *Collapse all* collapses every expanded group in the scope, root items first, then deeper levels, matching the sweep the issue describes. The anchor group itself stays open: the reader selected it to look at it, and plain *collapse* is one roll away.

**Batch operations dispatch one `set-expanded` per group.** No batched command was added. `set-expanded` is session state outside the undo history (decision 008 lists it as a session command), the store already offers `dispatchAll`, and the toolbar batches multi-element actions the same way. One command per group keeps the trace replayable step by step and makes the collapse-all ordering visible in it.

**No-op options are hidden, not disabled.** An option whose target set is empty is dropped, so every slot on the roller changes the board. A disabled slot on a roller would still take a turn of the wheel to pass, which is friction with no action behind it. A collapsed group with nothing collapsed inside therefore offers only *expand*, and a fully expanded group offers only the collapse family.

**The default is the plain action for the anchor's current state.** The roller opens on its first option, so ordering is the default rule: a collapsed group leads with *expand*, an open group with *collapse*. A multi-selection has no "this item", so it leads with *expand next level* when anything in it is collapsed, otherwise *collapse next level*.

**Placement: expansion left, pan-to-relation right.** The menu anchors on the top-left corner of the selected group, or of the multi-selection's bounding box, beside where the per-group expand and collapse buttons already live. Pan-to-relation keeps the top-right corner (decision 009), so both rollers stand apart on one selected connected group.

## Rejected

**A batched command (`set-expanded-many`).** It would put the sweep's ordering inside one opaque entry, make replay all-or-nothing, and add a command type for what `dispatchAll` already does. Reversal would only be worth it if traces grow so long that per-group entries hurt.

**Counting the anchor group into collapse-all.** Collapsing the anchor too would close the box the reader is working in and, by clearing the inner expansion state, lose the difference from plain *collapse*, which remembers what was open inside.

**Disabled options for no-ops.** See above: a roller is not a flat menu, and a dead slot costs a wheel turn every pass.

**"Next level" as direct children only.** Expanding only the anchor's direct child groups leaves deeper visible collapsed groups behind when branches are open to different depths, and the reader would need several rolls where one "one more level of detail everywhere" does it.

## What would reverse this

- A group with hundreds of descendants making per-group dispatch visibly slow or flooding the trace. That would bring in a batched command with an ordered id list, keeping the semantics here.
- Readers expecting collapse-all to also close the anchor group. That would add the anchor to the collapse-all scope and drop the "keeps inner state" distinction.
- A third roller consumer beside a selected element. The two corners are now taken, and a third would force a shared placement scheme (stacking, or one roller with submenus) instead of a corner each.
