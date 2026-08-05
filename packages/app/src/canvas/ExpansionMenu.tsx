import { ViewportPortal, type Node } from '@xyflow/react';
import {
  collapseAllTargets,
  collapseNextLevelTargets,
  expandAllTargets,
  expandNextLevelTargets,
  isGroup,
  membersOf,
  type Command,
  type Element,
  type Id,
} from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { RollerMenu, type RollerOption } from './RollerMenu.js';
import type { BoardNodeData } from './derive.js';

/** One pick of the menu: the groups to touch and the state to put them in. */
interface Roll {
  expanded: boolean;
  targets: Id[];
}

function rollOption(
  id: string,
  label: string,
  expanded: boolean,
  targets: Id[],
): RollerOption<Roll> | null {
  if (targets.length === 0) return null;
  return { id, label, value: { expanded, targets }, testId: `expansion-${id}` };
}

/**
 * The menu's options, default first: the roller opens on its first option,
 * and issue #20 makes the default the plain action for the anchor's current
 * state. An option whose target set is empty is dropped rather than disabled,
 * so every slot on the roller changes the board.
 */
function optionsFor(
  elements: Record<Id, Element>,
  expanded: ReadonlySet<Id>,
  selection: readonly Id[],
): RollerOption<Roll>[] {
  if (selection.length === 1) {
    const id = selection[0];
    if (id === undefined || !isGroup(elements, id)) return [];

    if (!expanded.has(id)) {
      const all = expandAllTargets(elements, expanded, [id]);
      return [
        rollOption('expand', 'expand', true, [id]),
        // With no collapsed group inside, expand-all repeats plain expand.
        all.length > 1 ? rollOption('expand-all', 'expand all', true, all) : null,
      ].filter((option) => option !== null);
    }

    const members = membersOf(elements, id).map((member) => member.id);
    return [
      rollOption('collapse', 'collapse', false, [id]),
      rollOption(
        'expand-next',
        'expand next level',
        true,
        expandNextLevelTargets(elements, expanded, members),
      ),
      rollOption(
        'collapse-next',
        'collapse next level',
        false,
        collapseNextLevelTargets(elements, expanded, members),
      ),
      rollOption('expand-all', 'expand all', true, expandAllTargets(elements, expanded, members)),
      rollOption(
        'collapse-all',
        'collapse all',
        false,
        collapseAllTargets(elements, expanded, members),
      ),
    ].filter((option) => option !== null);
  }

  // A multi-selection reads as one open group holding the selected items, so
  // the item-level operations take the selection as their scope and "collapse
  // this item" has no element to point at.
  return [
    rollOption(
      'expand-next',
      'expand next level',
      true,
      expandNextLevelTargets(elements, expanded, selection),
    ),
    rollOption(
      'collapse-next',
      'collapse next level',
      false,
      collapseNextLevelTargets(elements, expanded, selection),
    ),
    rollOption('expand-all', 'expand all', true, expandAllTargets(elements, expanded, selection)),
    rollOption(
      'collapse-all',
      'collapse all',
      false,
      collapseAllTargets(elements, expanded, selection),
    ),
  ].filter((option) => option !== null);
}

/**
 * Expansion tooling (issue #20): a roller menu beside the selected group, or
 * the multi-selection, offering the batch expand and collapse operations.
 * It sits at the selection's top-left corner, beside where the per-group
 * expand and collapse buttons live, leaving the top-right corner to
 * pan-to-relation so both rollers stand apart on one selected group.
 */
export function ExpansionMenu({ nodes }: { nodes: Node<BoardNodeData>[] }) {
  const state = useAppState();
  const elements = state.document.model.elements;
  const expanded = new Set(state.expanded);

  const options = optionsFor(elements, expanded, state.selection);
  if (options.length === 0) return null;

  const chosen = new Set(state.selection);
  const corners = nodes
    .filter((node) => chosen.has(node.id))
    .map((node) => {
      const origin = node.data.parentOrigin ?? { x: 0, y: 0 };
      return { x: node.position.x + origin.x, y: node.position.y + origin.y };
    });
  if (corners.length === 0) return null;

  const left = Math.min(...corners.map((corner) => corner.x));
  const top = Math.min(...corners.map((corner) => corner.y));

  const roll = (value: Roll): void => {
    // One set-expanded per group rather than a batched command, so the trace
    // replays step by step and shows the sweep's order. The toolbar batches
    // its dispatches the same way.
    store.dispatchAll(
      value.targets.map(
        (id): Command => ({ type: 'set-expanded', id, expanded: value.expanded }),
      ),
    );
  };

  return (
    <ViewportPortal>
      <div
        className="expansion-menu"
        // The trailing -100% puts the pill's right edge at the offset point,
        // clear of the selection's left edge.
        style={{ transform: `translate(${left - 10}px, ${top}px) translateX(-100%)` }}
      >
        <RollerMenu
          entranceLabel="±"
          entranceAriaLabel="Expand or collapse the selection"
          options={options}
          onSelect={roll}
          testId="expansion-menu"
        />
      </div>
    </ViewportPortal>
  );
}
