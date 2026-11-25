/**
 * The tag catalogue and the assignment junction, against a real database.
 *
 * These are the rules a reader can observe: a folder groups tags without owning
 * them, a tag exists whether or not a document carries it, assigning writes one
 * `assigned_pdf_tag` plus one junction row, and unassigning deletes the
 * assignment (the junction cascades). The reference project's
 * `assigned_tag` / `rel_shellscript_tag` pair is what this file checks.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AUDIT_WRITER, Container, MemoryAuditWriter, TRANSACTION_RUNNER, createCqrsModule } from "@machingclee/express-cqrs";
import { PDF_FOCUS_VIEWER_COMPONENTS } from "../src/bounded-contexts/components.ts";
import { AssignPdfTagsCommand } from "../src/bounded-contexts/pdf-tag-management/command/AssignPdfTagsCommand.ts";
import { CreatePdfTagCommand } from "../src/bounded-contexts/pdf-tag-management/command/CreatePdfTagCommand.ts";
import { CopyPdfTagsCommand } from "../src/bounded-contexts/pdf-tag-management/command/CopyPdfTagsCommand.ts";
import { CreatePdfTagFolderCommand } from "../src/bounded-contexts/pdf-tag-management/command/CreatePdfTagFolderCommand.ts";
import { DeletePdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/DeletePdfDocumentCommand.ts";
import { DeletePdfTagCommand } from "../src/bounded-contexts/pdf-tag-management/command/DeletePdfTagCommand.ts";
import { DeletePdfTagFolderCommand } from "../src/bounded-contexts/pdf-tag-management/command/DeletePdfTagFolderCommand.ts";
import { ReorderPdfTagFoldersCommand } from "../src/bounded-contexts/pdf-tag-management/command/ReorderPdfTagFoldersCommand.ts";
import { UnassignPdfTagsCommand } from "../src/bounded-contexts/pdf-tag-management/command/UnassignPdfTagsCommand.ts";
import { UpdatePdfTagCommand } from "../src/bounded-contexts/pdf-tag-management/command/UpdatePdfTagCommand.ts";
import { ListPdfDocumentsQuery } from "../src/bounded-contexts/pdf-note-management/query/ListPdfDocumentsQuery.ts";
import { ListPdfTagFoldersQuery } from "../src/bounded-contexts/pdf-tag-management/query/ListPdfTagFoldersQuery.ts";
import { ListPdfTagsQuery } from "../src/bounded-contexts/pdf-tag-management/query/ListPdfTagsQuery.ts";
import { createPrismaClient } from "../src/infrastructure/prisma/client.ts";
import { applyMigrations } from "../src/infrastructure/prisma/migrate.ts";
import { PrismaUnitOfWork } from "../src/infrastructure/prisma/unitOfWork.ts";

const root = mkdtempSync(join(tmpdir(), "pdf-tags-"));
const databasePath = join(root, "database.db");
process.env.DATABASE_URL = `file:${databasePath}`;

const db = createPrismaClient(databasePath);
const unitOfWork = new PrismaUnitOfWork(db);
const container = new Container();
const audit = new MemoryAuditWriter();
container.registerValue(TRANSACTION_RUNNER, unitOfWork);
container.registerValue(AUDIT_WRITER, audit);
container.registerValue(PrismaUnitOfWork, unitOfWork);
const cqrs = createCqrsModule({
  container,
  components: PDF_FOCUS_VIEWER_COMPONENTS,
  strictDomainTypes: true,
});

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

const createFolder = (name: string) =>
  cqrs.commandBus.send(new CreatePdfTagFolderCommand({ name }));

const createTag = (name: string, pdf_tag_folder_id: number | null = null) =>
  cqrs.commandBus.send(new CreatePdfTagCommand({ name, pdf_tag_folder_id }));

describe("pdf tags", () => {
  beforeAll(() => {
    applyMigrations(databasePath);
  });

  beforeEach(async () => {
    await db.assigned_pdf_tag.deleteMany();
    await db.pdf_tag.deleteMany();
    await db.pdf_tag_folder.deleteMany();
    await db.pdf_document.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
    rmSync(root, { recursive: true, force: true });
  });

  describe("tag folders", () => {
    test("are appended in order with a normalized name", async () => {
      const topics = await createFolder("  Topics  ");
      const languages = await createFolder("Languages");

      expect(topics.name).toBe("Topics");
      expect(topics.ordering).toBe(0);
      expect(languages.ordering).toBe(1);
    });

    test("refuse a name that only differs in case", async () => {
      await createFolder("Topics");
      await expect(createFolder("topics")).rejects.toThrow(/already exists/);
    });

    test("record the history step after the write, not before it", async () => {
      audit.batches.length = 0;

      await createFolder("Audited");

      const batch = audit.batches.at(-1);
      expect(batch?.committed).toBe(true);
      // The command, its own event, then the transactional history event that
      // the post-commit listener turns into an undo step.
      expect(batch?.records.map((row) => row.type)).toEqual([
        "CreatePdfTagFolderCommand",
        "PdfTagFolderCreatedEvent",
        "HistoryUndoRedoReadyEvent",
      ]);
      expect(batch?.records.at(-1)?.payload).toContain('"label":"Create tag folder"');
    });

    test("reorder takes a permutation and keeps the order dense", async () => {
      const first = await createFolder("First");
      const second = await createFolder("Second");
      const third = await createFolder("Third");

      const folders = await cqrs.commandBus.send(
        new ReorderPdfTagFoldersCommand({ pdf_tag_folder_ids: [third.id, first.id, second.id] }),
      );
      expect(folders.map((folder) => folder.id)).toEqual([third.id, first.id, second.id]);

      await expect(
        cqrs.commandBus.send(new ReorderPdfTagFoldersCommand({ pdf_tag_folder_ids: [first.id] })),
      ).rejects.toThrow(/must list every tag folder once/);
    });

    test("delete refuses a folder that still holds tags", async () => {
      const folder = await createFolder("Languages");
      const tag = await createTag("Rust", folder.id);

      await expect(
        cqrs.commandBus.send(new DeletePdfTagFolderCommand(folder.id)),
      ).rejects.toThrow(/Only an empty tag folder can be deleted/);

      // The refusal rolled the transaction back: the folder and its tag are
      // still there, and the tag is still inside it.
      const stored = await db.pdf_tag.findUnique({ where: { id: tag.id } });
      expect(stored?.pdf_tag_folder_id).toBe(folder.id);
      const remaining = await cqrs.queryBus.send(new ListPdfTagFoldersQuery());
      expect(remaining.map((entry) => entry.id)).toEqual([folder.id]);
    });

    test("an emptied folder deletes and the rest renumber", async () => {
      const first = await createFolder("First");
      const second = await createFolder("Second");
      const third = await createFolder("Third");
      const tag = await createTag("Rust", second.id);
      await cqrs.commandBus.send(new UpdatePdfTagCommand(tag.id, { pdf_tag_folder_id: null }));

      await cqrs.commandBus.send(new DeletePdfTagFolderCommand(second.id));

      const stored = await db.pdf_tag.findUnique({ where: { id: tag.id } });
      expect(stored?.pdf_tag_folder_id).toBeNull();
      const remaining = await cqrs.queryBus.send(new ListPdfTagFoldersQuery());
      expect(remaining.map((folder) => [folder.id, folder.ordering])).toEqual([
        [first.id, 0],
        [third.id, 1],
      ]);
    });
  });

  describe("tags", () => {
    test("move between folders and back to Ungrouped", async () => {
      const languages = await createFolder("Languages");
      const topics = await createFolder("Topics");
      const tag = await createTag("Rust", languages.id);

      const moved = await cqrs.commandBus.send(
        new UpdatePdfTagCommand(tag.id, { pdf_tag_folder_id: topics.id }),
      );
      expect(moved.pdf_tag_folder_id).toBe(topics.id);

      // `null` is a value: it moves the tag to Ungrouped. Omitting the key would
      // have left the folder alone.
      const ungrouped = await cqrs.commandBus.send(
        new UpdatePdfTagCommand(tag.id, { pdf_tag_folder_id: null }),
      );
      expect(ungrouped.pdf_tag_folder_id).toBeNull();
    });

    test("rename keeps the identity and refuses a case-insensitive clash", async () => {
      const tag = await createTag("Rust");
      const renamed = await cqrs.commandBus.send(
        new UpdatePdfTagCommand(tag.id, { name: "Rustacean" }),
      );
      expect(renamed.name).toBe("Rustacean");
      expect(renamed.id).toBe(tag.id);

      await createTag("Go");
      await expect(
        cqrs.commandBus.send(new UpdatePdfTagCommand(tag.id, { name: "go" })),
      ).rejects.toThrow(/already exists/);
    });

    test("the catalogue reports how many documents carry a tag", async () => {
      const tag = await createTag("Rust");
      const document = await seedDocument("Doc", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [tag.id]));

      const [listed] = await cqrs.queryBus.send(new ListPdfTagsQuery());
      expect(listed?.id).toBe(tag.id);
      expect(listed?.document_count).toBe(1);
    });
  });

  describe("assignment", () => {
    test("writes one assigned row and one junction row per tag", async () => {
      const folder = await createFolder("Languages");
      const rust = await createTag("Rust", folder.id);
      const go = await createTag("Go");
      const document = await seedDocument("Doc", 0);

      const tags = await cqrs.commandBus.send(
        new AssignPdfTagsCommand(document.id, [rust.id, go.id]),
      );
      expect(tags.map((tag) => tag.id)).toEqual([rust.id, go.id]);

      expect(await db.assigned_pdf_tag.count()).toBe(2);
      expect(
        await db.rel_pdf_document_assigned_pdf_tag.count({
          where: { pdf_document_id: document.id },
        }),
      ).toBe(2);
    });

    test("is idempotent and collapses repeated ids", async () => {
      const tag = await createTag("Rust");
      const document = await seedDocument("Doc", 0);

      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [tag.id, tag.id]));
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [tag.id]));

      expect(await db.assigned_pdf_tag.count()).toBe(1);
      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(1);
    });

    test("refuses an unknown tag or document", async () => {
      const tag = await createTag("Rust");
      const document = await seedDocument("Doc", 0);

      await expect(
        cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [tag.id + 999])),
      ).rejects.toThrow(/does not exist/);
      await expect(
        cqrs.commandBus.send(new AssignPdfTagsCommand(document.id + 999, [tag.id])),
      ).rejects.toThrow(/does not exist/);
    });

    test("unassign deletes the assignment and its junction, and repeats harmlessly", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const document = await seedDocument("Doc", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id, go.id]));

      const remaining = await cqrs.commandBus.send(
        new UnassignPdfTagsCommand(document.id, [rust.id]),
      );
      expect(remaining.map((tag) => tag.id)).toEqual([go.id]);
      expect(await db.assigned_pdf_tag.count()).toBe(1);
      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(1);

      await cqrs.commandBus.send(new UnassignPdfTagsCommand(document.id, [rust.id]));
      expect(await db.assigned_pdf_tag.count()).toBe(1);
    });

    test("copy replaces the target's tags with the source's", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const draft = await createTag("Draft");
      const source = await seedDocument("Source", 0);
      const target = await seedDocument("Target", 1);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(source.id, [rust.id, go.id]));
      await cqrs.commandBus.send(new AssignPdfTagsCommand(target.id, [go.id, draft.id]));

      const tags = await cqrs.commandBus.send(new CopyPdfTagsCommand(source.id, target.id));
      // Catalogue order, by name: "Go" before "Rust".
      expect(tags.map((tag) => tag.name)).toEqual(["Go", "Rust"]);

      // Exactly the source's tags: the one they shared kept its row, the one only
      // the target carried is gone.
      expect(
        await db.rel_pdf_document_assigned_pdf_tag.count({ where: { pdf_document_id: target.id } }),
      ).toBe(2);
      // Four assignments remain: two per document, the shared tag kept twice
      // because an assignment belongs to one document.
      expect(await db.assigned_pdf_tag.count()).toBe(4);
      expect(await db.assigned_pdf_tag.count({ where: { pdf_tag_id: draft.id } })).toBe(0);
    });

    test("copy onto a document with no tags only adds", async () => {
      const rust = await createTag("Rust");
      const source = await seedDocument("Source", 0);
      const target = await seedDocument("Target", 1);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(source.id, [rust.id]));

      const tags = await cqrs.commandBus.send(new CopyPdfTagsCommand(source.id, target.id));
      expect(tags.map((tag) => tag.id)).toEqual([rust.id]);
      expect(await db.assigned_pdf_tag.count()).toBe(2);
    });

    test("copy is idempotent and onto itself changes nothing", async () => {
      const rust = await createTag("Rust");
      const source = await seedDocument("Source", 0);
      const target = await seedDocument("Target", 1);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(source.id, [rust.id]));

      await cqrs.commandBus.send(new CopyPdfTagsCommand(source.id, target.id));
      const before = await db.rel_pdf_document_assigned_pdf_tag.count();
      await cqrs.commandBus.send(new CopyPdfTagsCommand(source.id, target.id));
      await cqrs.commandBus.send(new CopyPdfTagsCommand(source.id, source.id));

      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(before);
    });

    test("copy takes the source's tags as they are now, not when they were copied", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const source = await seedDocument("Source", 0);
      const target = await seedDocument("Target", 1);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(source.id, [rust.id]));
      await cqrs.commandBus.send(new AssignPdfTagsCommand(source.id, [go.id]));

      const tags = await cqrs.commandBus.send(new CopyPdfTagsCommand(source.id, target.id));
      expect(tags.map((tag) => tag.name)).toEqual(["Go", "Rust"]);
      expect(await db.rel_pdf_document_assigned_pdf_tag.count({ where: { pdf_document_id: target.id } }))
        .toBe(2);
    });

    test("copy refuses an unknown source or target", async () => {
      const rust = await createTag("Rust");
      const document = await seedDocument("Doc", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id]));

      await expect(
        cqrs.commandBus.send(new CopyPdfTagsCommand(document.id + 999, document.id)),
      ).rejects.toThrow(/does not exist/);
      await expect(
        cqrs.commandBus.send(new CopyPdfTagsCommand(document.id, document.id + 999)),
      ).rejects.toThrow(/does not exist/);
      // Nothing was written by either refusal.
      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(1);
    });

    test("the document list carries its tags in catalogue order", async () => {
      const folder = await createFolder("Languages");
      const folderTag = await createTag("Rust", folder.id);
      const ungrouped = await createTag("Zebra");
      const document = await seedDocument("Doc", 0);
      await cqrs.commandBus.send(
        new AssignPdfTagsCommand(document.id, [ungrouped.id, folderTag.id]),
      );

      const listed = await cqrs.queryBus.send(new ListPdfDocumentsQuery());
      const row = listed.find((entry) => entry.id === document.id);
      expect(row?.tags.map((tag) => tag.name)).toEqual(["Rust", "Zebra"]);
    });

    test("deleting a document leaves only its own assignment rows gone", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const doomed = await seedDocument("Doomed", 0);
      const kept = await seedDocument("Kept", 1);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(doomed.id, [rust.id, go.id]));
      await cqrs.commandBus.send(new AssignPdfTagsCommand(kept.id, [rust.id]));

      await cqrs.commandBus.send(new DeletePdfDocumentCommand(doomed.id));

      // `PdfTagPolicy` reacted to the delete with `DeleteAssignedPdfTagsCommand`:
      // the two rows the deleted document owned are gone, and nothing else is.
      expect(await db.assigned_pdf_tag.count()).toBe(1);
      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(1);
      const listed = await cqrs.queryBus.send(new ListPdfTagsQuery());
      expect(listed.map((tag) => [tag.name, tag.document_count])).toEqual([
        ["Go", 0],
        ["Rust", 1],
      ]);
    });

    test("delete refuses a tag a document still carries", async () => {
      const rust = await createTag("Rust");
      const document = await seedDocument("Doc", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id]));

      await expect(
        cqrs.commandBus.send(new DeletePdfTagCommand(rust.id)),
      ).rejects.toThrow(/Only an unused tag can be deleted/);

      // Nothing was deleted: the tag, its assignment and the junction survive.
      expect(await db.pdf_tag.count()).toBe(1);
      expect(await db.assigned_pdf_tag.count()).toBe(1);
      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(1);
    });

    test("an unused tag deletes without disturbing the remaining assignments", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const document = await seedDocument("Doc", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id, go.id]));
      await cqrs.commandBus.send(new UnassignPdfTagsCommand(document.id, [rust.id]));

      await cqrs.commandBus.send(new DeletePdfTagCommand(rust.id));

      expect(await db.assigned_pdf_tag.count()).toBe(1);
      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(1);
      const [listed] = await cqrs.queryBus.send(new ListPdfTagsQuery());
      expect(listed?.id).toBe(go.id);
      expect(listed?.document_count).toBe(1);
    });
  });
});

/**
 * The split itself, checked against the graph the decorators build.
 *
 * Moving a file is easy; moving the `@BoundedContext` with it is what makes the
 * catalogue a context of its own. A class left annotated with the notes context
 * would pass every other test in this file.
 */
