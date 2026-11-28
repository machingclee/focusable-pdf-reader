/**
 * The dashboard's "Flow" button: the event-storming diagram, in a window of its
 * own.
 *
 * The diagram is the backend's own page, served beside its API, so opening it is
 * a matter of knowing the backend's address — which the app resolves lazily, in
 * two different ways:
 *
 * - **on the desktop**, through the target the backend writes at launch, then
 *   through the Tauri opener. The opener only allows the URLs named in its
 *   capability; until this address is one of them the diagram still opens, just
 *   in a webview window the app makes itself, raised if it is already up.
 * - **in a browser**, the window has to be opened *inside* the click: opening
 *   after an `await` is what the popup blocker refuses, and the button then looks
 *   like it did nothing. So the popup is claimed first and pointed at the backend
 *   once the address is known.
 */
import { backendTargetFromDevEnv, getBackendTarget } from "./../../backendConfig";

export async function openEventStorming(): Promise<void> {
  const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (tauri) {
    const target = await getBackendTarget();
    const url = `${target.baseUrl}/event-storming/`;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // The desktop opener only allows the URLs named in its capability. Until
      // that includes this address, the diagram still opens in its own window.
    }
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel("event-storming");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }
    new WebviewWindow("event-storming", {
      url,
      title: "Event storming",
      width: 1100,
      height: 760,
      focus: true,
    });
    return;
  }

  // Known before the click returns, so the new window is still part of it.
  const known = backendTargetFromDevEnv();
  if (known) {
    window.open(`${known.baseUrl}/event-storming/`, "_blank", "noopener,noreferrer");
    return;
  }
  const popup = window.open("", "_blank");
  const target = await getBackendTarget();
  if (popup && !popup.closed) popup.location.replace(`${target.baseUrl}/event-storming/`);
}
