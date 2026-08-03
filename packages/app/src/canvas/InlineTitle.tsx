import { useEffect, useRef, useState } from 'react';
import { store } from '../store/store.js';
import type { Id } from '@domain-mapper/core';

/**
 * Renames an element in place. Enter and blur commit, Escape discards.
 *
 * The command fires once on commit rather than per keystroke, so a rename
 * lands in the trace as one action.
 */
export function InlineTitle({
  id,
  title,
  onDone,
  testId,
}: {
  id: Id;
  title: string;
  onDone: () => void;
  testId: string;
}) {
  const [text, setText] = useState(title);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const commit = () => {
    if (text !== title) store.dispatch({ type: 'set-metadata', id, title: text });
    onDone();
  };

  return (
    <input
      ref={input}
      className="inline-title"
      data-testid={testId}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') onDone();
        // Keep Delete and Backspace in the field instead of removing the element.
        event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}
