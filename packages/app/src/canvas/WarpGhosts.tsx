import { ViewportPortal } from '@xyflow/react';
import { useGhosts } from './animations.js';
import { boxCss } from './styling.js';

/**
 * Deleted elements playing their warp-out. The model drops an element the
 * moment the delete command lands, which unmounts its node, so the exit
 * animation runs on this stand-in drawn at the same spot for WARP_MS.
 */
export function WarpGhosts() {
  const ghosts = useGhosts();
  if (ghosts.length === 0) return null;

  return (
    <ViewportPortal>
      {ghosts.map((ghost) => (
        <div
          key={ghost.id}
          className="warp-ghost"
          data-testid={`warp-ghost-${ghost.id}`}
          style={{
            position: 'absolute',
            left: ghost.rect.x,
            top: ghost.rect.y,
            width: ghost.rect.width,
            height: ghost.rect.height,
            // The element's own fill and stroke, so a styled element does not
            // flash back to default colours for its exit.
            ...boxCss(ghost.style),
          }}
        />
      ))}
    </ViewportPortal>
  );
}
