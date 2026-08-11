import { useSyncExternalStore } from 'react';

/**
 * Which press means which action.
 *
 * Like motion, bindings belong to the reader rather than the board: they say
 * nothing about the domain being drawn, they follow the person across every
 * document they open, and they never reach the document or the trace. Each
 * action holds a list of combos — rebinding replaces the list with the one
 * combo the reader pressed, and the defaults may hold more than one (redo
 * answers both ctrl+y and ctrl+shift+z). See
 * docs/decisions/016-customizable-keybindings.md.
 */

export type ActionId =
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'copy'
  | 'paste'
  | 'search'
  | 'delete'
  | 'box-select'
  | 'duplicate'
  | 'pan';

/** `ctrl` stands for ctrl-or-cmd, the reading every handler on the board uses. */
export interface KeyCombo {
  kind: 'key';
  /** `event.key`, lowercased for single characters so shift cannot change it. */
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface MouseCombo {
  kind: 'mouse';
  button: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type Combo = KeyCombo | MouseCombo;

export interface ActionSpec {
  id: ActionId;
  label: string;
  /**
   * What a capture accepts. 'modifier+button' keeps a modifier on the combo:
   * a bare left button would swallow the plain drag that moves elements.
   * 'button' drops modifiers entirely, because React Flow pans by button
   * alone.
   */
  capture: 'key' | 'modifier+button' | 'button';
  /** Drags read as "Shift+Left drag"; presses as "Ctrl+Z". */
  gesture: 'press' | 'drag';
  defaults: Combo[];
}

function key(k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyCombo {
  return {
    kind: 'key',
    key: k,
    ctrl: mods.ctrl ?? false,
    shift: mods.shift ?? false,
    alt: mods.alt ?? false,
  };
}

function mouse(
  button: number,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): MouseCombo {
  return {
    kind: 'mouse',
    button,
    ctrl: mods.ctrl ?? false,
    shift: mods.shift ?? false,
    alt: mods.alt ?? false,
  };
}

export const ACTIONS: ActionSpec[] = [
  { id: 'undo', label: 'Undo', capture: 'key', gesture: 'press', defaults: [key('z', { ctrl: true })] },
  {
    id: 'redo',
    label: 'Redo',
    capture: 'key',
    gesture: 'press',
    defaults: [key('y', { ctrl: true }), key('z', { ctrl: true, shift: true })],
  },
  { id: 'select-all', label: 'Select all', capture: 'key', gesture: 'press', defaults: [key('a', { ctrl: true })] },
  { id: 'copy', label: 'Copy', capture: 'key', gesture: 'press', defaults: [key('c', { ctrl: true })] },
  { id: 'paste', label: 'Paste', capture: 'key', gesture: 'press', defaults: [key('v', { ctrl: true })] },
  { id: 'search', label: 'Search', capture: 'key', gesture: 'press', defaults: [key('f', { ctrl: true })] },
  { id: 'delete', label: 'Delete', capture: 'key', gesture: 'press', defaults: [key('Delete'), key('Backspace')] },
  {
    id: 'box-select',
    label: 'Box select',
    capture: 'modifier+button',
    gesture: 'drag',
    defaults: [mouse(0, { shift: true })],
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    capture: 'modifier+button',
    gesture: 'drag',
    defaults: [mouse(0, { alt: true })],
  },
  { id: 'pan', label: 'Pan the board', capture: 'button', gesture: 'drag', defaults: [mouse(1)] },
];

const STORAGE_KEY = 'modl.keybindings';

let overrides: Partial<Record<ActionId, Combo[]>> = {};
let version = 0;
const listeners = new Set<() => void>();

export function specOf(id: ActionId): ActionSpec {
  const spec = ACTIONS.find((action) => action.id === id);
  if (!spec) throw new Error(`unknown action: ${id}`);
  return spec;
}

export function combosFor(id: ActionId): Combo[] {
  return overrides[id] ?? specOf(id).defaults;
}

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

interface MouseLike {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function normalizeKey(k: string): string {
  return k.length === 1 ? k.toLowerCase() : k;
}

export function matchesKey(id: ActionId, event: KeyLike): boolean {
  const pressed = normalizeKey(event.key);
  const ctrl = event.ctrlKey || event.metaKey;
  return combosFor(id).some(
    (combo) =>
      combo.kind === 'key' &&
      combo.key === pressed &&
      combo.ctrl === ctrl &&
      combo.shift === event.shiftKey &&
      combo.alt === event.altKey,
  );
}

export function matchesMouse(id: ActionId, event: MouseLike): boolean {
  const ctrl = event.ctrlKey || event.metaKey;
  return combosFor(id).some(
    (combo) =>
      combo.kind === 'mouse' &&
      combo.button === event.button &&
      combo.ctrl === ctrl &&
      combo.shift === event.shiftKey &&
      combo.alt === event.altKey,
  );
}

/**
 * A box-select press, read ctrl-tolerantly: ctrl on top of the bound combo
 * subtracts the boxed elements from the selection (decision 012). A combo
 * that itself holds ctrl always adds — no key is left over to say subtract.
 */
export function boxSelectGesture(event: MouseLike): { subtract: boolean } | null {
  const ctrl = event.ctrlKey || event.metaKey;
  for (const combo of combosFor('box-select')) {
    if (combo.kind !== 'mouse' || combo.button !== event.button) continue;
    if (combo.shift !== event.shiftKey || combo.alt !== event.altKey) continue;
    if (combo.ctrl && !ctrl) continue;
    return { subtract: !combo.ctrl && ctrl };
  }
  return null;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);

/** The combo a keydown describes, or null for a modifier alone (keep waiting). */
export function comboFromKeyEvent(event: KeyLike): KeyCombo | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  return {
    kind: 'key',
    key: normalizeKey(event.key),
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

/**
 * The combo a press describes, or null when the action needs a modifier and
 * none is held — that press reads as a click somewhere else.
 */
export function comboFromMouseEvent(id: ActionId, event: MouseLike): MouseCombo | null {
  const spec = specOf(id);
  const ctrl = event.ctrlKey || event.metaKey;
  if (spec.capture === 'button') return mouse(event.button);
  if (!ctrl && !event.shiftKey && !event.altKey) return null;
  return { kind: 'mouse', button: event.button, ctrl, shift: event.shiftKey, alt: event.altKey };
}

const BUTTON_LABELS: Record<number, string> = { 0: 'Left', 1: 'Middle', 2: 'Right' };

function modifierParts(combo: Combo): string[] {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.shift) parts.push('Shift');
  if (combo.alt) parts.push('Alt');
  return parts;
}

function keyLabel(k: string): string {
  if (k === ' ') return 'Space';
  return k.length === 1 ? k.toUpperCase() : k;
}

export function describeCombo(combo: Combo, gesture: 'press' | 'drag'): string {
  if (combo.kind === 'key') return [...modifierParts(combo), keyLabel(combo.key)].join('+');
  const button = BUTTON_LABELS[combo.button] ?? `Button ${combo.button}`;
  const suffix = gesture === 'drag' ? ' drag' : ' click';
  return [...modifierParts(combo), button].join('+') + suffix;
}

export function describeAction(id: ActionId): string {
  const spec = specOf(id);
  return combosFor(id)
    .map((combo) => describeCombo(combo, spec.gesture))
    .join(' or ');
}

/**
 * The delete binding in React Flow's combo strings: each modifier by its
 * `event.key` name, ctrl written both ways so cmd answers on a mac.
 */
export function deleteKeyCodes(): string[] {
  const codes: string[] = [];
  for (const combo of combosFor('delete')) {
    if (combo.kind !== 'key') continue;
    // React Flow matches event.key, and shift changes what a character key
    // reports: the stored lowercase letter must go back to upper.
    const keyPart = combo.shift && combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
    const rest = [...(combo.shift ? ['Shift'] : []), ...(combo.alt ? ['Alt'] : []), keyPart];
    if (!combo.ctrl) {
      codes.push(rest.join('+'));
      continue;
    }
    codes.push(['Control', ...rest].join('+'));
    codes.push(['Meta', ...rest].join('+'));
  }
  return codes;
}

/**
 * The combinations that keep React Flow's selection box open. React Flow
 * matches them exactly, so ctrl and meta variants join each bound combo:
 * without them, pressing ctrl to subtract mid-drag would close the box.
 */
export function selectionKeyCodes(): string[] {
  const codes = new Set<string>();
  for (const combo of combosFor('box-select')) {
    if (combo.kind !== 'mouse') continue;
    const base = [...(combo.shift ? ['Shift'] : []), ...(combo.alt ? ['Alt'] : [])];
    if (combo.ctrl) {
      codes.add(['Control', ...base].join('+'));
      codes.add(['Meta', ...base].join('+'));
    } else if (base.length > 0) {
      codes.add(base.join('+'));
      codes.add(['Control', ...base].join('+'));
      codes.add(['Meta', ...base].join('+'));
    }
  }
  return [...codes];
}

/**
 * The buttons that pan. The left button always pans the empty pane — that is
 * the board's base gesture — and the bound button joins it so pan also
 * answers over elements.
 */
export function panButtons(): number[] {
  const buttons = new Set<number>([0]);
  for (const combo of combosFor('pan')) {
    if (combo.kind === 'mouse') buttons.add(combo.button);
  }
  return [...buttons];
}

export function subscribeKeybindings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/** Re-renders the caller whenever any binding changes. */
export function useKeybindingsVersion(): number {
  return useSyncExternalStore(subscribeKeybindings, getVersion, getVersion);
}

function persist(): void {
  try {
    if (Object.keys(overrides).length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Private browsing and blocked storage: the bindings still hold for this
    // session, which is the part the reader asked for.
  }
}

function announce(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function setBinding(id: ActionId, combo: Combo): void {
  overrides = { ...overrides, [id]: [combo] };
  persist();
  announce();
}

export function resetKeybindings(): void {
  overrides = {};
  persist();
  announce();
}

function isCombo(value: unknown, action: ActionSpec): value is Combo {
  if (typeof value !== 'object' || value === null) return false;
  const combo = value as Record<string, unknown>;
  if (
    typeof combo['ctrl'] !== 'boolean' ||
    typeof combo['shift'] !== 'boolean' ||
    typeof combo['alt'] !== 'boolean'
  ) {
    return false;
  }
  if (action.capture === 'key') return combo['kind'] === 'key' && typeof combo['key'] === 'string';
  if (combo['kind'] !== 'mouse' || typeof combo['button'] !== 'number') return false;
  // A modifier-less combo on a modifier+button action (a hand-edited store)
  // would turn every plain press into the gesture.
  if (action.capture === 'modifier+button' && !combo['ctrl'] && !combo['shift'] && !combo['alt']) {
    return false;
  }
  return true;
}

/** Keeps what still parses and still fits its action; drops the rest. */
function validate(parsed: unknown): Partial<Record<ActionId, Combo[]>> {
  const result: Partial<Record<ActionId, Combo[]>> = {};
  if (typeof parsed !== 'object' || parsed === null) return result;
  for (const action of ACTIONS) {
    const value = (parsed as Record<string, unknown>)[action.id];
    if (!Array.isArray(value)) continue;
    const combos = value.filter((combo): combo is Combo => isCombo(combo, action));
    if (combos.length > 0) result[action.id] = combos;
  }
  return result;
}

/** Reads the stored bindings before the first render, so the first press counts. */
export function installKeybindings(): void {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === null) return;
  try {
    overrides = validate(JSON.parse(stored));
  } catch {
    overrides = {};
  }
}
