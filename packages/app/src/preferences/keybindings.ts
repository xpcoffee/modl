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
 * docs/decisions/018-customizable-keybindings.md.
 */

export type ActionId =
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'copy'
  | 'paste'
  | 'search'
  | 'save'
  | 'save-as'
  | 'delete'
  | 'cancel'
  | 'scroll-up'
  | 'scroll-down'
  | 'box-select'
  | 'duplicate'
  | 'pan';

/**
 * How a drag action runs: the input held through the motion (a button drags,
 * a key is pressed down and released), or between two separate presses.
 */
export type GestureMode = 'hold' | 'begin-end';

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
  /** Whether the action can run begin+end instead of as a held input. */
  beginEnd?: boolean;
  /**
   * Whether a hold-mode button must keep a modifier. A bare left button on
   * duplicate would swallow the plain drag that moves elements.
   */
  needsModifierInHold?: boolean;
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
  { id: 'save', label: 'Save', kind: 'key', gesture: 'press', defaults: [key('s', { ctrl: true })] },
  {
    id: 'save-as',
    label: 'Save as',
    kind: 'key',
    gesture: 'press',
    defaults: [key('s', { ctrl: true, shift: true })],
  },
  { id: 'delete', label: 'Delete', kind: 'key', gesture: 'press', defaults: [key('Delete'), key('Backspace')] },
  { id: 'cancel', label: 'Cancel', kind: 'key', gesture: 'press', defaults: [key('Escape')] },
  // One pair for every list that scrolls: the roller menus and the comment
  // timeline. Held down, the consumers repeat the step on a two-speed timer
  // (see canvas/holdRepeat.ts).
  { id: 'scroll-up', label: 'Scroll up', kind: 'key', gesture: 'press', defaults: [key('ArrowUp')] },
  { id: 'scroll-down', label: 'Scroll down', kind: 'key', gesture: 'press', defaults: [key('ArrowDown')] },
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
    needsModifierInHold: true,
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
  return modes[id] ?? 'hold';
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

