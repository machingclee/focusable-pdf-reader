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
import { PDF_NOTE_MANAGEMENT_COMPONENTS } from "../src/bounded-contexts/components.ts";
import { AssignPdfTagsCommand } from "../src/bounded-contexts/pdf-note-management/command/AssignPdfTagsCommand.ts";
import { CreatePdfTagCommand } from "../src/bounded-contexts/pdf-note-management/command/CreatePdfTagCommand.ts";
import { CreatePdfTagFolderCommand } from "../src/bounded-contexts/pdf-note-management/command/CreatePdfTagFolderCommand.ts";
import { DeletePdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/DeletePdfDocumentCommand.ts";
import { DeletePdfTagCommand } from "../src/bounded-contexts/pdf-note-management/command/DeletePdfTagCommand.ts";
import { DeletePdfTagFolderCommand } from "../src/bounded-contexts/pdf-note-management/command/DeletePdfTagFolderCommand.ts";
import { ReorderPdfTagFoldersCommand } from "../src/bounded-contexts/pdf-note-management/command/ReorderPdfTagFoldersCommand.ts";
import { UnassignPdfTagsCommand } from "../src/bounded-contexts/pdf-note-management/command/UnassignPdfTagsCommand.ts";
import { UpdatePdfTagCommand } from "../src/bounded-contexts/pdf-note-management/command/UpdatePdfTagCommand.ts";
import { ListPdfDocumentsQuery } from "../src/bounded-contexts/pdf-note-management/query/ListPdfDocumentsQuery.ts";
import { ListPdfTagFoldersQuery } from "../src/bounded-contexts/pdf-note-management/query/ListPdfTagFoldersQuery.ts";
import { ListPdfTagsQuery } from "../src/bounded-contexts/pdf-note-management/query/ListPdfTagsQuery.ts";
import { createPrismaClient } from "../src/infrastructure/prisma/client.ts";
import { applyMigrations } from "../src/infrastructure/prisma/migrate.ts";
import { PrismaUnitOfWork } from "../src/infrastructure/prisma/unitOfWork.ts";

const root = mkdtempSync(join(tmpdir(), "pdf-tags-"));
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

    test("delete keeps its tags and renumbers the rest", async () => {
      const first = await createFolder("First");
      const second = await createFolder("Second");
      const third = await createFolder("Third");
      const tag = await createTag("Rust", second.id);

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

    test("deleting a document leaves no assignment rows behind", async () => {
      const tag = await createTag("Rust");
      const document = await seedDocument("Doc", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [tag.id]));

      await cqrs.commandBus.send(new DeletePdfDocumentCommand(document.id));

      expect(await db.assigned_pdf_tag.count()).toBe(0);
      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(0);
    });

    test("deleting a tag cascades its assignments and their junctions", async () => {
      const rust = await createTag("Rust");
      const go = await createTag("Go");
      const document = await seedDocument("Doc", 0);
      await cqrs.commandBus.send(new AssignPdfTagsCommand(document.id, [rust.id, go.id]));

      await cqrs.commandBus.send(new DeletePdfTagCommand(rust.id));

      expect(await db.assigned_pdf_tag.count()).toBe(1);
      expect(await db.rel_pdf_document_assigned_pdf_tag.count()).toBe(1);
      const [listed] = await cqrs.queryBus.send(new ListPdfTagsQuery());
      expect(listed?.document_count).toBe(1);
    });
  });
});