describe("bounded contexts", () => {
  const tagContext = "PDF Tag Management";
  const noteContext = "PDF Note Management";

  test("tag nodes report the tag context and document nodes the notes context", () => {
    const flow = cqrs.flow();

    const tagCommands = flow.commands.filter((command) => command.name.includes("PdfTag"));
    expect(tagCommands.length).toBeGreaterThan(0);
    expect(tagCommands.every((command) => command.context === tagContext)).toBe(true);
    expect(flow.commands.find((command) => command.name === "DeletePdfDocumentCommand")?.context)
      .toBe(noteContext);

    const tagQueries = flow.queries.filter((query) => query.name.includes("PdfTag"));
    expect(tagQueries.map((query) => query.name).sort()).toEqual([
      "ListPdfTagFoldersQuery",
      "ListPdfTagsQuery",
    ]);
    expect(tagQueries.every((query) => query.context === tagContext)).toBe(true);

    const tagEvents = flow.events.filter((event) => event.name.match(/PdfTag|AssignedPdfTags/));
    expect(tagEvents.length).toBeGreaterThan(0);
    expect(tagEvents.every((event) => event.context === tagContext)).toBe(true);
    expect(flow.events.find((event) => event.name === "PdfDocumentDeletedEvent")?.context)
      .toBe(noteContext);
  });

  test("the document delete cleans up through a tag-context policy reaction", () => {
    const flow = cqrs.flow();
    const cleanup = flow.policies
      .find((policy) => policy.name === "PdfTagPolicy")
      ?.listeners?.find((listener) => listener.event === "PdfDocumentDeletedEvent");

    expect(cleanup?.sends).toEqual(["DeleteAssignedPdfTagsCommand"]);
    expect(cleanup?.rules).toEqual(["A deleted document takes its tag assignments with it"]);
  });

  test("every reader tag command records an undo step after its transaction commits", () => {
    const flow = cqrs.flow();
    const readerCommands = [
      "AssignPdfTagsCommand",
      "CopyPdfTagsCommand",
      "CreatePdfTagCommand",
      "CreatePdfTagFolderCommand",
      "DeletePdfTagCommand",
      "DeletePdfTagFolderCommand",
      "RenamePdfTagFolderCommand",
      "ReorderPdfTagFoldersCommand",
      "UnassignPdfTagsCommand",
      "UpdatePdfTagCommand",
    ];

    for (const name of readerCommands) {
      const command = flow.commands.find((entry) => entry.name === name);
      expect(command?.context).toBe(tagContext);
      expect(command?.emits).toContain("HistoryUndoRedoReadyEvent");
      // Transactional: the step reaches the stack only after the write commits,
      // so a policy refusal leaves no undo behind.
      expect(command?.postCommitEmits).toContain("HistoryUndoRedoReadyEvent");
    }
  });
});
