/**
 * Session undo and redo: the in-memory stack, and the commands it sends back
 * through the bus once a change has committed.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AUDIT_WRITER, Container, MemoryAuditWriter, TRANSACTION_RUNNER, createCqrsModule } from "@machingclee/express-cqrs";
import { PDF_NOTE_MANAGEMENT_COMPONENTS } from "../src/bounded-contexts/components.ts";
import { ApplyHistoryCommand } from "../src/bounded-contexts/pdf-note-management/command/ApplyHistoryCommand.ts";
import { CreateFocusableStripCommand } from "../src/bounded-contexts/pdf-note-management/command/CreateFocusableStripCommand.ts";
import { UpdateFocusableStripCommand } from "../src/bounded-contexts/pdf-note-management/command/UpdateFocusableStripCommand.ts";
import { DeleteFocusableStripCommand } from "../src/bounded-contexts/pdf-note-management/command/DeleteFocusableStripCommand.ts";
import { DeletePdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/DeletePdfDocumentCommand.ts";
import { ImportPdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/ImportPdfDocumentCommand.ts";
import { RenamePdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/RenamePdfDocumentCommand.ts";
import { SessionHistory } from "../src/bounded-contexts/pdf-note-management/history/SessionHistory.ts";
import { isExistingFile, trashedLibraryPath } from "../src/common/library.ts";
import { createPrismaClient } from "../src/infrastructure/prisma/client.ts";
import { applyMigrations } from "../src/infrastructure/prisma/migrate.ts";
import { PrismaUnitOfWork } from "../src/infrastructure/prisma/unitOfWork.ts";

const root = mkdtempSync(join(tmpdir(), "pdf-history-"));
const databasePath = join(root, "database.db");
process.env.DATABASE_URL = `file:${databasePath}`;

const db = createPrismaClient(databasePath);
const unitOfWork = new PrismaUnitOfWork(db);
const container = new Container();
container.registerValue(TRANSACTION_RUNNER, unitOfWork);
container.registerValue(AUDIT_WRITER, new MemoryAuditWriter());
container.registerValue(PrismaUnitOfWork, unitOfWork);
const cqrs = createCqrsModule({
  container,
  components: PDF_NOTE_MANAGEMENT_COMPONENTS,
  strictDomainTypes: true,
});
const history = container.resolve(SessionHistory);

async function seedDocument(name: string, ordering: number) {
  return db.pdf_document.create({
    data: {
      name,
      file_path: join(root, `${name}.pdf`),
      ordering,
      created_at: Date.now(),
    },
  });
}

describe("session history", () => {
  beforeAll(() => {
    applyMigrations(databasePath);
  });

  beforeEach(() => {
    history.clear();
  });

  afterAll(async () => {
    await db.$disconnect();
    rmSync(root, { recursive: true, force: true });
  });

  test("an empty stack refuses undo and redo", async () => {
    await expect(cqrs.commandBus.send(new ApplyHistoryCommand("undo"))).rejects.toThrow("Nothing to undo");
    await expect(cqrs.commandBus.send(new ApplyHistoryCommand("redo"))).rejects.toThrow("Nothing to redo");
  });

  test("rename then undo restores the previous name and the same id", async () => {
    const document = await seedDocument("Chapter 1", 0);

    await cqrs.commandBus.send(new RenamePdfDocumentCommand(document.id, "Chapter 2"));
    expect(history.peek("undo")?.label).toBe("Rename document");

    const undone = await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    expect(undone).toEqual({ label: "Rename document", canUndo: false, canRedo: true });
    const restored = await db.pdf_document.findUnique({ where: { id: document.id } });
    expect(restored?.name).toBe("Chapter 1");

    await cqrs.commandBus.send(new ApplyHistoryCommand("redo"));
    const redone = await db.pdf_document.findUnique({ where: { id: document.id } });
    expect(redone?.name).toBe("Chapter 2");

    await db.pdf_document.delete({ where: { id: document.id } });
  });

  test("a new command drops the redo stack", async () => {
    const document = await seedDocument("Notes", 0);
    await cqrs.commandBus.send(new RenamePdfDocumentCommand(document.id, "First"));
    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    expect(history.peek("redo")?.label).toBe("Rename document");

    await cqrs.commandBus.send(new RenamePdfDocumentCommand(document.id, "Second"));
    expect(history.peek("redo")).toBeUndefined();
    await expect(cqrs.commandBus.send(new ApplyHistoryCommand("redo"))).rejects.toThrow("Nothing to redo");

    await db.pdf_document.delete({ where: { id: document.id } });
  });

  test("undo of a new strip removes the strip and the folder that save opened", async () => {
    const document = await seedDocument("New strip", 2);
    const created = await cqrs.commandBus.send(new CreateFocusableStripCommand({
      pdf_document_id: document.id,
      page_number: 1,
      top: 10,
      height: 20,
      left: 0,
      width: 100,
      page_width: 600,
      page_height: 800,
      remark: "first",
    }));
    const folderId = (await db.focusable_strip.findUnique({ where: { id: created.id } }))?.folder_id;
    expect(folderId).not.toBeNull();
    expect(history.peek("undo")?.label).toBe("Create strip");

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    expect(await db.focusable_strip.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await db.folder.findUnique({ where: { id: folderId! } })).toBeNull();

    await cqrs.commandBus.send(new ApplyHistoryCommand("redo"));
    const restored = await db.focusable_strip.findUnique({ where: { id: created.id } });
    expect(restored?.id).toBe(created.id);
    expect(restored?.folder_id).toBe(folderId);
    expect(restored?.remark).toBe("first");

    await db.pdf_document.delete({ where: { id: document.id } });
  });

  test("delete a strip, then undo, inserts that same row", async () => {
    const document = await seedDocument("Strips", 1);
    const created = await cqrs.commandBus.send(new CreateFocusableStripCommand({
      pdf_document_id: document.id,
      page_number: 1,
      top: 10,
      height: 20,
      left: 0,
      width: 100,
      page_width: 600,
      page_height: 800,
      remark: "kept",
    }));
    const filed = await db.focusable_strip.findUnique({ where: { id: created.id } });
    expect(filed?.folder_id).not.toBeNull();

    await cqrs.commandBus.send(new DeleteFocusableStripCommand(created.id));
    expect(await db.focusable_strip.findUnique({ where: { id: created.id } })).toBeNull();

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    const restored = await db.focusable_strip.findUnique({ where: { id: created.id } });
    expect(restored?.remark).toBe("kept");
    expect(restored?.id).toBe(created.id);

    await db.pdf_document.delete({ where: { id: document.id } });
  });

  test("undo of a highlight restores the unmarked preview", async () => {
    const document = await seedDocument("Marks", 3);
    const created = await cqrs.commandBus.send(new CreateFocusableStripCommand({
      pdf_document_id: document.id,
      page_number: 1,
      top: 10,
      height: 20,
      left: 0,
      width: 100,
      page_width: 600,
      page_height: 800,
      remark: "kept",
    }));
    const marks = JSON.stringify([{ x0: 10, x1: 80, y: 20, size: 12 }]);
    await cqrs.commandBus.send(new UpdateFocusableStripCommand(created.id, { highlights: marks }));
    expect(history.peek("undo")?.label).toBe("Highlight");

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    const unmarked = await db.highlight.findMany({ where: { pdf_document_id: document.id } });
    expect(unmarked).toEqual([]);

    await cqrs.commandBus.send(new ApplyHistoryCommand("redo"));
    const restored = await db.highlight.findMany({
      where: { pdf_document_id: document.id, page_number: 1 },
      orderBy: { id: "asc" },
    });
    expect(restored.map(({ x0, x1, y, size }) => ({ x0, x1, y, size }))).toEqual([
      { x0: 10, x1: 80, y: 20, size: 12 },
    ]);

    await db.pdf_document.delete({ where: { id: document.id } });
  });

  test("import shifts ordering; undo deletes the new document and restores the old order", async () => {
    const existing = await seedDocument("Already", 0);
    const source = join(root, "incoming.pdf");
    writeFileSync(source, "%PDF-1.4\n%%EOF\n");

    const imported = await cqrs.commandBus.send(new ImportPdfDocumentCommand({
      source_paths: [source],
      name: "Incoming",
    }));
    const created = imported[0]!;
    expect(created.id).not.toBe(existing.id);
    const shifted = await db.pdf_document.findUnique({ where: { id: existing.id } });
    expect(shifted?.ordering).toBe(1);
    expect(created.ordering).toBe(0);

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    expect(await db.pdf_document.findUnique({ where: { id: created.id } })).toBeNull();
    const back = await db.pdf_document.findUnique({ where: { id: existing.id } });
    expect(back?.ordering).toBe(0);
    expect(await isExistingFile(trashedLibraryPath(created.file_path))).toBe(true);

    await cqrs.commandBus.send(new ApplyHistoryCommand("redo"));
    const again = await db.pdf_document.findUnique({ where: { id: created.id } });
    expect(again?.name).toBe("Incoming");
    expect(again?.ordering).toBe(0);
    expect(await isExistingFile(created.file_path)).toBe(true);

    await db.pdf_document.deleteMany({ where: { id: { in: [existing.id, created.id] } } });
  });

  test("delete a document moves the file to trash; undo puts the file and the row back", async () => {
    const source = join(root, "bound.pdf");
    writeFileSync(source, "%PDF-1.4\n%%EOF\n");
    const imported = await cqrs.commandBus.send(new ImportPdfDocumentCommand({
      source_paths: [source],
      name: "Bound",
    }));
    const document = imported[0]!;
    history.clear();

    await cqrs.commandBus.send(new DeletePdfDocumentCommand(document.id));
    expect(await db.pdf_document.findUnique({ where: { id: document.id } })).toBeNull();
    expect(await isExistingFile(document.file_path)).toBe(false);
    expect(await isExistingFile(trashedLibraryPath(document.file_path))).toBe(true);

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    const restored = await db.pdf_document.findUnique({ where: { id: document.id } });
    expect(restored?.name).toBe("Bound");
    expect(await isExistingFile(document.file_path)).toBe(true);
    expect(await isExistingFile(trashedLibraryPath(document.file_path))).toBe(false);

    await db.pdf_document.delete({ where: { id: document.id } });
  });
});
