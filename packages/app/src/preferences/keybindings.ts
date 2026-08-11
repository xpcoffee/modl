import { useSyncExternalStore } from 'react';

/**
 * Which press means which action.
 *
 * Like motion, bindings belong to the reader rather than the board: they say
 * nothing about the domain being drawn, they follow the person across every
 * document they open, and they never reach the document or the trace. Each
 * action holds up to two combos, edited one slot at a time, and a drag
 * action can instead run begin+end: one press starts the gesture, a second
 * settles it, and the cancel binding abandons it. See
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
  | 'cancel'
  | 'box-select'
  | 'duplicate'
  | 'pan';

/** How a drag action runs: held through a drag, or between two presses. */
export type GestureMode = 'drag' | 'begin-end';

/** How many combos an action can hold; the panel shows this many slots. */
export const MAX_COMBOS = 2;

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
  /** What the action binds in drag mode; begin+end widens mouse to both. */
  kind: 'key' | 'mouse';
  /** Drags read as "Shift+Left drag"; presses as "Ctrl+Z". */
  gesture: 'press' | 'drag';
  /** Whether the action can run begin+end instead of as a held drag. */
  beginEnd?: boolean;
  /**
   * Whether a drag-mode combo must keep a modifier. A bare left button on
   * duplicate would swallow the plain drag that moves elements.
   */
  needsModifierInDrag?: boolean;
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
  { id: 'undo', label: 'Undo', kind: 'key', gesture: 'press', defaults: [key('z', { ctrl: true })] },
  {
    id: 'redo',
    label: 'Redo',
    kind: 'key',
    gesture: 'press',
    defaults: [key('y', { ctrl: true }), key('z', { ctrl: true, shift: true })],
  },
  { id: 'select-all', label: 'Select all', kind: 'key', gesture: 'press', defaults: [key('a', { ctrl: true })] },
  { id: 'copy', label: 'Copy', kind: 'key', gesture: 'press', defaults: [key('c', { ctrl: true })] },
  { id: 'paste', label: 'Paste', kind: 'key', gesture: 'press', defaults: [key('v', { ctrl: true })] },
  { id: 'search', label: 'Search', kind: 'key', gesture: 'press', defaults: [key('f', { ctrl: true })] },
  { id: 'delete', label: 'Delete', kind: 'key', gesture: 'press', defaults: [key('Delete'), key('Backspace')] },
  { id: 'cancel', label: 'Cancel', kind: 'key', gesture: 'press', defaults: [key('Escape')] },
  {
    id: 'box-select',
    label: 'Box select',
    kind: 'mouse',
    gesture: 'drag',
    beginEnd: true,
    defaults: [mouse(0, { shift: true })],
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    kind: 'mouse',
    gesture: 'drag',
    beginEnd: true,
    needsModifierInDrag: true,
    defaults: [mouse(0, { alt: true })],
  },
  {
    id: 'pan',
    label: 'Pan the board',
    kind: 'mouse',
    gesture: 'drag',
    defaults: [mouse(0), mouse(1)],
  },
];

const STORAGE_KEY = 'modl.keybindings';

let combosOverride: Partial<Record<ActionId, Combo[]>> = {};
let modes: Partial<Record<ActionId, GestureMode>> = {};
let version = 0;
const listeners = new Set<() => void>();

export function specOf(id: ActionId): ActionSpec {
  const spec = ACTIONS.find((action) => action.id === id);
  if (!spec) throw new Error(`unknown action: ${id}`);
  return spec;
}

export function combosFor(id: ActionId): Combo[] {
  return combosOverride[id] ?? specOf(id).defaults;
}

