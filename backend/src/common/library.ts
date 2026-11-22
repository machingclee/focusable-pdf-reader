import { mkdirSync } from "node:fs";
import { copyFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  if (!cached) {
    cached = libraryDirFor(resolveDatabasePath());
    mkdirSync(cached, { recursive: true });
  }
  return cached;
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
