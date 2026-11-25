/**
 * Session undo and redo: the in-memory stack, and the commands it sends back
 * through the bus once a change has committed.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AUDIT_WRITER, Container, MemoryAuditWriter, TRANSACTION_RUNNER, createCqrsModule } from "@machingclee/express-cqrs";
import { PDF_FOCUS_VIEWER_COMPONENTS } from "../src/bounded-contexts/components.ts";
import { ApplyHistoryCommand } from "../src/bounded-contexts/history-management/command/ApplyHistoryCommand.ts";
import { CreateFocusableStripCommand } from "../src/bounded-contexts/pdf-note-management/command/CreateFocusableStripCommand.ts";
import { UpdateFocusableStripCommand } from "../src/bounded-contexts/pdf-note-management/command/UpdateFocusableStripCommand.ts";
import { DeleteFocusableStripCommand } from "../src/bounded-contexts/pdf-note-management/command/DeleteFocusableStripCommand.ts";
import { DeletePdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/DeletePdfDocumentCommand.ts";
import { ImportPdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/ImportPdfDocumentCommand.ts";
import { RenamePdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/RenamePdfDocumentCommand.ts";
import { SessionHistory } from "../src/bounded-contexts/history-management/service/SessionHistory.ts";
import { AssignPdfTagsCommand } from "../src/bounded-contexts/pdf-tag-management/command/AssignPdfTagsCommand.ts";
import { CopyPdfTagsCommand } from "../src/bounded-contexts/pdf-tag-management/command/CopyPdfTagsCommand.ts";
import { CreatePdfTagCommand } from "../src/bounded-contexts/pdf-tag-management/command/CreatePdfTagCommand.ts";
import { CreatePdfTagFolderCommand } from "../src/bounded-contexts/pdf-tag-management/command/CreatePdfTagFolderCommand.ts";
import { DeletePdfTagCommand } from "../src/bounded-contexts/pdf-tag-management/command/DeletePdfTagCommand.ts";
import { DeletePdfTagFolderCommand } from "../src/bounded-contexts/pdf-tag-management/command/DeletePdfTagFolderCommand.ts";
import { RenamePdfTagFolderCommand } from "../src/bounded-contexts/pdf-tag-management/command/RenamePdfTagFolderCommand.ts";
import { ReorderPdfTagFoldersCommand } from "../src/bounded-contexts/pdf-tag-management/command/ReorderPdfTagFoldersCommand.ts";
import { UnassignPdfTagsCommand } from "../src/bounded-contexts/pdf-tag-management/command/UnassignPdfTagsCommand.ts";
import { UpdatePdfTagCommand } from "../src/bounded-contexts/pdf-tag-management/command/UpdatePdfTagCommand.ts";
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
  components: PDF_FOCUS_VIEWER_COMPONENTS,
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

  /* ── the tag catalogue ──────────────────────────────────────
     Every command of the tag context records the command that undoes it, so a
     tag rename or a paste is the same one stack as a strip. The collection is a
     context of its own, but the reader has one undo. */

  describe("tag history", () => {
    const createFolder = (name: string) =>
      cqrs.commandBus.send(new CreatePdfTagFolderCommand({ name }));

    const createTag = (name: string, pdf_tag_folder_id: number | null = null) =>
      cqrs.commandBus.send(new CreatePdfTagCommand({ name, pdf_tag_folder_id }));

    const tagIdsOn = async (documentId: number): Promise<number[]> => {
      const links = await db.rel_pdf_document_assigned_pdf_tag.findMany({
        where: { pdf_document_id: documentId },
        include: { assigned_pdf_tag: { select: { pdf_tag_id: true } } },
      });
      return links
        .map((link) => link.assigned_pdf_tag.pdf_tag_id)
        .sort((left, right) => left - right);
    };

    const folderOrder = async (): Promise<number[]> => {
      const folders = await db.pdf_tag_folder.findMany({
        orderBy: [{ ordering: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      return folders.map((folder) => folder.id);
    };

    const undo = () => cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    const redo = () => cqrs.commandBus.send(new ApplyHistoryCommand("redo"));

    beforeEach(async () => {
      await db.rel_pdf_document_assigned_pdf_tag.deleteMany();
      await db.assigned_pdf_tag.deleteMany();
      await db.pdf_tag.deleteMany();
      await db.pdf_tag_folder.deleteMany();
      await db.pdf_document.deleteMany();
    });

    test("create a folder, undo removes it, redo restores the same row", async () => {
      const folder = await createFolder("Topics");
      expect(history.peek("undo")?.label).toBe("Create tag folder");
      // The step's payload is the opposite command, not a description of it.
      expect(history.peek("undo")?.undo).toBeInstanceOf(DeletePdfTagFolderCommand);

      await undo();
      expect(await db.pdf_tag_folder.findUnique({ where: { id: folder.id } })).toBeNull();

      await redo();
      const restored = await db.pdf_tag_folder.findUnique({ where: { id: folder.id } });
      expect(restored?.name).toBe("Topics");
      expect(restored?.ordering).toBe(folder.ordering);
    });

    test("rename a folder, undo and redo move the name both ways", async () => {
      const folder = await createFolder("Topics");

      await cqrs.commandBus.send(new RenamePdfTagFolderCommand(folder.id, "Subjects"));
      expect(history.peek("undo")?.label).toBe("Rename tag folder");
      await undo();
      expect((await db.pdf_tag_folder.findUnique({ where: { id: folder.id } }))?.name)
        .toBe("Topics");

      await redo();
      expect((await db.pdf_tag_folder.findUnique({ where: { id: folder.id } }))?.name)
        .toBe("Subjects");
    });

    test("reorder folders, undo puts the previous drag order back", async () => {
      const first = await createFolder("First");
      const second = await createFolder("Second");
      const third = await createFolder("Third");
      history.clear();

      await cqrs.commandBus.send(
        new ReorderPdfTagFoldersCommand({ pdf_tag_folder_ids: [third.id, first.id, second.id] }),
      );
      expect(history.peek("undo")?.label).toBe("Reorder tag folders");
      await undo();
      expect(await folderOrder()).toEqual([first.id, second.id, third.id]);

      await redo();
      expect(await folderOrder()).toEqual([third.id, first.id, second.id]);
    });

    test("delete a folder, undo restores its position, redo deletes it again", async () => {
      const first = await createFolder("First");
      const doomed = await createFolder("Second");
      const third = await createFolder("Third");
      history.clear();

      await cqrs.commandBus.send(new DeletePdfTagFolderCommand(doomed.id));
      expect(history.peek("undo")?.label).toBe("Delete tag folder");
      expect(await folderOrder()).toEqual([first.id, third.id]);

      await undo();
      expect(await folderOrder()).toEqual([first.id, doomed.id, third.id]);
      expect((await db.pdf_tag_folder.findUnique({ where: { id: doomed.id } }))?.name)
        .toBe("Second");

      await redo();
      expect(await db.pdf_tag_folder.findUnique({ where: { id: doomed.id } })).toBeNull();
      expect(await folderOrder()).toEqual([first.id, third.id]);
    });

    test("create a tag, undo removes it, redo restores the same id in its folder", async () => {
      const folder = await createFolder("Languages");
      const tag = await createTag("Rust", folder.id);
      expect(history.peek("undo")?.label).toBe("Create tag");

      await undo();
      expect(await db.pdf_tag.findUnique({ where: { id: tag.id } })).toBeNull();

      await redo();
      const restored = await db.pdf_tag.findUnique({ where: { id: tag.id } });
      expect(restored?.name).toBe("Rust");
      expect(restored?.pdf_tag_folder_id).toBe(folder.id);
    });

    test("edit a tag, undo restores its name and folder", async () => {
      const languages = await createFolder("Languages");
      const topics = await createFolder("Topics");
      const tag = await createTag("Rust", languages.id);
      history.clear();

      await cqrs.commandBus.send(
        new UpdatePdfTagCommand(tag.id, { name: "Rustacean", pdf_tag_folder_id: topics.id }),
      );
      expect(history.peek("undo")?.label).toBe("Edit tag");

      await undo();
      const back = await db.pdf_tag.findUnique({ where: { id: tag.id } });
      expect(back?.name).toBe("Rust");
      expect(back?.pdf_tag_folder_id).toBe(languages.id);

      await redo();
      const again = await db.pdf_tag.findUnique({ where: { id: tag.id } });
      expect(again?.name).toBe("Rustacean");
      expect(again?.pdf_tag_folder_id).toBe(topics.id);
    });

    test("delete a tag, undo inserts the same row, redo deletes it", async () => {
      const tag = await createTag("Rust");
      history.clear();

      await cqrs.commandBus.send(new DeletePdfTagCommand(tag.id));
      expect(history.peek("undo")?.label).toBe("Delete tag");
      expect(await db.pdf_tag.findUnique({ where: { id: tag.id } })).toBeNull();

      await undo();
      const restored = await db.pdf_tag.findUnique({ where: { id: tag.id } });
      expect(restored?.name).toBe("Rust");
      expect(restored?.name_lower).toBe("rust");

      await redo();
      expect(await db.pdf_tag.findUnique({ where: { id: tag.id } })).toBeNull();
    });

    test("assign tags, undo takes exactly the new rows off, redo puts them back", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const draft = await createTag("Draft");
      const document = await seedDocument("Assign undo", 0);
      // Start with one tag so undo has to keep what was already there.
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [draft.id]));
      history.clear();

      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id, go.id]));
      expect(history.peek("undo")?.label).toBe("Assign tags");
      await undo();
      expect(await tagIdsOn(document.id)).toEqual([draft.id]);

      await redo();
      expect(await tagIdsOn(document.id)).toEqual([rust.id, go.id, draft.id].sort((a, b) => a - b));
    });

    test("unassign tags, undo puts the same assignments back", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const document = await seedDocument("Unassign undo", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id, go.id]));
      history.clear();

      await cqrs.commandBus.send(new UnassignPdfTagsCommand(document.id, [rust.id]));
      expect(history.peek("undo")?.label).toBe("Unassign tags");
      await undo();
      expect(await tagIdsOn(document.id)).toEqual([rust.id, go.id].sort((a, b) => a - b));

      await redo();
      expect(await tagIdsOn(document.id)).toEqual([go.id]);
    });

    test("paste tags, undo restores the target's previous set", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const draft = await createTag("Draft");
      const source = await seedDocument("Paste source", 0);
      const target = await seedDocument("Paste target", 1);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(source.id, [rust.id, go.id]));
      await cqrs.commandBus.send(new AssignPdfTagsCommand(target.id, [go.id, draft.id]));
      history.clear();

      await cqrs.commandBus.send(new CopyPdfTagsCommand(source.id, target.id));
      expect(history.peek("undo")?.label).toBe("Paste tags");
      expect(await tagIdsOn(target.id)).toEqual([go.id, rust.id].sort((a, b) => a - b));

      await undo();
      expect(await tagIdsOn(target.id)).toEqual([draft.id, go.id].sort((a, b) => a - b));

      await redo();
      expect(await tagIdsOn(target.id)).toEqual([go.id, rust.id].sort((a, b) => a - b));
    });

    test("a refused delete records no step", async () => {
      const folder = await createFolder("Languages");
      await createTag("Rust", folder.id);
      history.clear();

      await expect(
        cqrs.commandBus.send(new DeletePdfTagFolderCommand(folder.id)),
      ).rejects.toThrow(/Only an empty tag folder can be deleted/);
      // The policy rolled the delete back, so its post-commit history event was
      // discarded with the transaction.
      expect(history.peek("undo")).toBeUndefined();
    });

    test("a command that changes nothing records no step", async () => {
      const rust = await createTag("Rust");
      const document = await seedDocument("Repeated assign", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id]));
      history.clear();

      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id]));
      expect(history.peek("undo")).toBeUndefined();
    });
  });
});

