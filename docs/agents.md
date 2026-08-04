# Producing a document from another tool

For an agent or script that wants a diagram as part of some other job: reading a codebase, working through an investigation, explaining a change. The whiteboard is one way to read a document, not the only way to make one.

The loop is: write structure, ask whether it reads, look at it.

```bash
npm run build                          # once, so `render` has an app to drive
npm run modl -- check   domain.modl.json   # alias: validate
npm run modl -- layout  domain.modl.json
npm run modl -- render  domain.modl.json -o domain.png
npm run modl -- schema  -o modl.schema.json
```

## Write structure

Emit the model and leave `layout` out. [The model reference](domain-model.md) is the whole format; the short version is a flat map of elements, relationships as ids, and no nesting.

```json
{
  "formatVersion": 5,
  "id": "0a1b…",
  "title": "Checkout",
  "model": {
    "elements": {
      "11111111-1111-4111-8111-111111111111": {
        "id": "11111111-1111-4111-8111-111111111111",
        "kind": "entity", "type": "component", "title": "Checkout UI",
        "description": "", "tags": { "team": ["web"] }, "sources": [], "groupId": null
      }
    }
  }
}
```

Ids are opaque strings. Mint UUID v5 from a namespace and your own key when generating, so re-running against an unchanged source gives the same ids and the document diffs cleanly. Readable ids like `checkout-ui` are legal too, which is what makes a document writable by hand.

A tag key holds a list, so an element can belong to several flows at once. `sources` records where each claim came from, which is what makes a generated document auditable:

```json
"tags": { "flow": ["checkout", "refund"] },
"sources": [{ "ref": "src/checkout.ts:42" }]
```

`modl schema` emits the format as JSON Schema, so a producer in another language can validate before writing rather than after loading.

Four entity types: `component`, `state`, `step`, and `artifact` for the records, files and messages that move between them. An artifact belongs to no paradigm, so a connection reaching one is never contradicted.

`from` and `to` are lists meaning *independently*: `from: [A, B]` to `to: [C]` is shorthand for `A -> C` and `B -> C`. When several sources genuinely act together, model the junction as a `fork` and connect through it.

A connection carries `direction`: `forward` from `from` to `to`, `both` for a two-way interaction, `none` for an association with no direction. It defaults to `forward`, so a generated document reads correctly without setting it.

## Ask whether it reads

`modl check` answers the question a producer cannot answer for itself. It exits non-zero when it finds something.

```
3 entities, 2 connections
bounds 660 x 72
layout reads cleanly
```

It reports overlapping entities, a member drawn outside the container that claims it, an entity stranded far from everything else, a connection whose ends sit in the same place, and entities with no position at all. Structural problems (a dangling endpoint, a group cycle) come from the loader before any of this runs.

`inspectLayout` is exported from `@modl/core` if you would rather call it directly. It is pure and needs no browser.

## Fill in positions

Positions are optional. The loader places anything without one, putting members inside the container that holds them, so a producer emitting structure alone still gets a legible board.

`modl layout` does the same and writes the result back to the file, so the positions are in the document rather than recomputed on every load. It leaves anything already placed alone, so it is safe over a document a human has arranged.

`autoLayout` is exported from `@modl/core` for the same job in process.

## Look at it

`modl render` loads the document into the real app and photographs the board, so the picture is what the whiteboard draws rather than a second drawing that can drift from it. About two seconds, and it needs `npm run build` to have run.

```bash
npm run modl -- render domain.modl.json -o domain.png --width 2000 --height 1200
```

## Driving the running app instead

With `npm run dev` up, every build exposes the command bus:

```js
window.__modl.dispatchAll([
  { type: 'create-entity', id: crypto.randomUUID(), entityType: 'component',
    title: 'Checkout UI', position: { x: 0, y: 0 } },
]);
window.__modl.getDocument();
window.__modl.getTrace();
window.__modl.replay(trace);
```

`merge-document` upserts by id, so a producer working in rounds can regenerate one subsystem without touching the rest. With stable ids the trace then shows exactly what that round changed.

An unrecognised command type is rejected like any other failure, so a batch keeps going rather than crashing partway.

Commands carry explicit ids, so a trace replays without a random source. Rejections come back as `{ok: false, error: {code, message}}` rather than throwing, so a caller can assert on the code.
