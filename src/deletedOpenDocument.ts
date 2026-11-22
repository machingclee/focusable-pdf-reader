/**
 * Which path to follow after a document row is deleted, when that row is the
 * PDF on screen.
 *
 * The library copy of the deleted row is already gone, so resolving that path
 * answers 404. When the library still holds one document, that document is the
 * one to open. Any other count keeps the old check: resolve the deleted path,
 * and a missing file closes the viewer.
 */

export type DeletedOpenDocument =
  | { action: "leave" }
  | { action: "open"; file_path: string; name: string }
  | { action: "recheck"; file_path: string };

export function deletedOpenDocument(
  openPath: string | null | undefined,
  deletedPath: string,
  remaining: { file_path: string; name: string }[],
): DeletedOpenDocument {
  if (openPath !== deletedPath) return { action: "leave" };
  const survivor = remaining.length === 1 ? remaining[0] : undefined;
  if (survivor && survivor.file_path !== deletedPath) {
    return { action: "open", file_path: survivor.file_path, name: survivor.name };
  }
  return { action: "recheck", file_path: deletedPath };
}
