/**
 * The OS this window is running on.
 *
 * Two things change with it. macOS is given no title bar to speak of —
 * `titleBarStyle: "Overlay"` puts the traffic lights over the content — so the
 * strip that replaces the bar leaves them a gutter. Windows runs its windows
 * undecorated instead (`tauri.windows.conf.json`, and `src-tauri/src/win32.rs`
 * for what the frame is left needing) and has no system buttons left at all, so
 * the same strip carries the window buttons and needs no gutter. CSS cannot see
 * the platform, so the answer is read once from the user agent (WKWebView says
 * "Macintosh", WebView2 reports "Windows NT") and published where both halves
 * can use it: as `data-os` on `<html>` for the stylesheet (`main.tsx`), and as
 * constants for the components that render different chrome (`TitleBar`,
 * `DetachedNotesApp`, `WindowControls`).
 *
 * The three answers are not symmetric. Windows is the one that changes the
 * chrome, and it is the only one that has to be recognised exactly; anything
 * Apple-shaped gets the macOS layout, and `other` is the plain `vite` web build,
 * which has no window to chrome at all.
 */
export type Platform = "macos" | "windows" | "other";

export function detectPlatform(userAgent: string): Platform {
  // Windows first, because it is the only answer that changes anything: the
  // other two keep the macOS layout. An iPad's agent says "Macintosh" and an
  // iPhone's says "like Mac OS X", so both land on `macos`; this app runs on
  // neither, and the fallback they get is the one that asks nothing of them.
  if (userAgent.includes("Windows NT")) return "windows";
  if (userAgent.includes("Macintosh") || userAgent.includes("Mac OS X")) return "macos";
  return "other";
}

export const PLATFORM: Platform =
  typeof navigator === "undefined" ? "other" : detectPlatform(navigator.userAgent);

/**
 * Windows, the one platform whose window buttons the app has to draw itself.
 *
 * Named rather than compared at each call site so the reason lives in one place:
 * macOS draws its own traffic lights, and this is what is left of them here.
 */
export const IS_WINDOWS = PLATFORM === "windows";
