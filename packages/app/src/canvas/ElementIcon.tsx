import type { ReactNode } from 'react';
import type { ConnectionType, EntityType } from '@modl/core';

/**
 * A permanent mark of what an element is, so the paradigm reads at a glance
 * without hovering. The hover card still spells the type out in words.
 */
const PATHS: Record<EntityType | ConnectionType, { label: string; path: ReactNode }> = {
  // Component: a cube, a built thing. A ring read too much like a state.
  component: {
    label: 'component',
    path: (
      <>
        <path d="M12 2.6 21 7.3v9.4L12 21.4 3 16.7V7.3Z" />
        <path d="M3 7.3 12 12l9-4.7M12 12v9.4" />
      </>
    ),
  },
  // Step: a footprint, one move along a path.
  step: {
    label: 'step',
    path: (
      <>
        <ellipse cx="10.5" cy="9" rx="4.5" ry="6" />
        <ellipse cx="13.5" cy="18.5" rx="3" ry="2.6" />
      </>
    ),
  },
  // Artifact: a page, the thing that moves between components.
  artifact: {
    label: 'artifact',
    path: (
      <>
        <path d="M6.5 3.2h7.8L18.5 7.4v13.4H6.5Z" />
        <path d="M14 3.4v4.2h4.3" />
        <path d="M9.4 12.4h6.2M9.4 16.2h6.2" />
      </>
    ),
  },
  // State: a ring, a place the system rests in.
  state: {
    label: 'state',
    path: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="3.5" />
      </>
    ),
  },
  // Interaction: traffic both ways.
  interaction: {
    label: 'interaction',
    path: (
      <>
        <path d="M3.5 9h17M17 5.5 20.5 9 17 12.5" />
        <path d="M20.5 15h-17M7 11.5 3.5 15 7 18.5" />
      </>
    ),
  },
  // Transition: one way, from here to there.
  transition: {
    label: 'transition',
    path: <path d="M3.5 12h17M15.5 7l5 5-5 5" />,
  },
  // Relation: a link between two things.
  relation: {
    label: 'relation',
    path: (
      <>
        <path d="M10 14a4.5 4.5 0 0 1 0-6.4l2.2-2.2a4.5 4.5 0 0 1 6.4 6.4L17.2 13" />
        <path d="M14 10a4.5 4.5 0 0 1 0 6.4l-2.2 2.2a4.5 4.5 0 0 1-6.4-6.4L6.8 11" />
      </>
    ),
  },
};

export function ElementIcon({
  elementType,
  className,
}: {
  elementType: EntityType | ConnectionType;
  className?: string;
}) {
  const icon = PATHS[elementType];
  if (!icon) return null;

  return (
    <svg
      className={className ?? 'element-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={icon.label}
      data-icon={elementType}
    >
      {icon.path}
    </svg>
  );
}
