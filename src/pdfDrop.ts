/**
 * What a drag onto the window is allowed to open.
 *
 * The drop target is the whole window, so the only question left at the edge
 * is which of the dragged paths are PDFs. The extension is all a drag can say
 * before the file is read; the backend still checks the bytes.
 */

export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

export function isPdfFile(file: { type: string; name: string }): boolean {
  if (file.type === "application/pdf") return true;
  return isPdfPath(file.name);
}

/** PDFs in a drop, in the order they arrived. */
export function pdfPaths(paths: readonly string[]): string[] {
  return paths.filter(isPdfPath);
}

/**
 * Whether the veil should cover the window for a Tauri file drag.
 *
 * The enter event lists paths when the OS will name them. Any PDF means the
 * window is the target; only other files means it is not. An empty list is a
 * file drag whose names are not available yet, so the veil goes up and the
 * drop itself decides.
 */
export function showPdfDropVeil(paths: readonly string[]): boolean {
  return paths.length === 0 || paths.some(isPdfPath);
}

/** An OS file drag, as opposed to a drag of text or a selected element. */
export function dragTypesIncludeFiles(types: readonly string[]): boolean {
  return types.includes("Files");
}
