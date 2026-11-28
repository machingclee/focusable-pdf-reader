/**
 * Which window is showing which document.
 *
 * A reference is answered by a *window*: clicking a nested note shows its passage
 * in a viewer of its own rather than moving the window the reader is reading in.
 * A pin's reference is the smaller answer — it scrolls the viewer that already has
 * the document, the clicked window included — but the question this module answers
 * is the same one: which window, if any, has that document?
 * But the app can have several of those windows at once — reference viewers, PDFs
 * opened in a window of their own, and full copies of the app — so "a window of
 * its own" would mean a second window on a document that is already on screen.
 * A click therefore asks this question first: is the note's PDF up in a subwindow
 * already? If it is, that window is told to stand on the note; only when it is
 * not is a window opened.
 *
 * The answer cannot come from a window's label. A label is fixed when the window
 * is made, while the document a window shows changes as the reader opens files,
 * and a reference window's own document can be replaced by any other. Nor can it
 * be asked over the bridge: Tauri's events are one-way, and the window that would
 * have to answer was opened long before the click.
 *
 * So each window writes down what it shows, and reads the others' lines:
 *
 * - **One line per window**, under a key carrying that window's label, written by
 *   the window it describes and by nothing else. Separate keys rather than one
 *   map, because two windows update on their own — a map would be a
 *   read-modify-write that can drop the line another window wrote in between.
 * - **A line is a claim, not a fact.** A window that was closed or crashed cannot
 *   withdraw its own line, so a reader intersects the lines with the labels Tauri
 *   says are alive (`windowBridge.ts`) and ignores the rest. A stale line costs a
 *   little storage and nothing else; `pruneViewers` is what eventually reclaims it.
 * - **Every viewer publishes; the original window is left out by the readers.** A
 *   reference is read *beside* what the reader is doing, so the same PDF may be
 *   open in the main window and in a subwindow at the same time, and a click in the
 *   main window is never answered by it — only by a subwindow, or by one opened for
 *   that click.
 *
 * Pure but for `localStorage`, which is passed in so a test can supply its own.
 */

/**
 * The prefix of one window's line: the label follows it.
 *
 * The version is in the key rather than in the value: a shape change makes old
 * lines unreadable instead of wrong, and they are pruned as unknown keys.
 */
const KEY_PREFIX = "open-viewers-v1:";

/** One window's claim about the document it is showing. */
export type OpenViewer = {
  /** The webview's Tauri label: what a message to that window is addressed to. */
  label: string;
  /** The library path of the document it has open, as the backend stores it. */
  filePath: string;
  /**
   * When this window last answered a reference, in epoch milliseconds.
   *
   * Opening a document writes the moment it opened; being told to show a passage
   * writes the moment it was asked. That is what makes repeated clicks land in the
   * same window: the one just answered is the most recently used, so it keeps the
   * next one too.
   */
  usedAt: number;
};

/**
 * The slice of `Storage` this module needs.
 *
 * `length` and `key` are here because the lines are separate keys: reading them
 * all means walking the store, not getting one value back.
 */
export type ViewerRegistryStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

function keyFor(label: string): string {
  return `${KEY_PREFIX}${label}`;
}

function isOpenViewer(value: unknown): value is OpenViewer {
  if (!value || typeof value !== "object") return false;
  const viewer = value as Partial<OpenViewer>;
  if (typeof viewer.label !== "string" || viewer.label.length === 0) return false;
  if (typeof viewer.filePath !== "string" || viewer.filePath.length === 0) return false;
  return typeof viewer.usedAt === "number" && Number.isFinite(viewer.usedAt);
}

/** One line, or null when the key holds nothing readable. */
function readViewer(key: string, storage: ViewerRegistryStorage): OpenViewer | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    // A blocked origin reads as "no windows", which opens one: the safe answer.
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isOpenViewer(parsed)) return null;
    // The key is where the label lives for every reader; a line filed under
    // another window's label is corrupt and is not trusted to name a window.
    if (parsed.label !== key.slice(KEY_PREFIX.length)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeViewer(viewer: OpenViewer, storage?: ViewerRegistryStorage): void {
  try {
    (storage ?? localStorage).setItem(keyFor(viewer.label), JSON.stringify(viewer));
  } catch {
    // Quota or private mode: the window simply looks empty to the next click,
    // which opens a second window on the document instead of reusing this one.
  }
}

/**
 * Say that `label` is showing `filePath` — this window's own line.
 *
 * `at` is the moment it opened, which the window passes so the registry has one
 * clock: `usedAt` and the open itself then never disagree about the order.
 */
export function recordViewer(
  label: string,
  filePath: string,
  at: number,
  storage?: ViewerRegistryStorage,
): void {
  writeViewer({ label, filePath, usedAt: at }, storage);
}

/** Withdraw a window's line: it is showing no document, or it is going away. */
export function withdrawViewer(label: string, storage?: ViewerRegistryStorage): void {
  try {
    (storage ?? localStorage).removeItem(keyFor(label));
  } catch {
    // Nothing to withdraw from a store that cannot be written.
  }
}

/**
 * Note that a window has just been asked to show a passage.
 *
 * Written by the window that *sent* the request, which is the only place it can
 * be done: the receiving window would have to answer, and it is already looking
 * at the passage. What it buys is the next click's choice — the window that just
 * answered is the one that answers again.
 */
export function touchViewer(
  label: string,
  at: number,
  storage?: ViewerRegistryStorage,
): void {
  const store = storage ?? localStorage;
  const viewer = readViewer(keyFor(label), store);
  if (!viewer) return;
  writeViewer({ ...viewer, usedAt: at }, store);
}

/** Every line in the store, stale ones included: the reader filters by live labels. */
export function listViewers(storage?: ViewerRegistryStorage): OpenViewer[] {
  const store = storage ?? localStorage;
  const viewers: OpenViewer[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      const viewer = readViewer(key, store);
      if (viewer) viewers.push(viewer);
    }
  } catch {
    return [];
  }
  return viewers;
}

