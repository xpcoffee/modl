/** The extension every document file carries. See docs/domain-model.md. */
export const FILE_EXTENSION = '.modl.json';

/**
 * The file name a save dialog suggests for a board, derived from its title.
 * Characters that no filesystem accepts become dashes, and a title of only
 * such characters falls back to `domain`.
 */
export function suggestedFileName(title: string): string {
  const cleaned = title
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  return `${cleaned || 'domain'}${FILE_EXTENSION}`;
}

/**
 * The file name without its extension, for the tab title and the toolbar:
 * `payments.modl.json` reads as `payments`.
 */
export function fileStem(name: string): string {
  if (name.endsWith(FILE_EXTENSION)) return name.slice(0, -FILE_EXTENSION.length);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
