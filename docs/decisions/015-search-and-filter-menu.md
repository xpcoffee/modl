# 015: One menu searches and filters, and a filter is a term in one expression

**Status**: accepted · **Date**: 2026-08-10 · Issue [#33](https://github.com/xpcoffee/modl/issues/33)

## Context

The board was navigable in two ways that did not meet. The tag filter sat in a bar above the canvas, always present, always taking a row of screen whether or not anyone was filtering, and it only understood tags, so an element you could see but could not name a tag for was unreachable. Panning to a relation (decision 009) walked the graph one hop at a time from a selection you already had. Neither answers "where is the thing called *ledger*".

Issue #33 asks for one control that does both: fuzzy search that narrows the board as you type, with the option to make that narrowing permanent, reachable by Ctrl+F from a button over the board rather than a bar beside it.

The tension is between two ways of holding "several filters". A list of filter objects in session state reads directly, and it duplicates a grammar that already exists: `parseFilter` has combined terms with AND since the first filter bar.

## Decision

**A filter is a term in the one filter expression.** `AppState.filter` stays a single string, and the menu presents `parseFilter(state.filter).terms` as chips. Adding a filter appends a term, editing one replaces it, removing one splices it out, and each edit dispatches one `set-filter` with the rewritten expression. Nothing new enters the state shape, the trace, or the reducer: `set-filter` already carried the whole expression, so a replay of a search session needs no new command. `addTerm` and `replaceTerm` in `packages/core/src/query/filter.ts` do the rewriting, so the app never assembles an expression by string concatenation.

**The grammar gains a quoted text term, matched fuzzily against the title.** `"payment gateway"` filters the board to elements whose name reads like that. Quoted, because a bare word already means "carries this tag key" and a name with a space would otherwise split into two terms. This is the "non-tag filtering" the issue asks for, and it falls out of the same expression: `team=payments "ledger"` is one filter with two terms, and each is its own chip. An element with a title answers to its title alone; an untitled one answers to its readable name, which is what the board and the traces call it.

**Fuzzy means an ordered subsequence, scored.** `fuzzyScore` in `query/fuzzy.ts` walks the query through the candidate: characters must appear in order, a character continuing the previous one scores most, one starting a word next, one landing mid-word least, and a long candidate loses a fraction of a point. That is what makes `chkui` find *Checkout UI* while still ranking *Ledger* above *Loud edgy generator* for `ledger`. Spaces in the query are skipped rather than matched, so `payment gate` finds `PaymentGateway`.

**The narrowing you see while typing is a preview, not a command.** `searchPreview.ts` holds one expression outside the store, like the pan-to-relation highlight in `highlight.ts`, and the canvas derives the board from `{ ...state, filter: preview }`. Without this, either every keystroke would land in the trace, or closing the menu would have to undo a command. The menu's whole first option is that applying the filter is a separate, deliberate act. Nothing is previewed while the query is empty, so opening the menu leaves the board exactly as it was.

**The preview stands the selection highlight down.** Decision 009 gives the selection highlight precedence over the filter, which would mean the preview showed nothing whenever anything was selected, which is most of the time someone reaches for search. So the derived state passes `selectionHighlight: false` while a preview runs. The selection itself is untouched, so what is chosen stays chosen and stays drawn as chosen.

**The option list leads with the filter until one element is left.** While several elements match, the first option applies the query as a text filter, followed by the tag filters that read like the query, followed by the elements themselves. Once exactly one element matches there is nothing left to narrow, so the list holds that element alone and the only act is going to it. `searchOptions` in `query/search.ts` owns that ordering, which keeps it headless-testable (decision 005) rather than buried in a component.

**Going to an element pans to its visible anchor and selects it.** Same shape as pan-to-relation: a `set-view` command and a `set-selection`, so the camera follows the bus and a trace records where the reader went. An element inside a collapsed group has no place on the board of its own, so the camera goes to the group standing in for it rather than to coordinates nothing is drawn at. A connection carries no box of its own either, so the camera goes to the middle of the line drawn between its endpoints. Both answers come from `goToTarget` in `query/go-to.ts`, which reads the layout focus mode overlays, so the camera goes where the reader sees the element (issue #106).

**The button grows into the bar, and the reader's motion preference decides whether it does.** The CSS reads `:root[data-motion='reduced']`, the same stamp the warps read, so the preference panel added for issue #30 reaches this too and the bar is replaced instantly when motion is off. The component holds no opinion about motion.

**Ten options at a time, cycled.** Arrow keys and the wheel turn the list, Enter or a click takes the active option, Escape or a click outside closes. Five filters is the cap; at the cap the menu stops offering a new one rather than offering one it would refuse.

**Editing a filter is the same bar with the elements left out.** A chip opens the bar seeded with how that filter reads, showing filter options only: an editor edits filters, and going to an element is a different act. Emptying the field removes the filter. Every change lands immediately, so closing the menu keeps what was changed and there is no state in which the board disagrees with the chips.

**The filter bar is gone, and what lived on it moved.** The highlight-selection preference is now a control button beside React Flow's interaction lock. It belongs with the other switch that changes how the board behaves rather than what it holds. The list of hidden elements keeps its own strip over the top-left of the board, drawn only when something is hidden: a list of things you cannot see is no use behind a keystroke, and decision 009 counts it as one of the three ways back from hiding.

## Rejected

**A `filters: Filter[]` field beside `filter: string`.** Two sources of truth for one question. Every consumer (`selectIds`, `boardEmphasis`, the toolbar count, the trace, `set-filter`) would need to learn which one wins.

**Replacing `filter: string` with `filters: Filter[]`.** Honest, and it throws away a grammar that already composes terms with AND, migrates every existing trace, and gains nothing the terms did not already give. What would reverse this: wanting a filter that cannot be written as a term, such as one holding an explicit set of ids.

**A `text:` or `~` sigil instead of quotes.** Both collide with legal tag keys, and neither survives a name with a space.

**Dispatching `set-filter` per keystroke, as the old bar did.** The old bar had no other way to show its effect. It also filled the trace with half-typed expressions, and it cannot express "try this, then decide", which is the feature.

**Keeping the filter bar for the raw expression.** It was the only way to type an unparseable filter, and the test that covered that went with it. The menu builds terms structurally, so it cannot produce one; the reducer still refuses a broken expression arriving from a trace or the runtime API.

**Letting the search menu clear the selection so the filter regains precedence.** It would deselect what someone was working on to answer a question about somewhere else.

## What would reverse this

- A filter that cannot be written as a term in the expression: an explicit id set, a saved named view, an OR between groups of terms. Any of those turns the expression into a structure, and the chips become that structure's editor.
- Search needing to rank on more than a name: a description, a tag value, a connected element's title. The scorer stays, but hits stop being one-per-element and `SearchOption` grows a reason for the match.
