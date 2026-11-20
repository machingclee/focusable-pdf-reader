/**
 * Opening links from inside a markdown note preview.
 *
 * A note can link anywhere, and the webview must never navigate away: this is
 * a Tauri window whose whole state (open PDF, strip, zoom) lives in memory, so
 * one stray navigation replaces the viewer with a blank page. Every external
 * link is therefore intercepted and handed to the OS instead.
 *
 * Ported from the shell-script-manager project's `lib/openExternalLink.ts`;
 * the link rules are unchanged, only the import is hoisted because this app
 * already depends on the opener plugin.
 */
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

/**
 * A link the webview must never navigate to. `#...` is an in-document jump
 * (the contents list) and stays inside the preview.
 */
export function isExternalHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  return true;
}

/**
 * `openUrl` only accepts http(s), mailto and tel, so a `file://` link (a PDF,
 * say) has to go through `openPath` — otherwise the webview navigates to it
 * and the app goes blank.
 *
 * A root-relative link has no host of its own and is refused rather than
 * resolved against the dev server, for the same reason.
 */
export async function openExternalLink(href: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new Error(`Not an absolute link: ${href}`);
  }
  if (url.protocol === "file:") {
    await openPath(decodeURIComponent(url.pathname));
    return;
  }
  await openUrl(href);
}