/** `event.key`, lowercased for single characters so shift cannot change it. */
export function normalizeKey(k: string): string {
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

/** How a settled box joins the selection it opened over. */
export type BoxCombine = 'replace' | 'add' | 'subtract';

/** The modifiers a press holds, with ctrl read as ctrl-or-cmd. */
function heldModifiers(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): { ctrl: boolean; shift: boolean; alt: boolean } {
  return { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey };
}

/**
 * How a press relates to a bound box-select combo, or null when it misses.
 * Alt is matched exactly; shift and ctrl on top of the combo are the combine
 * modifiers: the bare combo replaces the selection, extra shift adds the
 * boxed elements, and extra ctrl subtracts them. A modifier inside the combo
 * is spent naming the gesture — shift+left drag always adds, because no
 * shift is left over to distinguish adding from replacing.
 */
function boxCombine(
  combo: Combo,
  held: { ctrl: boolean; shift: boolean; alt: boolean },
): BoxCombine | null {
  if (combo.alt !== held.alt) return null;
  if (combo.shift && !held.shift) return null;
  if (combo.ctrl && !held.ctrl) return null;
  if (!combo.ctrl && held.ctrl) return 'subtract';
  if (combo.shift || held.shift) return 'add';
  return 'replace';
}

/** The box-select gesture a press opens in hold mode, or null. */
export function boxSelectGesture(event: MouseLike): { combine: BoxCombine } | null {
  if (gestureMode('box-select') === 'begin-end') return null;
  const held = heldModifiers(event);
  for (const combo of combosFor('box-select')) {
    if (combo.kind !== 'mouse' || combo.button !== event.button) continue;
    const combine = boxCombine(combo, held);
    if (combine !== null) return { combine };
  }
  return null;
}

/**
 * The gesture a key press drives, and how its run will settle: on the key's
 * release for hold mode, on the next press of the binding for begin+end.
 * `combine` only means something for box-select.
 */
export function keyGestureTrigger(
  event: KeyLike,
): { id: 'box-select' | 'duplicate'; combine: BoxCombine; until: 'press' | 'release' } | null {
  {
    const until = gestureMode('box-select') === 'begin-end' ? 'press' : 'release';
    const held = heldModifiers(event);
    for (const combo of combosFor('box-select')) {
      if (combo.kind !== 'key' || combo.key !== normalizeKey(event.key)) continue;
      const combine = boxCombine(combo, held);
      if (combine !== null) return { id: 'box-select', combine, until };
    }
  }
  if (combosFor('duplicate').some((combo) => comboMatchesKey(combo, event))) {
    return {
      id: 'duplicate',
      combine: 'replace',
      until: gestureMode('duplicate') === 'begin-end' ? 'press' : 'release',
    };
  }
  return null;
}

/** The begin+end action a mouse press begins or ends, or null. */
export function beginEndMouseTrigger(
  event: MouseLike,
): { id: 'box-select' | 'duplicate'; combine: BoxCombine } | null {
  if (gestureMode('box-select') === 'begin-end') {
    const held = heldModifiers(event);
    for (const combo of combosFor('box-select')) {
      if (combo.kind !== 'mouse' || combo.button !== event.button) continue;
      const combine = boxCombine(combo, held);
      if (combine !== null) return { id: 'box-select', combine };
    }
  }
  if (gestureMode('duplicate') === 'begin-end') {
    if (combosFor('duplicate').some((combo) => comboMatchesMouse(combo, event))) {
      return { id: 'duplicate', combine: 'replace' };
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
  // A drag action takes keys in either mode: held down through the motion,
  // or pressed once to begin and once to end.
  const acceptsKeys = spec.kind === 'key' || spec.beginEnd === true;
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
  if (spec.needsModifierInHold && gestureMode(id) === 'hold' && bare) return null;
  return { kind: 'mouse', button: event.button, ctrl, shift: event.shiftKey, alt: event.altKey };
}

/** What the armed slot is waiting for, said in the panel. */
export function captureHint(id: ActionId): string {
  const spec = specOf(id);
  if (spec.beginEnd) return 'Press a key or button…';
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

/**
 * A combo said the way the action currently runs: a held button keeps the
 * word drag, a held key reads "Hold D", and begin+end reads as presses.
 */
export function describeActionCombo(id: ActionId, combo: Combo): string {
  const spec = specOf(id);
  if (!spec.beginEnd) return describeCombo(combo, spec.gesture);
  if (gestureMode(id) === 'begin-end') return describeCombo(combo, 'press');
  if (combo.kind === 'key') return `Hold ${describeCombo(combo, 'press')}`;
  return describeCombo(combo, 'drag');
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
 * matches them exactly, so each bound combo expands to every combine
 * variant: shift joins where the combo has none (add) and ctrl or meta
 * joins where the combo has none (subtract) — without them, pressing a
 * combine modifier mid-drag would close the box. The bare no-modifier form
 * is carried by selection-on-drag instead, and begin+end mode draws its
 * own box.
 */
export function selectionKeyCodes(): string[] {
  if (gestureMode('box-select') === 'begin-end') return [];
  const codes = new Set<string>();
  for (const combo of combosFor('box-select')) {
    if (combo.kind !== 'mouse') continue;
    const base = [...(combo.shift ? ['Shift'] : []), ...(combo.alt ? ['Alt'] : [])];
    const ctrlBases = combo.ctrl ? [['Control'], ['Meta']] : [[]];
    const shiftExtras = combo.shift ? [[]] : [[], ['Shift']];
    const ctrlExtras = combo.ctrl ? [[]] : [[], ['Control'], ['Meta']];
    for (const ctrlBase of ctrlBases) {
      for (const shiftExtra of shiftExtras) {
        for (const ctrlExtra of ctrlExtras) {
          const parts = [...base, ...ctrlBase, ...shiftExtra, ...ctrlExtra];
          if (parts.length > 0) codes.add(parts.join('+'));
        }
      }
    }
  }
  return [...codes];
}

/** One name per distinct press, for spotting two actions on one combo. */
function comboSignature(combo: Combo): string {
  const press = combo.kind === 'key' ? `key:${combo.key}` : `mouse:${combo.button}`;
  return `${press}:${combo.ctrl}:${combo.shift}:${combo.alt}`;
}

/**
 * The labels of the other actions holding this same combo, for the panel to
 * warn with. Both actions still fire; the panel does not arbitrate.
 */
export function duplicateOwners(id: ActionId, combo: Combo): string[] {
  const signature = comboSignature(combo);
  return ACTIONS.filter(
    (action) =>
      action.id !== id &&
      combosFor(action.id).some((other) => comboSignature(other) === signature),
  ).map((action) => action.label);
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
  if (action.beginEnd && isKey) return true;
  if (!isMouse) return false;
  // A bare left button on a modifier-guarded hold (a hand-edited store)
  // would swallow the plain drag that moves elements.
  if (
    action.needsModifierInHold &&
    mode === 'hold' &&
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
      // 'drag' is the mode's old name, kept readable across the rename.
      if (mode === 'hold' || mode === 'drag') result.modes[action.id] = 'hold';
      else if (mode === 'begin-end') result.modes[action.id] = 'begin-end';
    }
  }
  const storedCombos = stored['combos'];
  if (typeof storedCombos === 'object' && storedCombos !== null) {
    for (const action of ACTIONS) {
      const value = (storedCombos as Record<string, unknown>)[action.id];
      if (!Array.isArray(value)) continue;
      const mode = result.modes[action.id] ?? 'hold';
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
