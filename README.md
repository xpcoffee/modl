<img src="packages/app/public/modl.svg" alt="" width="72" align="left" hspace="12" />

# modl

> currently an AI PoC

A visual tool for structuring, visualizing and extending domains/mental models.

<br clear="left" />

## Problem

Teams share knowledge about a system with tools that record none of its structure. A collaborative whiteboard handles ad-hoc brainstorming well, and the drawing it produces is hard to reuse or extend, so the next session redraws the system from scratch. These tools also lack tagging and filtering, so one diagram cannot be focused on one aspect of a model. They offer one level of detail, so zooming into part of a mental model means drawing a second diagram that immediately drifts from the first.

## Goal

Let users draw a domain while the tool records a structure underneath: stable ids, typed relations, groups that act as zoom levels, and tags that drive filtering and highlighting. The drawing becomes one view of that structure. Other systems read the same structure as a pseudo-source of truth, and can generate it without opening the whiteboard.

## General development specs

- all functionality (including visual actions) MUST be drivable and testable by agents during development
- functionality (including visual actions) MAY be drivable and testable by agents at runtime
- all actions in the whiteboard MUST be traceable across a user session so that we can track what happened for debugging and analytics
- a series of users actions MUST be able to be provided to the whiteboard (programmatic API) to replay events (for debugging)
- each feature MUST be e2e testable by an agent, locally
- testing MUST run through scripts that spend no tokens and report enough detail for an agent to know what broke and why

## Docs

| File | What it holds |
|---|---|
| [docs/vision.md](docs/vision.md) | The full picture: three paradigms, groups as zoom, forks |
| [docs/agents.md](docs/agents.md) | Producing a document from another tool, and checking it reads |
| [docs/domain-model.md](docs/domain-model.md) | The structure, the file format, validation rules. Enough to generate a document from another source |
| [docs/decisions/](docs/decisions/) | One file per architectural decision: the tension, what was rejected, what would reverse it |
| [docs/specs/001-bootstrap.md](docs/specs/001-bootstrap.md) | Iteration 1 scope, commands, features, acceptance criteria |

## Running it

### Prerequisites

Node 20.19+ or 22.12+, pinned to 24.18.1 in `.nvmrc`.

Vitest 4 and Vite 8 both refuse older releases. On an older Node, npm skips their native bindings, reports a successful install, and the test run then fails with a message blaming an unrelated npm bug. If you see `Cannot find native binding`, check `node --version` first.

```bash
nvm use          # reads .nvmrc
npm install
```

Already have a terminal open on an older Node? nvm keeps whatever version is on `PATH`, so `nvm use` in the repo, or `nvm use default` anywhere, is what switches it.

### Commands

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm run verify` | Typecheck, then the full test suite. The one to run before calling something done |
| `npm test` | Unit tests across every workspace, headless, about 200ms |
| `npm run typecheck` | `tsc --build` across the project references |
| `npm test --workspace @modl/core` | Tests for one package |
| `UPDATE_GOLDEN=1 npm test` | Rewrites golden files after a deliberate change. Read the diff before committing it |

Single test file, watched:

```bash
cd packages/core && npx vitest src/serialize/serialize.test.ts
```

`npm run verify` exits non-zero when any part fails, so it works as a gate in a script or a hook.

### The whiteboard

```bash
npm run dev      # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server for the whiteboard |
| `npm run build` | Static production build into `packages/app/dist` |
| `npm run test:e2e` | Playwright suite driving the running app. Starts the dev server itself |

The browser suite needs Chromium once:

```bash
node_modules/.bin/playwright install chromium
```

Use that path rather than `npx playwright install`, which fetches whatever version npm resolves and puts the browser where the pinned Playwright will not look for it.

### What you can do in it

