import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFile, isInsideDir, isPdfFile, libraryDirFor } from "../backend/src/library.ts";

const folder = mkdtempSync(join(tmpdir(), "pdf-focus-viewer-library-test-"));

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

const fileIn = (name: string, contents: string | Uint8Array): string => {
  const path = join(folder, name);
  writeFileSync(path, contents);
  return path;
};

describe("libraryDirFor", () => {
  test("is a library folder beside the database", () => {
    expect(libraryDirFor("/a/b/database.db")).toBe("/a/b/library");
  });

  test("handles a relative database path", () => {
    expect(libraryDirFor("./prisma/dev.db")).toBe(join(process.cwd(), "prisma", "library"));
  });

  test("an in-memory database gets a temp folder, never the real one", () => {
    const dir = libraryDirFor(":memory:");
    expect(dir.startsWith(tmpdir())).toBe(true);
    expect(dir.endsWith("pdf-focus-viewer-library")).toBe(true);
  });
});

describe("isInsideDir", () => {
  test("a file directly in the folder is inside it", () => {
    expect(isInsideDir("/x/library", "/x/library/abc.pdf")).toBe(true);
  });

  test("a nested file is inside it", () => {
    expect(isInsideDir("/x/library", "/x/library/a/b.pdf")).toBe(true);
  });

  test("the folder itself is not inside itself", () => {
    expect(isInsideDir("/x/library", "/x/library")).toBe(false);
  });

  test("a path that climbs back out with .. is outside", () => {
    expect(isInsideDir("/x/library", "/x/library/../secret.pdf")).toBe(false);
  });

  test("a sibling whose name merely starts the same is outside", () => {
    expect(isInsideDir("/x/library", "/x/libraryX/a.pdf")).toBe(false);
  });

  test("an absolute path elsewhere is outside", () => {
    expect(isInsideDir("/x/library", "/etc/passwd")).toBe(false);
  });
});

describe("hashFile", () => {
  test("is the sha256 of the bytes, in hex", async () => {
    const path = fileIn("hashed.pdf", "%PDF-1.4\n%%EOF\n");
    const expected = createHash("sha256").update("%PDF-1.4\n%%EOF\n").digest("hex");
    expect(await hashFile(path)).toBe(expected);
    expect(await hashFile(path)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("identical bytes in two files hash the same", async () => {
    const a = fileIn("same-a.pdf", "%PDF-1.5\n%second copy\n");
    const b = fileIn("same-b.pdf", "%PDF-1.5\n%second copy\n");
    expect(await hashFile(a)).toBe(await hashFile(b));
  });

  test("one changed byte is a different hash", async () => {
    const a = fileIn("diff-a.pdf", "%PDF-1.4\n");
    const b = fileIn("diff-b.pdf", "%PDF-1.4.");
    expect(await hashFile(a)).not.toBe(await hashFile(b));
  });

  test("streams a file larger than one chunk", async () => {
    // Bigger than the stream's chunk size, so the hasher has to gather more than
    // one update to agree with a single-pass hash.
    const bytes = new Uint8Array(3 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const path = fileIn("large.pdf", bytes);
    expect(await hashFile(path)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("isPdfFile", () => {
  test("accepts a file that starts with the PDF header", async () => {
    expect(await isPdfFile(fileIn("ok.pdf", "%PDF-1.4\n%%EOF\n"))).toBe(true);
  });

  test("rejects a text file, whatever it is called", async () => {
    expect(await isPdfFile(fileIn("not-really.pdf", "hello, not a PDF\n"))).toBe(false);
  });

  test("rejects a folder", async () => {
    expect(await isPdfFile(folder)).toBe(false);
  });

  test("rejects a path that does not exist", async () => {
    expect(await isPdfFile(join(folder, "missing.pdf"))).toBe(false);
  });
});
