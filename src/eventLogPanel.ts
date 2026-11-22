/**
 * The event log column's own numbers.
 *
 * Same docked-column rules as the notes column — `dockedColumn.ts` holds them,
 * because a grab edge that closes when dragged shut should mean the same thing
 * on both sides of the page. What is specific here is how wide the log starts and
 * how narrow it may get: it starts wider than the notes column, because a row is
 * one event type plus a status and the payloads below it are JSON.
 */

import {
  closeBelow,
  maxDockedWidth,
  resolveDockedDrag,
  restoredDockedWidth,
  type DockedColumnDragResult,
} from "./dockedColumn";

/** Narrowest the log keeps; below this a drag either snaps back or closes. */
export const MIN_EVENT_LOG_PANEL = 320;
export const DEFAULT_EVENT_LOG_PANEL = 460;

/** Widest the log may get: the row it shares with the page, minus the page's minimum. */
export function maxEventLogPanelWidth(availableWidth: number): number {
  return maxDockedWidth(availableWidth, MIN_EVENT_LOG_PANEL);
}

/** Dragging below this closes the column. */
export const CLOSE_EVENT_LOG_PANEL_BELOW = closeBelow(MIN_EVENT_LOG_PANEL);

export type EventLogPanelDragResult = DockedColumnDragResult;

/** What a drag on the column's edge settles on: close, or a usable width. */
export function resolveEventLogPanelDrag(
  width: number,
  maxWidth: number,
): EventLogPanelDragResult {
  return resolveDockedDrag(width, maxWidth, MIN_EVENT_LOG_PANEL);
}

/** Width to reopen at after a drag closed the column. */
export function restoredEventLogPanelWidth(lastGoodWidth: number, maxWidth: number): number {
  return restoredDockedWidth(lastGoodWidth, maxWidth, MIN_EVENT_LOG_PANEL);
}
