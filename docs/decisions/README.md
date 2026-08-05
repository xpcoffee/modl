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

The build order these decisions were first applied in lives in [the bootstrap spec](../specs/001-bootstrap.md).