- **Add** opens a list of what you can place: component, state, step, artifact, connection node, decision. Then click the canvas to drop one, or drag to size it. Double-clicking empty canvas still makes a component
- **Convert** an element by clicking its type chip: a component can become a decision and back, keeping its title, tags, and every connection reaching it
- **Re-point** a connection by selecting it and dragging either end onto another element
- **Rename** by double-clicking an element or a connection label. Enter commits, Escape discards
- **Drag** a node to move it, or its corners to resize it. Both are recorded on release, so the trace holds the result you meant
- **Multi-select** with Control-click or Cmd-click. Dragging moves the whole selection
- **Duplicate** with Alt-drag: the copies follow the cursor as outlines and land on release, leaving the originals where they are. Copy the selection with Ctrl+C and paste it centred on the pointer with Ctrl+V, once or several times as the cursor moves. A copy brings a group's members and the connections running between what it copies; a connection reaching something left behind stays out. See [decision 013](docs/decisions/013-duplication.md)
- **Connect** two elements by dragging between the handles on any of their sides. A line attaches to whichever sides are nearest, and the arrowheads say which way it reads: one way, both, or neither. The connection takes the paradigm of what it points at
- **Select** a node or edge to edit it in place: click the type chip to change paradigm, type into the description, click a tag to rename or retype it, `+ tag` to add one. A trash button appears under the selection, for one element or many
- **Hover** an element for its description and tags. A type icon is always visible: a cube for a component, a ring for a state, a footprint for a step
- **Group** any selection, or none, to start a container. Drag elements in and out of it, resize it by its corners, and collapse or expand to move between levels of detail. Connections into a collapsed group re-point at the group
- **Search** the board with Ctrl+F, or the Search button over the top of it. Typing fuzzy-matches element names, so `chkui` finds *Checkout UI*, and narrows the board as you type. The first option makes that narrowing permanent as a filter; once one element is left, the only option is to go to it, which pans the camera there and selects it. Arrow keys or the wheel cycle the options, ten at a time; Enter takes one, Escape closes. See [decision 015](docs/decisions/015-search-and-filter-menu.md)
- **Filter** from the same menu, with tag filters like `team=payments` or `-deprecated` alongside a name filter like `"ledger"`. Non-matching elements dim rather than disappear. Up to five filters stack, counted on the button; each is a chip you can click to edit or × to remove, and every change lands immediately
- **Hide** an element from its editor, or several at once from the selection actions, which also offer Show for the hidden part of a mixed selection. Hiding deselects, the element dims, its connections leave the board, and a strip over the top-left of the board lists what is hidden. Connections cannot be hidden directly: they leave only with an endpoint
- **Select** anything to highlight its neighbourhood: the selection, its connections, and the elements at their other ends stay readable while the rest of the board dims. The spotlight button in the board's control cluster, beside the interaction lock, turns this off
- **Pan to a relation** with the roller beside a selected element, a pill naming its connection count. Hover opens it into a vertical list rolling through the middle; arrow keys or the mouse wheel turn it, the middle option's connection is emphasised on the board, and clicking the middle option pans the camera to that element
- **Reroute** a line by selecting it and clicking a hollow handle to add a bend. Drag a bend to move it, double-click it to remove it. The editor toggles an arrowhead at either end
- **Style** the selection from the same editor: a fill colour for components (drawn mostly transparent), a stroke colour and line style for anything, and the arrowhead glyph for connections. A multi-selection edits everything it can: fill applies to the selected components, arrowheads to the selected connections. The last choice follows onto whatever you create next
- **Reflow** the board with the grid button in the control cluster: one press re-spaces elements so neighbours clear each other and line labels have room, keeping every element's place in the reading order. Labels keep off the boxes they are not attached to and off each other, expanded groups grow when their members need space, collapsed groups carry their members, and pinned comment cards get the same clearance as a box. The move glides unless motion is reduced, and one undo puts everything back. See [decision 018](docs/decisions/018-reflow.md)
- **Delete** removes the selection, on either Delete or Backspace, or with the trash button
- **Undo** with Ctrl+Z, redo with Ctrl+Y or Ctrl+Shift+Z, or the arrow buttons in the zoom control cluster. Every command is undoable, including loading a document; selection, filter, and camera changes are skipped. See [decision 008](docs/decisions/008-undo-redo.md)
- **Save** and **Load** a `.modl.json` file, and **Export trace** for the session's command log

### Producing a document from another tool

There is a command line for building documents without the board, meant for an agent generating a diagram as part of some other job:

```bash
npm run build                                     # once, so render has an app to drive
npm run modl -- check  domain.modl.json           # does the layout read?
npm run modl -- layout domain.modl.json           # place anything with no position
npm run modl -- render domain.modl.json -o d.png  # draw it as the app would
```

`check` reports overlapping elements, members outside their container, stranded elements, and missing positions, and exits non-zero when it finds any. It also prints the loader's warnings, such as a document of 30 or more elements with no tags at all, without failing. `render` drives the real app, so the picture is what the whiteboard draws. See [docs/agents.md](docs/agents.md).

### Driving the running app

Every build exposes the command bus on `window.__modl`:

```js
window.__modl.dispatchAll([
  { type: 'create-entity', id: crypto.randomUUID(), entityType: 'component',
    title: 'Checkout UI', position: { x: 0, y: 0 } },
]);
window.__modl.getDocument();   // the structure
window.__modl.getTrace();      // every command, applied or rejected
window.__modl.replay(trace);   // fold a trace back into state
window.__modl.undo();          // step the session back one command
window.__modl.redo();          // and forward again
```

For a quick visual check with the dev server running:

```bash
node packages/app/e2e/screenshot.mjs /tmp/board.png "team=payments"
```

## Status

Runnable: model, commands, trace and replay, undo and redo, all three paradigms, groups with collapse and expand, filtering, colours and styles, hiding, selection highlight, pan-to-relation, the canvas, the inspector, and save/load. 300 unit tests and 170 browser tests.

See [the vision](docs/vision.md) for what remains.

Every pull request builds a preview to `https://xpcoffee.github.io/modl/pr-<number>/` and links it from a comment.
