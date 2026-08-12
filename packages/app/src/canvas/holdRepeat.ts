/** How long each step takes while the hold is young, in milliseconds. */
export const SLOW_STEP_MS = 500;
/** How long each step takes once the hold has proven deliberate. */
export const FAST_STEP_MS = 1000 / 3;
/** How long a hold stays slow before it speeds up. */
export const SPEED_UP_AFTER_MS = 3000;

/**
 * Repeats a step while an input is held down: a step every half-second for
 * the first three seconds, then three per second. Slow first, so a reader
 * who overshot by one has time to let go; fast after, so a long list does
 * not take a minute to cross (issue #66, sped up on PR #67 review).
 *
 * The caller takes the first step itself on the press, then starts this for
 * the rest. Returns a stop function; the caller runs it on release, and on
 * anything else that ends the hold (the menu closing, unmount).
 */
export function startHoldRepeat(onStep: () => void): () => void {
  const startedAt = performance.now();
  let timer = 0;
  const schedule = (): void => {
    const elapsed = performance.now() - startedAt;
    const delay = elapsed < SPEED_UP_AFTER_MS ? SLOW_STEP_MS : FAST_STEP_MS;
    timer = window.setTimeout(() => {
      onStep();
      schedule();
    }, delay);
  };
  schedule();
  return () => window.clearTimeout(timer);
}
