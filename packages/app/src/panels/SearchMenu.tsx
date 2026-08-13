import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useStore as useFlowStore } from '@xyflow/react';
import {
  MAX_FILTERS,
  activeFilterTerms,
  addTerm,
  formatTerm,
  replaceTerm,
  searchOptions,
  visibleAnchor,
  type AppState,
  type FilterTerm,
  type Id,
  type SearchOption,
} from '@modl/core';
import { setSearchPreview } from '../canvas/searchPreview.js';
import { matchesKey } from '../preferences/keybindings.js';
import { motionReduced } from '../preferences/motion.js';
import { store } from '../store/store.js';
import { useAppState } from '../store/useStore.js';

/** How many options are on screen at once. The rest are reached by cycling. */
const VISIBLE_OPTIONS = 10;

/** How long the close takes: the two search-close CSS animations end to end. */
const CLOSE_MS = 300;

/** What the bar is doing: finding things, or changing one active filter. */
type Mode = { kind: 'search' } | { kind: 'edit'; index: number };

/** The board rectangle a pan should centre on. */
function rectOf(state: AppState, id: Id): { x: number; y: number; width: number; height: number } {
  const entry = state.document.layout[id];
  if (!entry || !('x' in entry)) return { x: 0, y: 0, width: 180, height: 72 };
  const container = state.expanded.includes(id) ? entry.expanded : undefined;
  return {
    x: entry.x,
    y: entry.y,
    width: container?.width ?? entry.width,
    height: container?.height ?? entry.height,
  };
}

/** A stable key for an option, so the list keeps its identity across renders. */
function keyOf(option: SearchOption): string {
  return option.kind === 'element' ? `element:${option.id}` : `filter:${option.label}`;
}

