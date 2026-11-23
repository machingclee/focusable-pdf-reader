/**
 * Putting text on the system clipboard.
 *
 * The app writes two things to the clipboard — a code block's text from the
 * previewer, and a `[note:<id>]` reference from the notes lists — and the webview
 * does not always allow it. `navigator.clipboard` refuses when the document is
 * not focused or when the permission was denied, which in a desktop webview is
 * not an exotic case: a click in a popped-out notes window or a menu that moved
 * focus can both land there. So a refused async write falls back to the old
 * hidden-textarea copy, which works on a user gesture even then.
 *
 * The answer is a promise of whether the text actually reached the clipboard, so
 * the caller can say "copied" or "could not copy" instead of guessing.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through: the gesture-based path below is what remains.
  }
  return copyWithTextarea(text);
}

/**
 * The pre-`navigator.clipboard` copy: a real selection and `execCommand("copy")`.
 *
 * The textarea has to be in the document and selectable to be copied, so it is
 * placed off-screen rather than hidden with `display: none` (which a selection
 * cannot reach). `readonly` keeps the mobile keyboard down and stops the app's
 * own shortcut handling from treating the focus as typing.
 */
function copyWithTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "-9999px";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
