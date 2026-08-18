# 032: The core derives note card placement, and a pin holds only while the board draws its saved geometry

**Status**: accepted (issue #105) · **Date**: 2026-08-17

## Context

Decision 030 gave a note card two ways to sit: an optional pin in `layout`, or a derived place at its targets' centroid plus a fixed offset, computed in the renderer. Two changes moved the board out from under both. Focus mode (decisions 027, 029) overlays a compacted layout, so elements pack tightly while pins stay at their saved coordinates and derived cards hang into rows that are now only 48 pixels apart; cards landed on top of element boxes. And producers create notes through `create-note`, which took no placement at all, so a generated document's cards derived spots with no regard for what already stood on a dense board. Reflow and compact carried pinned comment cards with their scope but ignored pinned note cards, so a tidy-up moved elements under a note that stayed behind. Comment cards themselves are out of scope here (issue #105); they already travel with reflow and compact.

## Decision

**The core derives every note card's place, and the app renders what it derives.** `noteCardPlacements` (`packages/core/src/query/note-placement.ts`) runs over the same overlaid state the focus layout computes (`focusLayoutState`), matching how decisions 027 and 029 keep compaction a core derivation. One rule decides what a pin means: it holds exactly while the board draws its saved geometry. The moment focus mode overlays a compacted layout, the pins stop describing the board the reader sees, so every card derives from its targets' compacted positions instead. The pin is never written, so leaving the mode restores it: the same transient-view rule the layout itself follows.

**A derived card hangs above its targets and rises clear.** The card starts at its targets' centroid, offset above them (comments hang below, so an element carrying both never stacks the two). It then rises straight up until it covers no element box and no card already placed, in note-id order, so the result is deterministic. Rising keeps the card centred over its targets and always terminates. An expanded container counts as an outline whose interior a card may share; its members are the solids a card must clear. The card's box is the nominal `NOTE_CARD_SIZE` (240x88): the rendered height is content-driven, so a card taller than nominal can still brush the box above it, a cost accepted over measuring text inside the core.

**Reflow and compact carry pinned note cards the way they carry pinned comment cards.** Both plans read the note map beside the comment map when they gather pinned cards, so a note pinned inside an expanded container re-spaces with the members, and a root-level pin packs with the root scope.

**`create-note` takes an optional `position`, and `modl check` reports a pinned note covering an element.** A producer that knows where a card belongs pins it in one command. One that does not leaves `position` out, and the board derives a clear spot beside the targets. The new `note-over-element` issue in `inspectLayout` reports a bad pin in the same check that already reports overlapping entities, so a producer sees the mistake without a browser.

## Rejected

**Packing note cards into the focus plan as boxes.** The focus plan is built from a document whose layout is filtered to elements, so unpinned cards have nothing to pack, and a card packed as a row box competes for space with the structure the reader filtered for. Deriving after the pack keeps cards subordinate to the elements they describe.

**Scanning candidate sides (above, below, left, right) for the nearest clear spot.** Four placements to explain and test against one, and a side chosen by geometry flips as the board shifts. Rising up keeps one readable rule: a note sits over what it describes.

**Resolving overlap for pinned cards too.** A pin is the reader's explicit choice; moving it silently would fight the hand that placed it. The check reports a bad pin instead of correcting it.