/** A filter's label as a test id: quotes and '=' do not belong in one. */
function slug(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

/**
 * How an option is addressed from a test. The kind is part of the id because
 * the text filter "team" and the tag filter team read the same once the
 * punctuation is stripped, and they are different acts.
 */
function testIdOf(option: SearchOption): string {
  if (option.kind === 'element') return `search-element-${option.id}`;
  if (option.term.kind === 'text') return `search-text-${slug(option.term.text)}`;
  if (option.term.kind === 'comment') return `search-comment-${slug(option.label)}`;
  return `search-tag-${slug(option.label)}`;
}

/**
 * The board's search and filter menu: a button top-centre that opens into a
 * search bar. See docs/decisions/015-search-and-filter-menu.md.
 *
 * Typing narrows the board as a preview. The first option makes that narrowing
 * permanent as a filter; the elements below it are places to go. Filters
 * already applied sit under the bar as chips, each one editable through the
 * same bar with the elements left out.
 */
export function SearchMenu() {
  const state = useAppState();
  const { getViewport } = useReactFlow();
  const paneWidth = useFlowStore((flow) => flow.width);
  const paneHeight = useFlowStore((flow) => flow.height);

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'search' });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [windowStart, setWindowStart] = useState(0);

  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const terms = useMemo(() => activeFilterTerms(state.filter), [state.filter]);
  const editing = mode.kind === 'edit';

  const options = useMemo(
    () =>
      searchOptions(state, query, {
        filtersOnly: editing,
        // An edit replaces a term rather than adding one, so the cap only
        // closes the door on a brand new filter.
        allowNewFilter: editing || terms.length < MAX_FILTERS,
      }),
    [state, query, editing, terms.length],
  );

  /** The bar is gone: forget what it held, ready for the next opening. */
  const settle = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setMode({ kind: 'search' });
    setQuery('');
    setActive(0);
    setWindowStart(0);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setSearchPreview(null);
    if (motionReduced()) {
      settle();
      return;
    }
    // The bar stays mounted, holding its content, while it shrinks away.
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(settle, CLOSE_MS);
  }, [settle]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  /** Opens the bar for a plain search, focusing whatever it already holds. */
  const openSearch = useCallback(() => {
    // Reopening mid-shrink claims the bar back before the timer empties it.
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
    setMode({ kind: 'search' });
    setQuery('');
    setActive(0);
    setWindowStart(0);
  }, []);

  // The search binding (ctrl+f out of the box) reaches the menu from
  // anywhere on the board.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesKey('search', event)) return;
      event.preventDefault();
      // The focus follows in an effect: the input does not exist until the
      // state change that opens the bar has rendered.
      openSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSearch]);

  // Clicking anywhere else shuts the menu, which is the other way out of it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (container.current?.contains(event.target as globalThis.Node)) return;
      close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, mode]);

  // The options change under the cursor as the query narrows, so the active
  // slot returns to the top rather than pointing at whatever took its place.
  const optionKeys = options.map(keyOf).join(' ');
  useEffect(() => {
    setActive(0);
    setWindowStart(0);
  }, [optionKeys]);

  /**
   * What the board shows while the menu is open: the committed filter, plus
   * the term the active option would add. An element option previews the text
   * the reader typed, since that is what narrowed the list down to it.
   */
  const previewTerm = useMemo((): FilterTerm | null => {
    // Nothing typed is not a narrowing: opening the menu must leave the board
    // exactly as it was, whatever option happens to sit first in the list.
    if (!open || editing || query.trim() === '') return null;
    const option = options[active];
    if (option?.kind === 'filter') return option.term;
    return { kind: 'text', negated: false, text: query.trim() };
  }, [open, editing, options, active, query]);

  useEffect(() => {
    setSearchPreview(previewTerm === null ? null : addTerm(state.filter, previewTerm));
  }, [previewTerm, state.filter]);

  // Nothing previewed once the menu is gone, whatever took it away.
  useEffect(() => () => setSearchPreview(null), []);

  const step = (by: number): void => {
    if (options.length === 0) return;
    const next = (active + by + options.length) % options.length;
    setActive(next);
    setWindowStart((start) => {
      if (next < start) return next;
      if (next >= start + VISIBLE_OPTIONS) return next - VISIBLE_OPTIONS + 1;
      // Wrapping to the top of a long list has to bring the window with it.
      if (next >= options.length - 1 && by > 0) return Math.max(0, options.length - VISIBLE_OPTIONS);
      return start;
    });
  };

  /** Goes to an element: the camera moves, and the selection follows it. */
  const goTo = (id: Id): void => {
    const current = store.getState();
    const anchor = visibleAnchor(current.document.model.elements, id, new Set(current.expanded));
    const target = rectOf(current, anchor);
    const zoom = getViewport().zoom;
    store.dispatch({
      type: 'set-view',
      pan: {
        x: paneWidth / 2 - (target.x + target.width / 2) * zoom,
        y: paneHeight / 2 - (target.y + target.height / 2) * zoom,
      },
      zoom,
    });
    store.dispatch({ type: 'set-selection', ids: [anchor] });
    close();
  };

  const applyTerm = (term: FilterTerm): void => {
    const expression =
      mode.kind === 'edit'
        ? replaceTerm(state.filter, mode.index, term)
        : addTerm(state.filter, term);
    store.dispatch({ type: 'set-filter', expression });
    // The filter is in place, so the query that described it has done its job.
    setQuery('');
    setMode({ kind: 'search' });
  };

  const choose = (option: SearchOption): void => {
    if (option.kind === 'element') goTo(option.id);
    else applyTerm(option.term);
  };

  const removeTermAt = (index: number): void => {
    store.dispatch({ type: 'set-filter', expression: replaceTerm(state.filter, index, null) });
    setMode({ kind: 'search' });
    setQuery('');
  };

  /** Opens the editor for one chip, seeded with how that filter reads. */
  const editTermAt = (index: number): void => {
    const term = terms[index];
    if (!term) return;
    setOpen(true);
    setMode({ kind: 'edit', index });
    // Text-bearing terms seed the words alone: the suggestions match against
    // comment text and titles, and `comment=` punctuation is found in neither.
    setQuery(
      term.kind === 'text' ? term.text : term.kind === 'comment' ? (term.text ?? '') : formatTerm(term),
    );
    setActive(0);
    setWindowStart(0);
  };

  const onQueryChange = (value: string): void => {
    setQuery(value);
    // Emptying a filter is how it is deleted, and it takes effect at once.
    if (mode.kind === 'edit' && value.trim() === '') removeTermAt(mode.index);
  };

  const shown = options.slice(windowStart, windowStart + VISIBLE_OPTIONS);

  return (
    <div
      className={`search-menu nodrag nopan nowheel${open ? ' is-open' : ''}`}
      data-testid="search-menu"
      ref={container}
      onWheel={(event) => {
        if (!open || event.deltaY === 0) return;
        event.stopPropagation();
        step(event.deltaY > 0 ? 1 : -1);
      }}
      onKeyDown={(event) => {
        // A key landing on the departing bar must not act on it.
        if (!open) return;
        if (event.key === 'ArrowDown') step(1);
        else if (event.key === 'ArrowUp') step(-1);
        else if (event.key === 'Enter') {
          const option = options[active];
          if (option) choose(option);
        } else if (event.key === 'Escape') close();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {!open && !closing && (
        <button
          type="button"
          className="search-menu__entrance"
          data-testid="search-open"
          aria-label={
            terms.length === 0
              ? 'Search the board (Ctrl+F)'
              : `Search the board (Ctrl+F), ${terms.length} filters active`
          }
          onClick={openSearch}
        >
          <SearchIcon />
          <span>Search</span>
          {terms.length > 0 && (
            <span className="search-menu__count" data-testid="filter-count">
              <FilterIcon />
              {terms.length}
            </span>
          )}
        </button>
      )}

      <button
        type="button"
        className={`search-menu__focus${state.focusMode ? ' is-on' : ''}`}
        data-testid="focus-toggle"
        aria-pressed={state.focusMode}
        aria-label="Focus mode: hide elements the filter does not match"
        title={
          state.focusMode
            ? 'Focus mode is on: elements the filter does not match leave the board'
            : 'Focus mode: hide elements the filter does not match'
        }
        onClick={() => store.dispatch({ type: 'set-focus-mode', enabled: !state.focusMode })}
      >
        <FocusIcon />
      </button>

      {(open || closing) && (
        <div className={`search-menu__bar${closing ? ' is-closing' : ''}`} data-testid="search-bar">
          <div className="search-menu__field">
            {editing ? <FilterIcon /> : <SearchIcon />}
            <input
              ref={input}
              data-testid="search-input"
              autoComplete="off"
              placeholder={editing ? 'change this filter, or empty it to remove' : 'find anything on the board'}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <button
              type="button"
              className="search-menu__close"
              data-testid="search-close"
              aria-label="Close search"
              onClick={close}
            >
              ×
            </button>
          </div>

          <div className="search-menu__panel" data-testid="search-panel">
            <div className="search-menu__panel-inner">
              {terms.length > 0 && (
                <ul className="search-menu__filters" data-testid="active-filters">
                  {terms.map((term, index) => (
                    <li key={`${formatTerm(term)}-${index}`}>
                      <button
                        type="button"
                        className={`search-menu__chip${editing && mode.index === index ? ' is-editing' : ''}`}
                        data-testid={`filter-chip-${index}`}
                        title="Edit this filter"
                        onClick={() => editTermAt(index)}
                      >
                        <TermIcon term={term} />
                        {formatTerm(term)}
                      </button>
                      <button
                        type="button"
                        className="search-menu__chip-remove"
                        data-testid={`filter-remove-${index}`}
                        aria-label={`Remove filter ${formatTerm(term)}`}
                        onClick={() => removeTermAt(index)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {terms.length >= MAX_FILTERS && !editing && (
                <p className="search-menu__note" data-testid="filter-cap">
                  {MAX_FILTERS} filters is the limit. Remove one to add another.
                </p>
              )}

              <ul className="search-menu__options" data-testid="search-options">
                {shown.map((option) => {
                  const index = options.indexOf(option);
                  return (
                    <li key={keyOf(option)}>
                      <button
                        type="button"
                        className={`search-menu__option${index === active ? ' is-active' : ''}`}
                        data-testid={testIdOf(option)}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => choose(option)}
                      >
                        {option.kind === 'filter' ? <TermIcon term={option.term} /> : <GoToIcon />}
                        <span className="search-menu__option-label">{option.label}</span>
                        <span className="search-menu__option-kind">
                          {option.kind === 'filter'
                            ? editing
                              ? 'change filter'
                              : filterSublabel(option.term)
                            : option.sublabel}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {options.length === 0 && (
                  <li className="search-menu__empty" data-testid="search-empty">
                    nothing matches “{query}”
                  </li>
                )}
              </ul>

              {options.length > VISIBLE_OPTIONS && (
                <p className="search-menu__note" data-testid="search-more">
                  {windowStart + 1}–{Math.min(windowStart + VISIBLE_OPTIONS, options.length)} of{' '}
                  {options.length} · arrow keys or the wheel to cycle
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What applying this filter narrows by, so like-reading options tell apart. */
function filterSublabel(term: FilterTerm): string {
  if (term.kind === 'comment') return 'filter by comment';
  if (term.kind === 'tag') return 'filter by tag';
  return 'filter by name';
}

/**
 * The symbol carrying a term's kind. A tag named "comment" and the comment
 * filter would read identically as chips, so the kind shows as a glyph:
 * a luggage tag for tags, a speech bubble for comments, the funnel for a
 * name filter.
 */
function TermIcon({ term }: { term: FilterTerm }) {
  if (term.kind === 'comment') return <CommentIcon />;
  if (term.kind === 'tag') return <TagIcon />;
  return <FilterIcon />;
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-menu__icon">
      <path d="M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 .59 1.42l9 9a2 2 0 0 0 2.82 0l7-7a2 2 0 0 0 0-2.84zM6.5 8A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-menu__icon">
      <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-menu__icon">
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-menu__icon">
      <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
    </svg>
  );
}

function FocusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-menu__icon">
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
    </svg>
  );
}

function GoToIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-menu__icon">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-12a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
    </svg>
  );
}