/**
 * Forget the lines of windows that no longer exist.
 *
 * `live` is the labels Tauri reports. Called by a window as it publishes its own
 * document — the moment the app knows a window was opened, and the only moments
 * anything is written at all — so a closed window's line is reclaimed by the next
 * window that opens a PDF, however the window went away.
 */
export function pruneViewers(live: readonly string[], storage?: ViewerRegistryStorage): void {
  const store = storage ?? localStorage;
  const alive = new Set(live);
  for (const viewer of listViewers(store)) {
    if (!alive.has(viewer.label)) withdrawViewer(viewer.label, store);
  }
}

/**
 * The window a click should be answered in: one already showing `filePath`.
 *
 * Only a window Tauri still has is a candidate, and `exclude` names the ones that
 * are not answers whatever they show — the original window, which reads *beside*
 * a reference rather than being moved by one. The most recently used wins, so a
 * reader following several references into one PDF stays in one window instead of
 * gathering a window per click.
 */
export function viewerShowing(
  viewers: readonly OpenViewer[],
  filePath: string,
  live: readonly string[],
  exclude: readonly string[] = [],
): OpenViewer | null {
  const alive = new Set(live);
  const skipped = new Set(exclude);
  let best: OpenViewer | null = null;
  for (const viewer of viewers) {
    if (viewer.filePath !== filePath) continue;
    if (skipped.has(viewer.label) || !alive.has(viewer.label)) continue;
    if (best === null || viewer.usedAt > best.usedAt) best = viewer;
  }
  return best;
}

/**
 * What a click on a reference should do about *where* to show the passage.
 *
 * - `here` — the window the click happened in is showing the reference's document,
 *   and is allowed to answer: either it is not in `exclude`, or the caller let an
 *   excluded window answer for a click made inside it (`selfMayAnswer`). The
 *   reader is already looking at that document, so the passage is shown in the
 *   window they are in rather than in another one that happens to have it too.
 * - `window` — another subwindow has it: that window is told to stand on the
 *   passage. This is what stops a chain of references into one PDF from opening a
 *   window per click.
 * - `open` — nothing has it: a window of its own is what the reader gets.
 *
 * A window's own line can be out of date — the document was closed or replaced
 * between the line being written and this read — and a line naming the window the
 * click happened in is caught by the first case's check of what that window is
 * actually showing. A line naming *this* window with another document is
 * therefore `open`: obeying it would ask a window to stand on a passage of a
 * document it does not have.
 */
export type ReferencePlacement =
  | { kind: "here" }
  | { kind: "window"; label: string }
  | { kind: "open" };

export type ReferencePlacementOptions = {
  /** The document the reference points at — the note's PDF. */
  filePath: string;
  /** The window the click happened in, and the document it is showing. */
  self: { label: string; filePath: string | null };
  /** Every window's line, as {@link listViewers} read them. */
  viewers: readonly OpenViewer[];
  /** The labels Tauri reports: a line naming a closed window is not a candidate. */
  live: readonly string[];
  /** Windows that never answer, whatever they show — the original one. */
  exclude: readonly string[];
  /**
   * Whether a window in `exclude` may still answer a click made *inside* it.
   *
   * The original window is not a candidate for someone else's reference: it reads
   * beside one rather than being moved by one. But a click made in it is the reader
   * asking about the page in front of them, and a scroll is the smallest answer —
   * so a pin's reference scrolls that window instead of stacking a viewer on the
   * same PDF. Left off, the older rule stands and the excluded window opens one.
   */
  selfMayAnswer?: boolean;
};

export function referencePlacement({
  filePath,
  self,
  viewers,
  live,
  exclude,
  selfMayAnswer = false,
}: ReferencePlacementOptions): ReferencePlacement {
  const skipped = new Set(exclude);
  if ((selfMayAnswer || !skipped.has(self.label)) && self.filePath === filePath) {
    return { kind: "here" };
  }

  const found = viewerShowing(viewers, filePath, live, exclude);
  if (!found) return { kind: "open" };
  // Its own line, naming a document it is not showing: nothing to send it.
  if (found.label === self.label) return { kind: "open" };
  return { kind: "window", label: found.label };
}
