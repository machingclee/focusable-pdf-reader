/**
 * The in-document find bar, laid over the stage.
 *
 * It owns the box's text while it is being typed: a keystroke updates the draft
 * straight away — the field must never lag a key — and the committed query
 * follows after the debounce. Submitting a draft that has not been committed yet
 * commits it; submitting the query that is already committed steps to the next
 * match, which is what pressing Return twice does.
 */
import { memo, useEffect, useRef, useState, type RefObject } from "react";

/** How long the box has to sit still before the document is searched for it. */
const SEARCH_DEBOUNCE_MS = 250;

export const SearchBar = memo(function SearchBar({
  committedQuery,
  onCommit,
  onStep,
  onClose,
  inputRef,
  activeHit,
  hitCount,
}: {
  committedQuery: string;
  onCommit: (query: string) => void;
  onStep: (delta: number) => void;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  activeHit: number;
  hitCount: number;
}) {
  const [draft, setDraft] = useState(committedQuery);
  const draftRef = useRef(draft);
  const committedRef = useRef(committedQuery);
  draftRef.current = draft;
  committedRef.current = committedQuery;

  useEffect(() => {
    setDraft(committedQuery);
  }, [committedQuery]);

  useEffect(() => {
    if (draft === committedQuery) return;
    const id = window.setTimeout(() => onCommit(draft), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [committedQuery, draft, onCommit]);

  return (
    <form
      className="search-bar"
      onSubmit={(event) => {
        event.preventDefault();
        const query = draftRef.current;
        if (query !== committedRef.current) {
          onCommit(query);
          return;
        }
        onStep(1);
      }}
    >
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (!next.trim()) onCommit("");
        }}
        placeholder="Find in document"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <span className="search-count">
        {committedQuery.trim()
          ? hitCount
            ? `${activeHit + 1} / ${hitCount}`
            : "0 / 0"
          : ""}
      </span>
      <button type="button" className="icon" onClick={() => onStep(-1)} disabled={hitCount === 0} aria-label="Previous match">
        ↑
      </button>
      <button type="submit" className="icon" disabled={hitCount === 0 && !draft.trim()} aria-label="Next match">
        ↓
      </button>
      <button type="button" className="icon" onClick={onClose} aria-label="Close search">
        ×
      </button>
    </form>
  );
});
