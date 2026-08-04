# Domain model

The reference for the structure modl produces. An engineer or agent can read this file alone and generate a valid document from another source (an existing diagram, a codebase scan, a spreadsheet) without touching the whiteboard.

Everything here is stable across iterations. Where iteration 1 only implements part of it, the file says so.

## Principles

1. **The model is flat.** All elements live in one map keyed by id. Relationships are fields holding ids. Nothing nests.
2. **Semantics and pixels are separate.** `model` holds meaning. `layout` holds positions. A consumer that only wants the structure reads `model` and ignores the rest.
3. **Ids are authoritative, names are derived.** A readable name is a pure function of the id, computed on read.
4. **Invalid structure is representable.** A document that breaks a paradigm rule still loads, and still round-trips. Rule breaches produce warnings.

## Types

```ts
type Id = string;                    // opaque: a UUID, or a readable slug

type EntityType     = 'state' | 'component' | 'step';
type ConnectionType = 'transition' | 'relation' | 'interaction';
type ForkShape      = 'circle' | 'diamond';

interface ElementBase {
  id: Id;
  title: string;                     // human label, may be empty
  description: string;               // long form, may be empty
  tags: Record<string, string[]>;    // filterable labels, several per key
  sources: SourceRef[];              // where the claim came from
  groupId: Id | null;                // id of the entity this collapses into
}

interface Entity extends ElementBase {
  kind: 'entity';
  type: EntityType;
}

interface Connection extends ElementBase {
  kind: 'connection';
  type: ConnectionType;
  from: Id[];                        // many-to-many
  to: Id[];
  direction: Direction;              // 'forward' | 'both' | 'none'
}

interface Fork extends ElementBase {
  kind: 'fork';
  shape: ForkShape;
}

type Element = Entity | Connection | Fork;
```

`kind` discriminates the union. `type` sub-classifies within a kind and carries the paradigm.

### Ids

An id is an opaque string of 1 to 128 characters:

```
/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
```

The app mints UUID v4. A producer generating from a source should mint UUID v5 from its own keys and a fixed namespace, so re-running against an unchanged source gives the same ids and the document diffs cleanly.

A document written by hand should use readable ids like `checkout-ui`. Requiring UUIDs everywhere meant only a program could author a document, since every `from` and `to` was an unreadable string.

### Tags

A key holds a list of values, because an element often belongs to more than one flow, team, or subdomain at once. A filter term matches when any value matches.

### Sources

`sources` records where a claim came from: a file and line, a ticket, a document link. Empty for anything drawn by hand. A generated document is only worth trusting if its claims can be traced, and prose in `description` cannot be queried.

```json
"sources": [{ "ref": "src/checkout.ts:42", "note": "calls authorise" }]
```

### Versions

`formatVersion` is 3. Older documents still load, and saving writes the current version, so a file upgrades the first time it is written.

| Change | What the reader does |
|---|---|
| 1 → 2 | Single tag values become lists, and elements gain empty `sources` |
| 2 → 3 | Connections gain `direction`, and arrowheads leave `layout`. A line drawn with a head at each end becomes `both`; anything else becomes `forward`, since `from` and `to` already said which way it ran |

## Paradigms

Three modelling paradigms coexist in one document. The `type` field records which one an element belongs to.

| Paradigm | Entity type | Connection type | Meaning of a connection |
|---|---|---|---|
| State machine | `state` | `transition` | An action moving between states |
| Wizard | `step` | `relation` | An input or output flowing between steps |
| Components | `component` | `interaction` | An interaction between components |

A fourth entity type, `artifact`, belongs to no paradigm. A record, file or message is a noun that any of the three can point at, so a connection reaching one keeps whatever type it already had and never produces a warning. Drawing into an artifact falls back to the paradigm of the element the line came from.

A connection between entities of different paradigms is legal. The connection type follows the target paradigm: a `state` to `step` connection is a `relation`, and a `state` to `component` connection is a `transition`. When a user draws from a typed entity, the editor preselects the matching connection type. The user can override it, and overriding produces a warning rather than a rejection.

