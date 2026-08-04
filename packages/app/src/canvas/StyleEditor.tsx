import {
  isConnection,
  type Arrowhead,
  type Element,
  type Id,
  type StrokeStyle,
  type StylePatch,
} from '@modl/core';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';
import { rememberStyle } from './styleMemory.js';

/**
 * Six colours and a default beat a colour wheel here: a diagram wants a few
 * distinguishable hues, and swatches can be driven by a test.
 */
const PALETTE: { name: string; value: string }[] = [
  { name: 'gray', value: '#8b93a7' },
  { name: 'blue', value: '#5b8def' },
  { name: 'green', value: '#46a758' },
  { name: 'yellow', value: '#e79d13' },
  { name: 'red', value: '#e5484d' },
  { name: 'purple', value: '#8e4ec6' },
];

const LINE_STYLES: StrokeStyle[] = ['solid', 'dashed', 'dotted'];
const ARROWHEAD_CHOICES: { value: Arrowhead; glyph: string }[] = [
  { value: 'triangle', glyph: '➤' },
  { value: 'open', glyph: '>' },
  { value: 'diamond', glyph: '◆' },
];

/** The value every element shares, or undefined when they disagree. */
function common<T>(values: (T | undefined)[]): T | undefined {
  const [first, ...rest] = values;
  return rest.every((value) => value === first) ? first : undefined;
}

/**
 * Colour and line controls for the selection. Works on one element or many:
 * each row applies to the elements it can mean something to, so a mixed
 * selection edits its components' fill without touching the connections.
 */
export function StyleEditor({ ids }: { ids: Id[] }) {
  const state = useAppState();
  const elements = ids
    .map((id) => state.document.model.elements[id])
    .filter((element): element is Element => element !== undefined);

  const boxes = elements.filter((element) => !isConnection(element));
  const connections = elements.filter(isConnection);
  if (elements.length === 0) return null;

  const dispatchTo = (targets: Element[], patch: StylePatch) => {
    for (const element of targets) {
      store.dispatch({ type: 'set-style', id: element.id, style: patch });
    }
    rememberStyle(patch);
  };

  const currentFill = common(boxes.map((element) => element.style?.fill));
  const currentStroke = common(elements.map((element) => element.style?.stroke));
  const currentLine = common(elements.map((element) => element.style?.strokeStyle)) ?? 'solid';
  const currentArrowhead =
    common(connections.map((element) => element.style?.arrowhead)) ?? 'triangle';

  const swatchRow = (
    field: 'fill' | 'stroke',
    targets: Element[],
    current: string | undefined,
  ) => (
    <div className="style-editor__row" data-testid={`style-${field}`}>
      <span className="style-editor__label">{field}</span>
      <button
        type="button"
        className={`style-swatch style-swatch--default${current === undefined ? ' is-on' : ''}`}
        data-testid={`style-${field}-default`}
        aria-label={`${field} default`}
        aria-pressed={current === undefined}
        onClick={() => dispatchTo(targets, { [field]: null })}
      />
      {PALETTE.map(({ name, value }) => (
        <button
          key={name}
          type="button"
          className={`style-swatch${current === value ? ' is-on' : ''}`}
          style={{ background: value }}
          data-testid={`style-${field}-${name}`}
          aria-label={`${field} ${name}`}
          aria-pressed={current === value}
          onClick={() => dispatchTo(targets, { [field]: value })}
        />
      ))}
    </div>
  );

  return (
    <div className="style-editor" data-testid="style-editor">
      {boxes.length > 0 && swatchRow('fill', boxes, currentFill)}
      {swatchRow('stroke', elements, currentStroke)}

      <div className="style-editor__row" data-testid="style-line">
        <span className="style-editor__label">line</span>
        {LINE_STYLES.map((line) => (
          <button
            key={line}
            type="button"
            className={`style-line style-line--${line}${currentLine === line ? ' is-on' : ''}`}
            data-testid={`style-line-${line}`}
            aria-label={`${line} line`}
            aria-pressed={currentLine === line}
            // Solid is the default, so choosing it clears the field rather
            // than writing a second spelling of the same look.
            onClick={() => dispatchTo(elements, { strokeStyle: line === 'solid' ? null : line })}
          >
            <span />
          </button>
        ))}
      </div>

      {connections.length > 0 && (
        <div className="style-editor__row" data-testid="style-arrowhead">
          <span className="style-editor__label">head</span>
          {ARROWHEAD_CHOICES.map(({ value, glyph }) => (
            <button
              key={value}
              type="button"
              className={`style-arrowhead${currentArrowhead === value ? ' is-on' : ''}`}
              data-testid={`style-arrowhead-${value}`}
              aria-label={`${value} arrowhead`}
              aria-pressed={currentArrowhead === value}
              onClick={() =>
                dispatchTo(connections, { arrowhead: value === 'triangle' ? null : value })
              }
            >
              {glyph}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