export function gestureMode(id: ActionId): GestureMode {
  return modes[id] ?? 'drag';
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

function comboMatchesKey(combo: Combo, event: KeyLike): boolean {
  return (
    combo.kind === 'key' &&
    combo.key === normalizeKey(event.key) &&
    combo.ctrl === (event.ctrlKey || event.metaKey) &&
    combo.shift === event.shiftKey &&
    combo.alt === event.altKey
  );
}

function comboMatchesMouse(combo: Combo, event: MouseLike): boolean {
  return (
    combo.kind === 'mouse' &&
    combo.button === event.button &&
    combo.ctrl === (event.ctrlKey || event.metaKey) &&
    combo.shift === event.shiftKey &&
    combo.alt === event.altKey
  );
}

export function matchesKey(id: ActionId, event: KeyLike): boolean {
  return combosFor(id).some((combo) => comboMatchesKey(combo, event));
}

export function matchesMouse(id: ActionId, event: MouseLike): boolean {
  if (specOf(id).beginEnd && gestureMode(id) === 'begin-end') return false;
  return combosFor(id).some((combo) => comboMatchesMouse(combo, event));
}

/**
 * A box-select press in drag mode, read ctrl-tolerantly: ctrl on top of the
 * bound combo subtracts the boxed elements from the selection (decision 012).
 * A combo that itself holds ctrl always adds — no key is left over to say
 * subtract.
 */
export function boxSelectGesture(event: MouseLike): { subtract: boolean } | null {
  if (gestureMode('box-select') === 'begin-end') return null;
  const ctrl = event.ctrlKey || event.metaKey;
  for (const combo of combosFor('box-select')) {
    if (combo.kind !== 'mouse' || combo.button !== event.button) continue;
    if (combo.shift !== event.shiftKey || combo.alt !== event.altKey) continue;
    if (combo.ctrl && !ctrl) continue;
    return { subtract: !combo.ctrl && ctrl };
  }
  return null;
}

/** The begin+end action a key press begins or ends, or null. */
export function beginEndKeyTrigger(
  event: KeyLike,
): { id: 'box-select' | 'duplicate'; subtract: boolean } | null {
  if (gestureMode('box-select') === 'begin-end') {
    const ctrl = event.ctrlKey || event.metaKey;
    for (const combo of combosFor('box-select')) {
      if (combo.kind !== 'key' || combo.key !== normalizeKey(event.key)) continue;
      if (combo.shift !== event.shiftKey || combo.alt !== event.altKey) continue;
      if (combo.ctrl && !ctrl) continue;
      return { id: 'box-select', subtract: !combo.ctrl && ctrl };
    }
  }
  if (gestureMode('duplicate') === 'begin-end') {
    if (combosFor('duplicate').some((combo) => comboMatchesKey(combo, event))) {
      return { id: 'duplicate', subtract: false };
    }
  }
  return null;
}

/** The begin+end action a mouse press begins or ends, or null. */
export function beginEndMouseTrigger(
  event: MouseLike,
): { id: 'box-select' | 'duplicate'; subtract: boolean } | null {
  if (gestureMode('box-select') === 'begin-end') {
    const ctrl = event.ctrlKey || event.metaKey;
    for (const combo of combosFor('box-select')) {
      if (combo.kind !== 'mouse' || combo.button !== event.button) continue;
      if (combo.shift !== event.shiftKey || combo.alt !== event.altKey) continue;
      if (combo.ctrl && !ctrl) continue;
      return { id: 'box-select', subtract: !combo.ctrl && ctrl };
    }
  }
  if (gestureMode('duplicate') === 'begin-end') {
    if (combosFor('duplicate').some((combo) => comboMatchesMouse(combo, event))) {
      return { id: 'duplicate', subtract: false };
    }
  }
  return null;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);

/**
 * The combo a keydown would bind to the armed action, or null to keep
 * waiting: a modifier alone is half a combo, and a mouse action in drag mode
 * takes no keys.
 */
export function captureKeyCombo(id: ActionId, event: KeyLike): KeyCombo | null {
  const spec = specOf(id);
  const acceptsKeys = spec.kind === 'key' || (spec.beginEnd && gestureMode(id) === 'begin-end');
  if (!acceptsKeys) return null;
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
 * The combo a press would bind to the armed action, or null when the press
 * cannot bind it — a press on a keyboard-only action, or a bare left button
 * where a modifier is required. The caller reads null as a click somewhere
 * else.
 */
export function captureMouseCombo(id: ActionId, event: MouseLike): MouseCombo | null {
  const spec = specOf(id);
  if (spec.kind !== 'mouse') return null;
  // React Flow pans by button alone, so pan keeps no modifiers.
  if (id === 'pan') return mouse(event.button);
  const ctrl = event.ctrlKey || event.metaKey;
  const bare = !ctrl && !event.shiftKey && !event.altKey;
  if (spec.needsModifierInDrag && gestureMode(id) === 'drag' && bare) return null;
  return { kind: 'mouse', button: event.button, ctrl, shift: event.shiftKey, alt: event.altKey };
}

/** What the armed slot is waiting for, said in the panel. */
export function captureHint(id: ActionId): string {
  const spec = specOf(id);
  if (spec.beginEnd && gestureMode(id) === 'begin-end') return 'Press a key or button…';
  return spec.kind === 'key' ? 'Press a key…' : 'Press a button…';
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

/** A combo said the way the action currently runs: begin+end reads as presses. */
export function describeActionCombo(id: ActionId, combo: Combo): string {
  const spec = specOf(id);
  const gesture = spec.beginEnd && gestureMode(id) === 'begin-end' ? 'press' : spec.gesture;
  return describeCombo(combo, gesture);
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
 * without them, pressing ctrl to subtract mid-drag would close the box. A
 * combo with no modifiers is carried by selection-on-drag instead, and
 * begin+end mode draws its own box.
 */
export function selectionKeyCodes(): string[] {
  if (gestureMode('box-select') === 'begin-end') return [];
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
 * Whether a plain left drag on the pane opens the selection box: true when a
 * drag-mode box-select combo is the bare left button, which React Flow's key
 * codes cannot express.
 */
export function selectionOnDragEnabled(): boolean {
  if (gestureMode('box-select') === 'begin-end') return false;
  return combosFor('box-select').some(
    (combo) =>
      combo.kind === 'mouse' && combo.button === 0 && !combo.ctrl && !combo.shift && !combo.alt,
  );
}

/**
 * The buttons that pan, exactly as bound. React Flow shows the grab cursor
 * only while the left button is among them, so removing the left-drag
 * binding also returns the pane to a plain cursor.
 */
export function panButtons(): number[] {
  const buttons = new Set<number>();
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
    if (Object.keys(combosOverride).length === 0 && Object.keys(modes).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ combos: combosOverride, modes }));
    }
  } catch {
    // Private browsing and blocked storage: the bindings still hold for this
    // session, which is the part the reader asked for.
  }
}

function announce(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Fills the slot, appending when the index is past the end of the list. */
export function setCombo(id: ActionId, index: number, combo: Combo): void {
  const list = [...combosFor(id)];
  list[Math.min(index, list.length)] = combo;
  combosOverride = { ...combosOverride, [id]: list.slice(0, MAX_COMBOS) };
  persist();
  announce();
}

/** Empties the slot; an action can end up with no binding at all. */
export function removeCombo(id: ActionId, index: number): void {
  const list = combosFor(id).filter((_, at) => at !== index);
  combosOverride = { ...combosOverride, [id]: list };
  persist();
  announce();
}

export function setGestureMode(id: ActionId, mode: GestureMode): void {
  modes = { ...modes, [id]: mode };
  persist();
  announce();
}

export function resetKeybindings(): void {
  combosOverride = {};
  modes = {};
  persist();
  announce();
}

function isCombo(value: unknown, action: ActionSpec, mode: GestureMode): value is Combo {
  if (typeof value !== 'object' || value === null) return false;
  const combo = value as Record<string, unknown>;
  if (
    typeof combo['ctrl'] !== 'boolean' ||
    typeof combo['shift'] !== 'boolean' ||
    typeof combo['alt'] !== 'boolean'
  ) {
    return false;
  }
  const isKey = combo['kind'] === 'key' && typeof combo['key'] === 'string';
  const isMouse = combo['kind'] === 'mouse' && typeof combo['button'] === 'number';
  if (action.kind === 'key') return isKey;
  if (action.beginEnd && mode === 'begin-end') return isKey || isMouse;
  if (!isMouse) return false;
  // A bare left button on a modifier-guarded drag (a hand-edited store)
  // would swallow the plain drag that moves elements.
  if (
    action.needsModifierInDrag &&
    combo['button'] === 0 &&
    !combo['ctrl'] &&
    !combo['shift'] &&
    !combo['alt']
  ) {
    return false;
  }
  return true;
}

/** Keeps what still parses and still fits its action; drops the rest. */
function validate(parsed: unknown): {
  combos: Partial<Record<ActionId, Combo[]>>;
  modes: Partial<Record<ActionId, GestureMode>>;
} {
  const result: ReturnType<typeof validate> = { combos: {}, modes: {} };
  if (typeof parsed !== 'object' || parsed === null) return result;
  const stored = parsed as Record<string, unknown>;
  const storedModes = stored['modes'];
  if (typeof storedModes === 'object' && storedModes !== null) {
    for (const action of ACTIONS) {
      if (!action.beginEnd) continue;
      const mode = (storedModes as Record<string, unknown>)[action.id];
      if (mode === 'drag' || mode === 'begin-end') result.modes[action.id] = mode;
    }
  }
  const storedCombos = stored['combos'];
  if (typeof storedCombos === 'object' && storedCombos !== null) {
    for (const action of ACTIONS) {
      const value = (storedCombos as Record<string, unknown>)[action.id];
      if (!Array.isArray(value)) continue;
      const mode = result.modes[action.id] ?? 'drag';
      result.combos[action.id] = value
        .filter((combo): combo is Combo => isCombo(combo, action, mode))
        .slice(0, MAX_COMBOS);
    }
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
    const validated = validate(JSON.parse(stored));
    combosOverride = validated.combos;
    modes = validated.modes;
  } catch {
    combosOverride = {};
    modes = {};
  }
}