## Document format

One JSON file. `.modl.json` by convention.

```json
{
  "formatVersion": 1,
  "id": "3f2a…",
  "title": "Checkout domain",
  "model": {
    "elements": {
      "3f2a…": {
        "id": "3f2a…",
        "kind": "entity",
        "type": "component",
        "title": "Payment gateway",
        "description": "",
        "tags": { "team": "payments", "tier": "1" },
        "groupId": null
      }
    }
  },
  "layout": {
    "3f2a…": { "x": 120, "y": 80, "width": 180, "height": 72 }
  },
  "view": { "pan": { "x": 0, "y": 0 }, "zoom": 1 }
}
```

- `model.elements` is the structure. A consumer needs nothing else.
- `layout` is keyed by element id. Entities and forks carry `{x, y, width, height}`; an entity may also carry an optional `expanded: {width, height}`. The first is the size drawn when collapsed, the second the container box drawn when expanded, which also decides membership. They are independent, so opening a group to work inside it does not swell the node it shrinks back to. Connections carry `{waypoints: {x,y}[]}` for hand-placed bends, plus optional `sourceSide` and `targetSide` naming the points a reader dragged the line onto. Which side of a box a line touches says nothing about the domain, so a producer omits them and the renderer picks the nearest sides. An id missing from `layout` gets a computed default, so a generated document can omit `layout` entirely. The default walks entities in sorted id order and places them on a 4-column grid spaced 240 by 140, at 180 by 72 each. Connections get no default, and the renderer routes them between their endpoints.
- `view` is the camera. Missing means origin at zoom 1.
- `formatVersion` increments on any breaking change. A loader reading a higher version than it knows refuses the file and says which version it expected.

Ordering: the serializer writes `elements` keys sorted, and object keys in declaration order. Two documents with the same content produce byte-identical files, so `git diff` stays readable and golden-file tests work.

## Readable names

`readableName(id)` maps a UUID to an `adjective-noun` pair for humans reading traces and logs. It is a pure function, and it is never stored in the document.

```
hash = FNV-1a 32-bit over the UTF-8 bytes of the id string
       hash = 2166136261
       for each byte b: hash = ((hash XOR b) * 16777619) mod 2^32

adjective = ADJECTIVES[hash & 0xff]
noun      = NOUNS[(hash >>> 8) & 0xff]
name      = adjective + "-" + noun
```

Both word lists hold exactly 256 entries and live in `packages/core/src/naming/words.ts`, generated by `scripts/generate-words.py`. Treat them as frozen: changing a list changes the readable name of every element in every existing trace. Any language can reimplement the transform in a few lines and get the same answer.

65,536 combinations means names collide once a document passes a few hundred elements. Names are a reading aid. Ids remain the identity.

## Validation

Two tiers, and they behave differently.

**Errors** make a document invalid. The loader rejects the file.

| Code | Fires when |
|---|---|
| `schema-invalid` | An element fails its schema: missing field, wrong type, unknown `kind`, malformed id |
| `version-unsupported` | `formatVersion` is missing or from a newer release |
| `id-key-mismatch` | An element's map key differs from its `id` |
| `unknown-reference` | A `from`, `to`, or `groupId` names an id absent from `elements` |
| `not-a-group` | `groupId` names a connection or a fork, and a group is an entity |
| `unknown-command` | A dispatched command has a type the reducer does not know |
| `group-cycle` | `groupId` chain closes a loop, including an element naming itself |

Version checking short-circuits: an unreadable `formatVersion` returns on its own, because errors found by a parser that does not know the format mislead more than they help.

**Warnings** are advisory. The document loads and renders, and the UI marks the elements.

| Code | Fires when |
|---|---|
| `paradigm-mismatch` | A connection type differs from the paradigm its targets imply |
| `empty-endpoints` | A connection has an empty `from` or `to` |
| `orphan-entity` | An entity has no connections and holds no members. A container's connections are its members' |
| `duplicate-title` | Two elements in the same group share a non-empty title. The same role name in two different groups reads naturally |
| `fork-one-sided` | A fork has connections on only one side |

