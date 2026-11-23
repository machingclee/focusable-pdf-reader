import { mkdirSync } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveDatabasePath } from "./appDataDir.ts";

/**
 * The app's own copy of every PDF it reads.
 *
 * `pdf_document.file_path` points at a file in here, so moving, renaming or
 * deleting the file the reader opened changes nothing for the app. The name is
 * the SHA-256 of the bytes, which makes the folder content-addressed: the same
 * PDF opened from two places is one copy, and one row.
 *
 * The folder sits next to `database.db`, so the copy lives with the data that
 * describes it — including in the tests, where the database is a throwaway file
 * in the temp folder and the library is therefore throwaway too.
 */
export const LIBRARY_DIRNAME = "library";

/** Copies a delete or an undone import can still restore, until that step is discarded. */
export const LIBRARY_TRASH_DIRNAME = ".trash";

/** `<folder of database.db>/library`, or a temp folder for an in-memory database. */
export function libraryDirFor(databasePath: string): string {
  if (databasePath === ":memory:") return join(tmpdir(), "pdf-focus-viewer-library");
  return join(dirname(resolve(databasePath)), LIBRARY_DIRNAME);
}

let cached: string | undefined;

/**
 * The library folder for this process, created on first use.
 *
 * Created eagerly rather than on the first copy: an import that fails on a
 * missing folder would look like a broken filesystem rather than a first run.
 */
export function libraryDir(): string {
  const dir = libraryDirFor(resolveDatabasePath());
  if (cached !== dir) {
    cached = dir;
    mkdirSync(cached, { recursive: true });
  }
  return cached;
}

/** `<library>/.trash`, created when the first copy is parked there. */
export function libraryTrashDir(): string {
  return join(libraryDir(), LIBRARY_TRASH_DIRNAME);
}

/** Where a library copy waits while its delete or undone import can still be reversed. */
export function trashedLibraryPath(filePath: string): string {
  return join(libraryTrashDir(), basename(filePath));
}

/** True when `path` resolves to a file strictly inside `dir` (no `..` escapes). */
export function isInsideDir(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(path));
  // `""` is the folder itself and `..` is outside it; `libraryX/a.pdf` is not
  // inside `library` even though the string starts the same way.
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Where the copy of one content hash lives. */
export function libraryPathFor(hash: string): string {
  return join(libraryDir(), `${hash}.pdf`);
}

/** SHA-256 of the file, streamed so a 300 MB book is not loaded into memory. */
export async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/** Whether the path is an existing regular file (directories are not files). */
export async function isExistingFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() ?? false;
}

/**
 * Regular file that starts with the PDF magic bytes.
 *
 * The header is what is checked, not the extension: this endpoint is handed any
 * local path, and a renamed text file would otherwise be copied into the library
 * and then fail in pdf.js with a much less useful message.
 */
export async function isPdfFile(path: string): Promise<boolean> {
  if (!(await isExistingFile(path))) return false;
  return (await Bun.file(path).slice(0, 5).text()) === "%PDF-";
}

/**
 * Copy a file into the library, atomically.
 *
 * The copy lands under a temporary name and is renamed into place, so a crash
 * mid-copy cannot leave a truncated PDF under the hash of its complete self —
 * which would be worse than no copy at all, because the next import would trust
 * it. An existing copy is left alone: it already is the bytes that hash.
 */
export async function copyIntoLibrary(sourcePath: string, hash: string): Promise<string> {
  const target = libraryPathFor(hash);
  if (await Bun.file(target).exists()) return target;
  const temp = `${target}.tmp-${crypto.randomUUID()}`;
  try {
    await copyFile(sourcePath, temp);
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  return target;
}

/**
 * Park a library copy in the trash instead of unlinking it.
 *
 * Undo of the delete moves it back. A path outside the library, or one that is
 * already in the trash, is left alone: the reader still owns the first, and the
 * second has already been parked.
 */
export async function moveLibraryCopyToTrash(filePath: string): Promise<void> {
  if (!isInsideDir(libraryDir(), filePath)) return;
  if (isInsideDir(libraryTrashDir(), filePath)) return;
  if (!(await isExistingFile(filePath))) return;
  const target = trashedLibraryPath(filePath);
  await mkdir(libraryTrashDir(), { recursive: true });
  await rm(target, { force: true });
  await rename(filePath, target);
}

/** Move a parked copy back to the path the document row names. */
export async function restoreLibraryCopy(filePath: string): Promise<void> {
  const trashed = trashedLibraryPath(filePath);
  if (!isInsideDir(libraryTrashDir(), trashed)) return;
  if (!(await isExistingFile(trashed))) return;
  await mkdir(dirname(filePath), { recursive: true });
  await rm(filePath, { force: true });
  await rename(trashed, filePath);
}

/** Drop parked copies. Called when a history step is discarded, and on startup. */
export async function discardTrashedCopies(filePaths: readonly string[]): Promise<void> {
  await Promise.all(
    filePaths.map((filePath) => rm(trashedLibraryPath(filePath), { force: true }).catch(() => undefined)),
  );
}

/**
 * Delete the trash directory.
 *
 * The undo stack lives in memory, so a process that has just started has nothing
 * to restore. Copies parked by the previous process are permanent deletions.
 */
export async function sweepLibraryTrash(): Promise<void> {
  await rm(libraryTrashDir(), { recursive: true, force: true });
}
