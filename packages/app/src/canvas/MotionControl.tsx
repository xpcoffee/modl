import { ControlButton } from '@xyflow/react';
import { toggleMotion, useMotionReduced } from './motion.js';

/**
 * Turns the board's motion on or off, in the control cluster beside undo and
 * redo. It starts wherever the operating system points and overrides it from
 * there, which is the only thing on screen that says the board has a visual
 * language at all when the OS has switched animation off.
 */
export function MotionControl() {
  const reduced = useMotionReduced();
  const label = reduced ? 'Turn board animation on' : 'Turn board animation off';

  return (
    <ControlButton
      className="motion-control"
      data-testid="motion-toggle"
      data-motion={reduced ? 'reduced' : 'full'}
      onClick={toggleMotion}
      aria-pressed={!reduced}
      title={label}
      aria-label={label}
    >
      {/* A wavefront through the field, struck through when it is stilled. */}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" />
        {reduced && <path d="M4 20 20 4" />}
      </svg>
    </ControlButton>
  );
}
