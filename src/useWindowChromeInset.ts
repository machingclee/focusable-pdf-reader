import { useLayoutEffect } from "react";

/**
 * The bottom of the window's drag chrome, in CSS px.
 *
 * A row with no box — the PDF view's toolbar while the Dashboard is showing,
 * `display: none` — is skipped, so the edge is the chrome that is actually on
 * screen. The value is rounded up: a fraction of a pixel left covered would be
 * the strip the pointer has to grab.
 */
export function windowChromeEnd(rows: ReadonlyArray<{ height: number; bottom: number }>): number {
  let end = 0;
  for (const row of rows) {
    if (row.height <= 0) continue;
    if (row.bottom > end) end = row.bottom;
  }
  return Math.ceil(end);
}

const CHROME_ROW = ".titlebar, .toolbar";

/**
 * Publishes the drag chrome's bottom edge as `--window-chrome-end`.
 *
 * The window has no native title bar. It is moved by the title strip and, in
 * the main window, the toolbar under it — two rows that read as one handle.
 * The note dialog's veil is fixed to the viewport, and a veil from the top
 * edge sits on that handle, so the press that should move the window lands on
 * the veil. The veil starts at this edge instead.
 */
export function useWindowChromeInset() {
  useLayoutEffect(() => {
    const root = document.documentElement;

    const measure = () => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(CHROME_ROW), (row) => {
        const box = row.getBoundingClientRect();
        return { height: box.height, bottom: box.bottom };
      });
      root.style.setProperty("--window-chrome-end", `${windowChromeEnd(rows)}px`);
    };

    const observer = new ResizeObserver(measure);
    const watch = () => {
      observer.disconnect();
      for (const row of document.querySelectorAll(CHROME_ROW)) observer.observe(row);
    };

    measure();
    watch();

    // Switching PDF / Dashboard mounts the other toolbar. The size observer is
    // still watching the row that just left, so the new row has to be picked up
    // or a taller toolbar would stay partly under the veil.
    const appBody = document.querySelector(".app-body");
    const onChromeSwap = () => {
      watch();
      measure();
    };
    const mutations = new MutationObserver(onChromeSwap);
    if (appBody) mutations.observe(appBody, { childList: true });

    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--window-chrome-end");
    };
  }, []);
}
