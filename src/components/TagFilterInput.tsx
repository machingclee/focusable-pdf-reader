/**
 * The documents rail's tag filter: the field you type a tag into, where the
 * Filter button used to be.
 *
 * The interaction is the reference project's `/tags` search — the title-bar box
 * that advertises "for a more refined tag search":
 *
 *   - typing narrows the tag catalogue, and what matches is listed under the
 *     field;
 *   - `Tab` / `↓` move the highlight down the list and `Shift+Tab` / `↑` move it
 *     back up, stopping at either end. Tab never takes the field away while
 *     there is a list to walk, so typing, reading down the matches and deciding
 *     are one uninterrupted motion;
 *   - `Enter` takes the highlighted tag — or the first match when nothing is
 *     highlighted — which applies the filter at once and empties the field: the
 *     field is a picker, and what it picked is shown by the chip under the
 *     header instead of staying in the box;
 *   - `Escape` clears the text and puts the field down.
 *
 * One tag at a time: a pick replaces the last one. `DashboardView` holds the picked
 * id and does the filtering; this component only knows the catalogue.
 *
 * The list is portalled to the body, like the tag popovers and the context
 * menus: the Dashboard tab and the docked columns each bring a stacking context and
 * an `overflow` box, and a list positioned inside one would be clipped by it.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Funnel, Tag as TagIcon } from "lucide-react";
import { matchesTagFilter, stripTagsCommand } from "../tagFilter";
import type { PdfTag } from "../types/dto";

/** Breathing room between the list and the window's edges. */
const MARGIN = 8;
/**
 * Narrowest the list gets. The rail may be as narrow as 200px, and a panel of
 * matching tag names in less than that would be a column of ellipses.
 */
const MIN_WIDTH = 240;
const LIST_ID = "notes-tag-suggestions";

export function TagFilterInput({
  tags,
  disabled = false,
  onPick,
}: {
  tags: PdfTag[];
  /** No tags in the catalogue yet: there is nothing to search, so the field says so. */
  disabled?: boolean;
  onPick: (tagId: number) => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [box, setBox] = useState({ top: 0, left: MARGIN, width: MIN_WIDTH });

  /** What the draft asks the catalogue for: `/tags lang` searches `lang`. */
  const query = stripTagsCommand(draft);
  const matches = useMemo(
    () => tags.filter((tag) => matchesTagFilter(tag.name, query)),
    [query, tags],
  );
  // Only a draft that says something opens the list; an empty field is an
  // invitation to type, not a catalogue dump.
  const open = focused && draft.trim().length > 0;
  /** A tag deleted while the list highlights it leaves no row to take. */
  const highlighted = activeIndex !== null && activeIndex < matches.length ? activeIndex : null;

  const pick = useCallback(
    (tag: PdfTag) => {
      onPick(tag.id);
      setDraft("");
      setActiveIndex(null);
      // The press that picked the row was prevented from taking focus, but a
      // pick that came from the keyboard leaves it here anyway: the reader may
      // well be picking again.
      inputRef.current?.focus();
    },
    [onPick],
  );

  // A different query is a different list: the highlight on the old one means
  // nothing on the new one, and keeping it would leave `Enter` set to take a tag
  // the reader is no longer looking at.
  useEffect(() => {
    setActiveIndex(null);
  }, [query]);

  // Under the field, as wide as the field wants to be, never off the window.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = fieldRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, MIN_WIDTH), window.innerWidth - 2 * MARGIN);
      const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - width - MARGIN);
      setBox({ top: rect.bottom + 4, left, width });
    }
    place();
    // The rail is draggable, so the field moves and changes width under a list
    // that is already open.
    const field = fieldRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (field && observer) observer.observe(field);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // The row the keyboard is on has to be visible, or `↑` / `↓` walk off the
  // bottom of the list and the highlight is invisible.
  useEffect(() => {
    if (highlighted === null) return;
    panelRef.current
      ?.querySelector(`[data-option-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  /**
   * Move the highlight down or up the list, clamped at both ends.
   *
   * From no highlight, forward starts at the first row and backward at the last,
   * so the first press always shows something. `Tab`, `Shift+Tab` and the arrows
   * all land here: the list is walked from the field, never focused itself.
   */
  function stepHighlight(direction: 1 | -1) {
    setActiveIndex((current) => {
      if (matches.length === 0) return null;
      if (current === null || current >= matches.length) {
        return direction === 1 ? 0 : matches.length - 1;
      }
      return Math.max(0, Math.min(matches.length - 1, current + direction));
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft("");
      setActiveIndex(null);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter") {
      // The pick, and the only key that makes one: the highlighted row, or the
      // first match when nothing is highlighted yet.
      if (!open || matches.length === 0) return;
      event.preventDefault();
      const tag = matches[highlighted ?? 0];
      if (tag) pick(tag);
      return;
    }
    if (event.key === "Tab") {
      // Tab walks the list instead of leaving the field, the way the reference's
      // `/tags` box keeps the caret here and moves a highlight down it.
      if (!open || matches.length === 0) return;
      event.preventDefault();
      stepHighlight(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open || matches.length === 0) return;
      event.preventDefault();
      stepHighlight(event.key === "ArrowDown" ? 1 : -1);
    }
  }

  return (
    <div
      className="notes-tag-search"
      ref={fieldRef}
      // The funnel and the padding are part of the field: a press there puts the
      // caret in it. Preventing the default keeps a focused field from blurring
      // when the press lands on the icon rather than the text.
      onMouseDown={(event) => {
        if (event.target === inputRef.current) return;
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <Funnel size={13} aria-hidden />
      <input
        ref={inputRef}
        type="text"
        className="notes-tag-search-field"
        value={draft}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        placeholder={disabled ? "No tags yet" : "Filter by tag"}
        title={
          disabled
            ? "No tags yet — right-click a document to add some"
            : "Type to find a tag · Tab or ↑ ↓ moves · Enter filters by it"
        }
        aria-label="Filter documents by tag"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? LIST_ID : undefined}
        aria-activedescendant={open && highlighted !== null ? optionId(highlighted) : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // A press on a row is prevented from blurring the field, so this is a
          // press somewhere else: the draft is not a value that can outlive it.
          setFocused(false);
          setDraft("");
        }}
        onKeyDown={onKeyDown}
      />

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={LIST_ID}
            className="tag-suggestions"
            role="listbox"
            aria-label="Matching tags"
            style={{ top: box.top, left: box.left, width: box.width }}
          >
            {matches.length === 0 ? (
              <p className="tag-suggestion-empty">No matching tags.</p>
            ) : (
              matches.map((tag, index) => (
                <button
                  key={tag.id}
                  type="button"
                  // The field keeps the keyboard: the list is chosen from it, the
                  // way the reference's `/tags` list is.
                  tabIndex={-1}
                  id={optionId(index)}
                  data-option-index={index}
                  role="option"
                  aria-selected={index === highlighted}
                  className={`tag-suggestion${index === highlighted ? " is-active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(tag);
                  }}
                >
                  <TagIcon size={13} aria-hidden />
                  <span className="tag-suggestion-name">{tag.name}</span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function optionId(index: number): string {
  return `${LIST_ID}-${index}`;
}
