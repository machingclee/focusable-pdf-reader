/**
 * Document folders group PDFs many-to-many. A folder may be deleted only when
 * it is empty. Assigning adds a membership and does not take the document out
 * of another folder. A document with no membership is Ungrouped, which is not
 * a row, so creating the tables does not file existing documents.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AUDIT_WRITER, Container, MemoryAuditWriter, TRANSACTION_RUNNER, createCqrsModule } from "@machingclee/express-cqrs";
import { PDF_FOCUS_VIEWER_COMPONENTS } from "../src/bounded-contexts/components.ts";
import { AssignPdfDocumentsToFolderCommand } from "../src/bounded-contexts/pdf-document-folder-management/command/AssignPdfDocumentsToFolderCommand.ts";
import { CreatePdfDocumentFolderCommand } from "../src/bounded-contexts/pdf-document-folder-management/command/CreatePdfDocumentFolderCommand.ts";
import { DeletePdfDocumentFolderCommand } from "../src/bounded-contexts/pdf-document-folder-management/command/DeletePdfDocumentFolderCommand.ts";
import { RemovePdfDocumentsFromFolderCommand } from "../src/bounded-contexts/pdf-document-folder-management/command/RemovePdfDocumentsFromFolderCommand.ts";
import { RenamePdfDocumentFolderCommand } from "../src/bounded-contexts/pdf-document-folder-management/command/RenamePdfDocumentFolderCommand.ts";
import { ReorderPdfDocumentFolderMembersCommand } from "../src/bounded-contexts/pdf-document-folder-management/command/ReorderPdfDocumentFolderMembersCommand.ts";
import { ReorderPdfDocumentFoldersCommand } from "../src/bounded-contexts/pdf-document-folder-management/command/ReorderPdfDocumentFoldersCommand.ts";
import { RestorePdfDocumentFolderCommand } from "../src/bounded-contexts/pdf-document-folder-management/command/historyReplayCommands.ts";
import { ListPdfDocumentFoldersQuery } from "../src/bounded-contexts/pdf-document-folder-management/query/ListPdfDocumentFoldersQuery.ts";
import { DeletePdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/DeletePdfDocumentCommand.ts";
import { HttpError } from "../src/common/http.ts";
import { createPrismaClient } from "../src/infrastructure/prisma/client.ts";
import { applyMigrations } from "../src/infrastructure/prisma/migrate.ts";
import { PrismaUnitOfWork } from "../src/infrastructure/prisma/unitOfWork.ts";

const root = mkdtempSync(join(tmpdir(), "pdf-document-folders-"));
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
  cqrs.commandBus.send(new CreatePdfDocumentFolderCommand({ name }));

describe("pdf document folders", () => {
  beforeAll(() => {
    applyMigrations(databasePath);
  });

  beforeEach(async () => {
    await db.rel_pdf_document_folder_pdf_document.deleteMany();
    await db.pdf_document_folder.deleteMany();
    await db.pdf_document.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
    rmSync(root, { recursive: true, force: true });
  });

  test("a new folder is appended, and a duplicate name is refused", async () => {
    const first = await createFolder("Reading");
    const second = await createFolder("  later   papers ");
    expect(first.ordering).toBe(0);
    expect(second.name).toBe("later papers");
    expect(second.ordering).toBe(1);
    expect(second.pdf_document_ids).toEqual([]);
    expect(second.document_count).toBe(0);
    await expect(createFolder("reading")).rejects.toThrow(/already exists/);
  });

  test("rename and reorder keep the list dense", async () => {
    const first = await createFolder("A");
    const second = await createFolder("B");
    const renamed = await cqrs.commandBus.send(new RenamePdfDocumentFolderCommand(first.id, "Alpha"));
    expect(renamed.name).toBe("Alpha");

    const reordered = await cqrs.commandBus.send(
      new ReorderPdfDocumentFoldersCommand({ pdf_document_folder_ids: [second.id, first.id] }),
    );
    expect(reordered.map((folder) => folder.id)).toEqual([second.id, first.id]);
    expect(reordered.map((folder) => folder.ordering)).toEqual([0, 1]);

    await expect(
      cqrs.commandBus.send(new ReorderPdfDocumentFoldersCommand({ pdf_document_folder_ids: [first.id] })),
    ).rejects.toThrow(/must list every document folder once/);
  });

  test("an empty folder can be deleted and the survivors are renumbered", async () => {
    const first = await createFolder("A");
    const second = await createFolder("B");
    await cqrs.commandBus.send(new DeletePdfDocumentFolderCommand(first.id));
    const folders = await cqrs.queryBus.send(new ListPdfDocumentFoldersQuery());
    expect(folders.map((folder) => folder.id)).toEqual([second.id]);
    expect(folders[0]?.ordering).toBe(0);
  });

  test("a nonempty folder cannot be deleted, and the folder stays", async () => {
    const folder = await createFolder("A");
    const document = await seedDocument("one", 0);
    await cqrs.commandBus.send(new AssignPdfDocumentsToFolderCommand(folder.id, [document.id]));

    const error = await cqrs.commandBus.send(new DeletePdfDocumentFolderCommand(folder.id)).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as Error).message).toMatch(/Only an empty document folder can be deleted/);

    const folders = await cqrs.queryBus.send(new ListPdfDocumentFoldersQuery());
    expect(folders).toHaveLength(1);
    expect(folders[0]?.pdf_document_ids).toEqual([document.id]);
    expect(folders[0]?.document_count).toBe(1);
  });

  test("assign appends, skips a document already in the folder, and leaves other folders", async () => {
    const reading = await createFolder("Reading");
    const later = await createFolder("Later");
    const first = await seedDocument("one", 0);
    const second = await seedDocument("two", 1);
    const third = await seedDocument("three", 2);

    const filed = await cqrs.commandBus.send(
      new AssignPdfDocumentsToFolderCommand(reading.id, [second.id, first.id, second.id]),
    );
    expect(filed.pdf_document_ids).toEqual([second.id, first.id]);

    const again = await cqrs.commandBus.send(
      new AssignPdfDocumentsToFolderCommand(reading.id, [first.id, third.id]),
    );
    expect(again.pdf_document_ids).toEqual([second.id, first.id, third.id]);

    const also = await cqrs.commandBus.send(
      new AssignPdfDocumentsToFolderCommand(later.id, [first.id]),
    );
    expect(also.pdf_document_ids).toEqual([first.id]);
    const folders = await cqrs.queryBus.send(new ListPdfDocumentFoldersQuery());
    expect(folders.find((folder) => folder.id === reading.id)?.pdf_document_ids).toEqual([
      second.id,
      first.id,
      third.id,
    ]);

    await expect(
      cqrs.commandBus.send(new AssignPdfDocumentsToFolderCommand(reading.id, [999])),
    ).rejects.toThrow(/does not exist/);
  });

  test("remove drops one membership and renumbers the rest", async () => {
    const folder = await createFolder("Reading");
    const first = await seedDocument("one", 0);
    const second = await seedDocument("two", 1);
    const third = await seedDocument("three", 2);
    await cqrs.commandBus.send(
      new AssignPdfDocumentsToFolderCommand(folder.id, [first.id, second.id, third.id]),
    );

    const left = await cqrs.commandBus.send(
      new RemovePdfDocumentsFromFolderCommand(folder.id, [second.id]),
    );
    expect(left.pdf_document_ids).toEqual([first.id, third.id]);
    const rows = await db.rel_pdf_document_folder_pdf_document.findMany({
      where: { pdf_document_folder_id: folder.id },
      orderBy: { ordering: "asc" },
    });
    expect(rows.map((row) => row.ordering)).toEqual([0, 1]);

    await expect(
      cqrs.commandBus.send(new RemovePdfDocumentsFromFolderCommand(folder.id, [999])),
    ).rejects.toThrow(/does not exist/);
  });

  test("members reorder inside one folder", async () => {
    const folder = await createFolder("Reading");
    const first = await seedDocument("one", 0);
    const second = await seedDocument("two", 1);
    await cqrs.commandBus.send(new AssignPdfDocumentsToFolderCommand(folder.id, [first.id, second.id]));

    const reordered = await cqrs.commandBus.send(
      new ReorderPdfDocumentFolderMembersCommand(folder.id, [second.id, first.id]),
    );
    expect(reordered.pdf_document_ids).toEqual([second.id, first.id]);

    await expect(
      cqrs.commandBus.send(new ReorderPdfDocumentFolderMembersCommand(folder.id, [first.id])),
    ).rejects.toThrow(/must list every document in this folder once/);
  });

  test("deleting a document drops its memberships and leaves the folder", async () => {
    const folder = await createFolder("Reading");
    const document = await seedDocument("one", 0);
    await cqrs.commandBus.send(new AssignPdfDocumentsToFolderCommand(folder.id, [document.id]));
    await cqrs.commandBus.send(new DeletePdfDocumentCommand(document.id));

    const folders = await cqrs.queryBus.send(new ListPdfDocumentFoldersQuery());
    expect(folders[0]?.pdf_document_ids).toEqual([]);
    expect(await db.rel_pdf_document_folder_pdf_document.count()).toBe(0);
  });

  test("an existing document is not filed until it is assigned", async () => {
    await seedDocument("already", 0);
    const folders = await cqrs.queryBus.send(new ListPdfDocumentFoldersQuery());
    expect(folders).toEqual([]);
    expect(await db.rel_pdf_document_folder_pdf_document.count()).toBe(0);
  });

  test("restore puts a deleted folder back under its id", async () => {
    const folder = await createFolder("Reading");
    const row = await db.pdf_document_folder.findUniqueOrThrow({ where: { id: folder.id } });
    await cqrs.commandBus.send(new DeletePdfDocumentFolderCommand(folder.id));
    await cqrs.commandBus.send(new RestorePdfDocumentFolderCommand(row, [row.id]));
    const folders = await cqrs.queryBus.send(new ListPdfDocumentFoldersQuery());
    expect(folders.map((item) => item.id)).toEqual([row.id]);
    expect(folders[0]?.name).toBe("Reading");
  });
});
