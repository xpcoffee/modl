# Decisions

One file per decision. Each records what was chosen, the tension it resolves, what was rejected, and what would reverse it.

A decision earns a file when reversing it later would be expensive: it shapes the data format, the architecture, or how the project is built and released. Choices that are cheap to change belong in code comments.

| Decision | Choice |
|---|---|
| [001](001-command-bus.md) | Every state change goes through a pure command reducer |
| [002](002-flat-model.md) | The model is flat and normalized, with layout held separately |
| [003](003-react-flow.md) | React Flow renders the canvas, with state kept outside it |
| [004](004-groups-as-entities.md) | A group is an entity other elements point at, sized by its own box |
| [005](005-headless-core-tests.md) | Logic is tested headless, with a thin browser suite over it |
| [006](006-pr-previews.md) | Each pull request publishes a preview to GitHub Pages |
| [007](007-element-styles.md) | Style lives on the element, and the last choice follows the reader |
| [008](008-undo-redo.md) | Undo refolds the command log rather than inverting commands |
| [009](009-viewing-tools.md) | Viewing tools (hide, highlight, pan-to-relation) are session state, composed by one emphasis rule |
| [010](010-gravity-wave-art-direction.md) | Motion speaks the language of gravity waves, app-side only |
| [011](011-expansion-tooling.md) | Expansion tooling batches set-expanded over a scope of items, read as one group |
| [012](012-selection-gestures.md) | Selection gestures compute the next selection, then dispatch one set-selection |
| [013](013-duplication.md) | A copy covers a self-contained set of elements, and arrives as one duplicate-elements |
| [014](014-connection-labels.md) | A junction labels its branches, and the labels live on the junction |
| [015](015-search-and-filter-menu.md) | One menu searches and filters, and a filter is a term in one expression |
| [016](016-comments.md) | Comments live beside the model, and attach to elements |
| [017](017-discussion-overlay.md) | Discussion is a temporary overlay, and its cards pin in layout |
| [018](018-customizable-keybindings.md) | Input bindings are reader preferences, matched through one table |
| [019](019-save-in-place.md) | Save writes back to a remembered file, chosen through the system picker |
| [020](020-compact-packing.md) | Compact packs each scope into banded rows, through the reflow command |
| [021](021-default-expanded.md) | A document hint seeds first-open expansion, and the session owns it after |
| [022](022-comment-resolution.md) | Resolving a comment deletes it, and version control keeps the history |
| [023](023-roller-menu-input.md) | The roller menu opens on click and turns under held input |
| [024](024-menu-docking.md) | Selection menus dock at the bottom centre when their anchors fail |
| [025](025-menu-focus.md) | Tab moves real DOM focus: a ring over the selection menus, a soft focus over the board |
| [026](026-zoom-floor-follows-board-extent.md) | The zoom floor follows the board's extent, and never moves the camera itself |
| [027](027-filter-focus-compaction.md) | Focus compaction is a derived layout, and geometry gestures pause under it |
| [028](028-filter-auto-expansion.md) | A committed filter opens the groups above its matches, and clearing restores the reader's set |

The build order these decisions were first applied in lives in [the bootstrap spec](../specs/001-bootstrap.md).
