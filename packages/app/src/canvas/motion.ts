import { useSyncExternalStore } from 'react';

/**
 * Whether the board animates.
 *
 * `prefers-reduced-motion: reduce` is the default answer and stays the
 * default: it is what the operating system was told. It is also a single
 * whole-OS switch, so a reader who turned Windows' animation effects off for
 * unrelated reasons lost the board's entire visual language with nothing on
 * screen saying so (issue #30). The board therefore takes an override, in
 * either direction, and says which way it is running.
 *
 * Presentation only, so it never reaches the document or the trace. It does
 * reach localStorage: a preference someone had to hunt for is not worth
 * re-hunting on every reload, and it describes the reader rather than the
 * domain they are drawing.
 */
export type MotionPreference = 'system' | 'full' | 'reduced';

const STORAGE_KEY = 'modl.motion';

let preference: MotionPreference = 'system';
const listeners = new Set<() => void>();

function systemReducesMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The answer everything else reads: the override, or the system's own. */
export function motionReduced(): boolean {
  if (preference === 'system') return systemReducesMotion();
  return preference === 'reduced';
}

export function motionPreference(): MotionPreference {
  return preference;
}

export function subscribeMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribeMotion, motionReduced, motionReduced);
}

/**
 * The CSS warps read this rather than the media query directly, so the
 * override reaches the keyframes and the JavaScript triggers through one
 * source of truth.
 */
function stamp(): void {
  document.documentElement.dataset['motion'] = motionReduced() ? 'reduced' : 'full';
}

function announce(): void {
  stamp();
  for (const listener of listeners) listener();
}

export function setMotionPreference(next: MotionPreference): void {
  preference = next;
  try {
    if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing and blocked storage: the preference still holds for
    // this session, which is the part the reader asked for.
  }
  announce();
}

/** Flips to the opposite of what the board is doing now, override either way. */
export function toggleMotion(): void {
  setMotionPreference(motionReduced() ? 'full' : 'reduced');
}

/**
 * Reads the stored preference and stamps the document, before the first
 * render so a node created in the first frame warps the right way.
 */
export function installMotion(): void {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  preference = stored === 'full' || stored === 'reduced' ? stored : 'system';

  // Following the system means following it as it changes, not only at load.
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', () => {
      if (preference === 'system') announce();
    });

  stamp();
}