A connection pointing at targets from several paradigms produces no `paradigm-mismatch`, because a cross-paradigm connection is legal and only one of its endpoints can be satisfied.

Validation returns `{ errors: Issue[]; warnings: Issue[] }`, where each `Issue` carries a code, an element id, and a message. Nothing throws.

## Forks

A fork is a junction where connections fan in or fan out. It exists so a decision or a join is a thing in the model rather than an arrangement of arrows a reader has to infer.

The interface calls it a **connection node**, and a diamond-shaped one a **decision**. "Connection point" was the first choice and read as the handles on the sides of a component, which is a different thing entirely.

The model keeps `kind: 'fork'`: the word is what a reader sees, and renaming the format would break every document to change a label.

```ts
interface Fork extends ElementBase {
  kind: 'fork';
  shape: 'circle' | 'diamond';   // the author's choice, no meaning attached
}
```

The title carries the question or the condition; the connections leaving it carry the answers. A fork is a legal endpoint for a connection at either end, it can sit inside a group, and it can be tagged and filtered like anything else. It cannot hold members: a junction is a point, not a container.

`shape` is presentation, kept on the element rather than in `layout` because it is a choice about what the fork *is* to the author, and it should travel with the fork when a document is read by something that ignores layout.

A fork with connections on only one side draws a `fork-one-sided` warning: a junction that only receives, or only sends, reads as a mistake.

### Direction

`forward` runs from `from` to `to`, `both` is a two-way interaction, and `none` an association with no direction. It defaults to `forward`.

There is no `backward`. A reader who turns on the arrowhead at the `from` end has turned the connection round, so `set-arrowheads` swaps the endpoints and keeps reading forward, carrying the bends and contact points with it. One way of saying a thing beats two.

Direction is part of the model rather than the drawing. Arrowheads were presentation at first, off by default, on the argument that `from` and `to` already carried the direction. That held while a line always left the right side of a box and entered the left, so the geometry said which way it ran. Once a line attaches to whichever side is nearest, an arrowhead is the only thing left telling a reader the direction, and something a reader depends on belongs in the model.

## Many-to-many connections

`from` and `to` are lists, and they mean **independently**. A connection with `from: [A, B]` and `to: [C]` is shorthand for the cross-product: `A -> C` and `B -> C`, two separate statements that happen to share a description.

Joint semantics, where A and B *together* produce something that reaches C, are what a fork is for:

```
A ──┐
     ├──(fork)──> C
B ──┘
```

The alternative was a flag on the connection saying which reading applies. That puts two ways to express one idea into the model, and it does not compose when the sources are joint but the targets are not. One meaning per shape is easier to read and easier to generate.

## Groups

A group is an entity that other elements name in their `groupId`. Any entity becomes one as soon as something points at it, so there is no separate group type and no flag to keep in step.

Collapsing a group hides its members and leaves the group on the board. Expanding it draws the members inside a container sized by the entity's own `layout` rectangle, which the reader resizes. That is what zooming means here: one document, read at the level of detail the reader wants.

Membership follows the box. Dropping an element inside a container joins it; dragging one past the edge takes it out. Sizing the container from its members instead would mean a member dragged away carries the box with it and can never leave.

Two rules follow from this and both live in `packages/core/src/query/groups.ts`:

- An element is drawn only when every group above it is expanded. A member of a collapsed group is not on the board at all.
- A connection re-points at the outermost collapsed group hiding its endpoint. When both ends collapse into the same group, the connection is not drawn, because it says nothing at that zoom level.

Expansion is session state rather than document state. Which groups a reader has open is their view of the domain, and two people reading the same file should not fight over it.

`groupId` accepts nesting to any depth. A chain that closes a loop is a `group-cycle` error, and the reducer rejects the command that would create one, so a loop cannot be reached through the UI.

Deleting a group lifts its members to whatever contained the group. Nothing is left pointing at an id that no longer exists.

## Coverage

Implemented: `Entity` across all four types, `Connection`, `Fork`, groups with collapse and expand, the full document format, readable names, validation.
