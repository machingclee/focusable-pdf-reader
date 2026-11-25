/**
 * Turning stored rows into list rows for the Dashboard tab.
 *
 * The notes list shows a saved strip as a thumbnail plus one line of text and a
 * date. The text has to come from the markdown `remark`, but rendering markdown
 * there would be both heavy (one previewer per row) and wrong for a one-line
 * label — a heading would dominate, a table would show pipes. So the note is
 * flattened to plain text first. The notes filter matches the same flattened text
 * (`noteFilter.ts`), so a word the reader can see is a word the filter can find.
 *
 * Kept free of DOM and React so the flattening rules can be tested directly.
 */

/** Markers and syntax that make no sense in a one-line label or a search. */
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TASK_BOX = /^\s*\[[ xX]\]\s*/;
const BLOCKQUOTE = /^\s*>\s?/;
const TABLE_RULE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const MATH_BLOCK = /^\s*\$\$\s*$/;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const EMPHASIS = /(\*\*|__|\*|_|~~|`)/g;

/**
 * Flatten a markdown note into one line of plain text, in full.
 *
 * The rules are the ones a list row needs: no heading hashes, no list markers, no
 * emphasis or code ticks, link text kept and link targets dropped, table pipes
 * turned into spaces, and the fence/delimiter lines that carry no words taken out
 * while their contents stay. Whitespace is collapsed last, so a note that opens
 * with a heading still yields the heading text rather than an empty label.
 *
 * The full text is what the notes filter matches against — a truncated label would
 * hide a word that is in the note — so `noteSummary` is the one that cuts.
 */
export function markdownText(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (FENCE.test(line)) return false;
      if (MATH_BLOCK.test(line)) return false;
      if (TABLE_RULE.test(line)) return false;
      return true;
    })
    .map((line) =>
      line
        .replace(HEADING, "")
        .replace(LIST_MARKER, "")
        .replace(TASK_BOX, "")
        .replace(BLOCKQUOTE, "")
        .replace(IMAGE, "")
        .replace(LINK, "$1")
        .replace(EMPHASIS, "")
        .replace(/\|/g, " "),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The one-line label for a list row: `markdownText`, cut to `limit`. */
export function noteSummary(markdown: string, limit = 160): string {
  const text = markdownText(markdown);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}

/**
 * Relative-ish timestamp for a list row: time of day for today, "Yesterday",
 * the weekday inside the last week, the date after that. `now` is a parameter so
 * the rule is testable without freezing the clock.
 */
export function formatSavedAt(value: number, now = Date.now()): string {
  const then = new Date(value);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const daysAgo = Math.floor((startOfToday - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / dayMs);
  const time = then.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (daysAgo <= 0) return `Today ${time}`;
  if (daysAgo === 1) return `Yesterday ${time}`;
  if (daysAgo < 7) return then.toLocaleDateString(undefined, { weekday: "long" });
  if (then.getFullYear() === today.getFullYear()) {
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return then.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