/**
 * The split itself, checked against the graph the decorators build.
 *
 * Moving the stack is easy; moving the `@BoundedContext` with it is what makes
 * history a context of its own. A class left annotated with the notes context
 * would pass every other test in this file.
 */
describe("history bounded context", () => {
  const historyContext = "History Management";
  const noteContext = "PDF Note Management";
  const tagContext = "PDF Tag Management";

  test("the stack's command and events report the history context", () => {
    const flow = cqrs.flow();

    expect(flow.commands.find((command) => command.name === "ApplyHistoryCommand")?.context)
      .toBe(historyContext);

    const historyEvents = flow.events.filter((event) =>
      event.name === "HistoryAppliedEvent" || event.name === "HistoryUndoRedoReadyEvent"
    );
    expect(historyEvents.map((event) => event.name).sort()).toEqual([
      "HistoryAppliedEvent",
      "HistoryUndoRedoReadyEvent",
    ]);
    expect(historyEvents.every((event) => event.context === historyContext)).toBe(true);

    expect(flow.policies.find((policy) => policy.name === "HistoryPolicy")?.listensTo).toEqual([
      "HistoryAppliedEvent",
      "HistoryUndoRedoReadyEvent",
    ]);
  });

  test("the notes and the tag catalogue emit a step they do not own", () => {
    const flow = cqrs.flow();

    const noteCommand = flow.commands.find((command) => command.name === "CreateFocusableStripCommand");
    const tagCommand = flow.commands.find((command) => command.name === "CreatePdfTagFolderCommand");
    expect(noteCommand?.context).toBe(noteContext);
    expect(tagCommand?.context).toBe(tagContext);
    // Both contexts record into the one stack, so both announce the step.
    expect(noteCommand?.emits).toContain("HistoryUndoRedoReadyEvent");
    expect(tagCommand?.emits).toContain("HistoryUndoRedoReadyEvent");
    expect(
      flow.events.find((event) => event.name === "HistoryUndoRedoReadyEvent")?.context,
    ).toBe(historyContext);
  });
});
