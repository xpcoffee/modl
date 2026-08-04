# Vision

The full picture. [Iteration 1](specs/001-bootstrap.md) builds a slice of this. Everything here that iteration 1 skips stays on this page so it is not lost.

## Three coexisting paradigms

A document can hold state machines, wizards, and component diagrams at once, nested in one another.

- **State machine**: states are rectangles, arrows are actions that move between them.
- **Wizard**: steps group actions into rectangles, arrows carry inputs and outputs.
- **Components**: components are rectangles, arrows are interactions.

Crossing between paradigms follows the target: a state-to-wizard arrow is the wizard's input or output, and a state-to-component arrow is the state machine's action. When a user draws from a typed element the editor preselects the matching connection type. A user who overrides it gets a warning and keeps their drawing. Rules guide, and the user decides.

## Zoom through groups

Zooming in and out works by grouping. A group is a set of elements that collapses into a single element, and expanding it reflows the surrounding diagram to make room. Connections into an expanded group point at its bounding box when they connect to no element inside it.

This is the differentiating idea, and it is the reason `groupId` sits on every element from the first version of the schema.

## Forks

Built. A junction where connections fan in or out, drawn as a circle or a diamond by the author's choice, carrying the question or condition in its title. See [the model reference](domain-model.md).

## Board behaviour beyond iteration 1

- Colouring of background, text, and stroke.
- Expanding an existing element into a bounding box to start a new group.
- Selecting elements and collapsing them into a new group.
- Descriptions revealed by an expand action on hover.
- A zoom-in action on hover for groups.

## Why this exists

Whiteboards handle ad-hoc brainstorming well and produce drawings that are hard to reuse. Teams redraw a system rather than extend last quarter's diagram, because the drawing holds no structure worth extending. Existing tools also lack tagging and filtering, so a diagram cannot be focused on one aspect, and they lack levels of abstraction, so one drawing serves one audience.

modl records structure while the user draws. The drawing is one view of that structure. Other systems read the same structure as a pseudo-source of truth.
