/**
 * Integration test for the API client against a real backend.
 *
 * It spawns `backend/src/index.ts` on a throwaway SQLite database and a random
 * port, so it needs Bun and `backend/node_modules`; it skips itself otherwise.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ApiError, createApiClient, type ApiClient } from "../src/api";

const backendDir = resolve(import.meta.dir, "..", "backend");
const backendAvailable = existsSync(join(backendDir, "node_modules"));
const READY_PATTERN = /BACKEND_READY port=(\d+)/;

let child: { kill: () => void } | undefined;
let databasePath: string | undefined;
let api: ApiClient;

async function startBackend(): Promise<number> {
  databasePath = join(tmpdir(), `pdf-focus-viewer-api-test-${Date.now()}.db`);
  const process_ = Bun.spawn([process.execPath, "src/index.ts"], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`,
      PORT: "0",
      BACKEND_STDIN_WATCHDOG: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  child = process_;

  const reader = process_.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value);
    const match = buffered.match(READY_PATTERN);
    if (match?.[1]) {
      reader.releaseLock();
      return Number.parseInt(match[1], 10);
    }
  }

  const stderr = await new Response(process_.stderr).text();
  throw new Error(`backend did not report a port.\nstdout:\n${buffered}\nstderr:\n${stderr}`);
}

describe.skipIf(!backendAvailable)("api client", () => {
  beforeAll(async () => {
    const port = await startBackend();
    api = createApiClient(async () => ({ baseUrl: `http://127.0.0.1:${port}`, token: null }));
  }, 30_000);

  afterAll(() => {
    child?.kill();
    if (databasePath) rmSync(databasePath, { force: true });
  });

  test("health answers", async () => {
    const health = await api.health();
    expect(health.status).toBe("ok");
    expect(health.pid).toBeGreaterThan(0);
  });

  let documentId = 0;

  test("resolveDocument creates the document with a numeric createdAt", async () => {
    const before = Date.now();
    const document = await api.resolveDocument({
      filePath: "/tmp/api-test-document.pdf",
      name: "api test",
      pageCount: 12,
      fingerprint: "fingerprint-1",
    });
    const after = Date.now();

    expect(document.id).toBeGreaterThan(0);
    expect(document.name).toBe("api test");
    expect(document.pageCount).toBe(12);
    expect(typeof document.createdAt).toBe("number");
    expect(document.createdAt).toBeGreaterThanOrEqual(before);
    expect(document.createdAt).toBeLessThanOrEqual(after);
    expect(document).not.toHaveProperty("updatedAt");
    expect(document.focusableStrips).toEqual([]);
    documentId = document.id;
  });

  test("resolveDocument keeps an edited name unless updateName is set", async () => {
    const renamed = await api.renameDocument(documentId, "my notes");
    expect(renamed.name).toBe("my notes");

    const reopened = await api.resolveDocument({ filePath: "/tmp/api-test-document.pdf", name: "file name" });
    expect(reopened.name).toBe("my notes");

    const forced = await api.resolveDocument({
      filePath: "/tmp/api-test-document.pdf",
      name: "file name",
      updateName: true,
    });
    expect(forced.name).toBe("file name");
  });

  test("strips round-trip", async () => {
    const strip = await api.createStrip({
      pdfDocumentId: documentId,
      pageNumber: 3,
      top: 120.5,
      height: 42,
      left: 72,
      width: 451,
      pageWidth: 595,
      pageHeight: 842,
      textExcerpt: "It was the best of times",
      remark: "# Note",
    });
    expect(strip.id).toBeGreaterThan(0);
    expect(strip.pageNumber).toBe(3);
    expect(typeof strip.createdAt).toBe("number");

    const listed = await api.listStrips({ pdfDocumentId: documentId });
    expect(listed.map((item) => item.id)).toEqual([strip.id]);
    expect(listed[0]?.pdfDocument?.name).toBe("file name");

    const updated = await api.updateStripRemark(strip.id, "changed");
    expect(updated.remark).toBe("changed");

    const reopened = await api.resolveDocument({ filePath: "/tmp/api-test-document.pdf" });
    expect(reopened.focusableStrips.map((item) => item.id)).toEqual([strip.id]);

    await api.deleteStrip(strip.id);
    expect(await api.listStrips({ pdfDocumentId: documentId })).toEqual([]);
  });

  test("documents are listed newest first with strip counts", async () => {
    const documents = await api.listDocuments();
    expect(documents.length).toBe(1);
    expect(documents[0]?.id).toBe(documentId);
    expect(documents[0]?._count?.focusableStrips).toBe(0);
  });

  test("errors surface as ApiError with the backend message", async () => {
    const failure = await api.updateStripRemark(999_999, "nope").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    expect((failure as ApiError).message).toMatch(/does not exist/);
  });
});
