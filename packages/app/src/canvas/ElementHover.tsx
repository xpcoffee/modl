/**
 * The hover panel shared by nodes and edges: type badge, description, tags.
 *
 * Descriptions show here rather than the readable name. The name is a
 * debugging aid and the description is what a reader of the domain wants.
 */
export function ElementHover({
  elementType,
  description,
  tags,
}: {
  elementType: string;
  description: string;
  tags: Record<string, string>;
}) {
  const entries = Object.entries(tags);

  return (
    <div className="hover-card">
      <span className="hover-card__type" data-testid="hover-type">
        {elementType}
      </span>
      {description ? (
        <p className="hover-card__description" data-testid="hover-description">
          {description}
        </p>
      ) : (
        <p className="hover-card__description hover-card__description--empty">no description</p>
      )}
      {entries.length > 0 && (
        <ul className="hover-card__tags">
          {entries.map(([key, value]) => (
            <li key={key}>
              {key}={value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
