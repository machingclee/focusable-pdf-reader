import { resolve } from "node:path";
import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import {
  copyIntoLibrary,
  hashFile,
  isExistingFile,
  isInsideDir,
  isPdfFile,
  libraryDir,
} from "../../../common/library.ts";
import { ImportPdfDocumentCommand } from "../command/ImportPdfDocumentCommand.ts";
import {
  RestoreImportCommand,
  RevertImportCommand,
  type DocumentLocation,
  type DocumentOrder,
} from "../command/historyReplayCommands.ts";
import { defaultNameFor, withStrips } from "../../documents.ts";
import { PdfDocumentImportedEvent } from "../event/PdfDocumentImportedEvent.ts";
import { HistoryStepReadyEvent } from "../event/HistoryStepReadyEvent.ts";
import { recordHistory } from "../history/recordHistory.ts";
import { plainDocument } from "../history/rows.ts";
import { SessionHistory } from "../history/SessionHistory.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { PdfDocument, PdfDocumentWithStrips } from "../types.ts";

type ImportOne =
  | { kind: "existing"; document: PdfDocumentWithStrips }
  | { kind: "created"; document: PdfDocumentWithStrips }
  | {
      kind: "upgraded";
      document: PdfDocumentWithStrips;
      before: DocumentLocation;
    };

/**
 * Take the PDFs the reader picked into the library, and answer with a document
 * for each path, in the same order.
 *
 * Every application command uses the required transaction mode. This handler
 * hashes and copies the PDFs inside that transaction because the desktop app is
 * the only client and Postgres will tolerate the longer transaction. The
 * content hash makes the import idempotent: opening the same PDF from a second
 * folder finds the row by content and returns it, notes and all.
 *
 * A future multi-client deployment should move the file preparation outside
 * the command so the database transaction contains only database work.
 */
@CommandHandler(ImportPdfDocumentCommand, {
  inject: [PrismaUnitOfWork, SessionHistory, PdfNotesService],
  emits: [PdfDocumentImportedEvent, HistoryStepReadyEvent],
  afterCommit: [HistoryStepReadyEvent],
})
export class ImportPdfDocumentCommandHandler implements ICommandHandler<ImportPdfDocumentCommand, PdfDocumentWithStrips[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
    private readonly notes: PdfNotesService,
  ) { }

  async handle(
    command: ImportPdfDocumentCommand,
    context: CommandContext,
  ): Promise<PdfDocumentWithStrips[]> {
    const { source_paths, name } = command.input;
    const db = this.uow.db();
    const previousOrder = await db.pdf_document.findMany({
      select: { id: true, ordering: true },
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
    });

    // Refuse the batch before copying anything, so one bad path does not leave
    // the earlier files in the library with no row to point at them.
    for (const source_path of source_paths) {
      await this.assertImportable(db, source_path);
    }

    const documentName = source_paths.length === 1 ? name : undefined;
    const documents: PdfDocumentWithStrips[] = [];
    const created: PdfDocument[] = [];
    const upgrades: { before: DocumentLocation; after: DocumentLocation }[] = [];
    for (const source_path of source_paths) {
      const outcome = await this.importOne(db, context, source_path, documentName);
      documents.push(outcome.document);
      if (outcome.kind === "created") created.push(plainDocument(outcome.document));
      if (outcome.kind === "upgraded") {
        upgrades.push({
          before: outcome.before,
          after: {
            id: outcome.document.id,
            file_path: outcome.document.file_path,
            content_hash: outcome.document.content_hash,
            original_path: outcome.document.original_path,
          },
        });
      }
    }
    // A later new document is placed first, which shifts the ordering of rows
    // already built earlier in this same request. Read it back so the answer
    // matches the list.
    if (documents.length > 1) {
      const rows = await db.pdf_document.findMany({
        where: { id: { in: documents.map((document) => document.id) } },
        select: { id: true, ordering: true },
      });
      const ordering = new Map(rows.map((row) => [row.id, row.ordering]));
      for (const document of documents) {
        const next = ordering.get(document.id);
        if (next !== undefined) document.ordering = next;
      }
    }
    if (created.length > 0 || upgrades.length > 0) {
      const order = await db.pdf_document.findMany({
        select: { id: true, ordering: true },
        orderBy: [{ ordering: "asc" }, { id: "asc" }],
      });
      const createdIds = created.map((document) => document.id);
      const createdFiles = created.map((document) => document.file_path);
      recordHistory(context, this.history, {
        label: "Import documents",
        undo: new RevertImportCommand(
          createdIds,
          upgrades.map((upgrade) => upgrade.before),
          previousOrder,
          createdFiles,
        ),
        redo: new RestoreImportCommand(
          created.map((document) => {
            const fresh = documents.find((item) => item.id === document.id);
            return plainDocument({ ...document, ordering: fresh?.ordering ?? document.ordering });
          }),
          upgrades.map((upgrade) => upgrade.after),
          order satisfies DocumentOrder[],
          createdFiles,
        ),
        trashFiles: createdFiles,
      });
    }
    return documents;
  }

  /**
   * A library path that already has a row needs nothing from the disk. Anything
   * else has to be a PDF that is there, and the message names the path so a
   * batch of files says which one failed.
   */
  private async assertImportable(db: Prisma.TransactionClient, source_path: string): Promise<void> {
    if (isInsideDir(libraryDir(), source_path)) {
      const existing = await db.pdf_document.findUnique({
        where: { file_path: resolve(source_path) },
      });
      if (existing) return;
    }
    if (!(await isExistingFile(source_path))) {
      throw ErrorFactory.ofNotFound(`The file does not exist: ${source_path}`);
    }
    // The header, not the extension: this endpoint is given any local path, and
    // a renamed text file would otherwise land in the library and fail later in
    // pdf.js with a much less useful message.
    if (!(await isPdfFile(source_path))) {
      throw ErrorFactory.ofBadRequest(`Not a PDF file: ${source_path}`);
    }
  }

  /** One path: reuse the library row, the same bytes, or a legacy path, or create. */
  private async importOne(
    db: Prisma.TransactionClient,
    context: CommandContext,
    source_path: string,
    name: string | undefined,
  ): Promise<ImportOne> {
    // The reader can also be handed a library path — from Recents after a
    // restart, or from the Notes tab — and that copy is already the document's
    // own file, so there is nothing to copy and nothing to hash.
    if (isInsideDir(libraryDir(), source_path)) {
      const existing = await db.pdf_document.findUnique({
        where: { file_path: resolve(source_path) },
      });
      if (existing) return { kind: "existing", document: await withStrips(db, existing, this.notes) };
      // The database was reset but the copies were kept: fall through, and the
      // hash below recreates the row for the file that is already there.
    }

    if (!(await isExistingFile(source_path))) {
      throw ErrorFactory.ofNotFound(`The file does not exist: ${source_path}`);
    }
    if (!(await isPdfFile(source_path))) {
      throw ErrorFactory.ofBadRequest(`Not a PDF file: ${source_path}`);
    }

    const hash = await hashFile(source_path);

    // Same bytes, already imported: the same document, wherever they were
    // opened from. The copy is (re)written because the reader may have deleted it.
    const byHash = await db.pdf_document.findUnique({ where: { content_hash: hash } });
    if (byHash) {
      await copyIntoLibrary(source_path, hash);
      return { kind: "existing", document: await withStrips(db, byHash, this.notes) };
    }

    // A document written before the library existed: its notes are stored
    // against the reader's own path. Upgrading the row in place keeps its id, so
    // its folders, strips and notes come along untouched.
    const legacy = await db.pdf_document.findUnique({ where: { file_path: source_path } });
    if (legacy && legacy.content_hash === null) {
      const libraryPath = await copyIntoLibrary(source_path, hash);
      const updated = await db.pdf_document.update({
        where: { id: legacy.id },
        data: {
          file_path: libraryPath,
          content_hash: hash,
          original_path: source_path,
        },
      });
      context.events.add(
        new PdfDocumentImportedEvent(updated.id, hash, updated.file_path, source_path),
      );
      return {
        kind: "upgraded",
        document: await withStrips(db, updated, this.notes),
        before: {
          id: legacy.id,
          file_path: legacy.file_path,
          content_hash: legacy.content_hash,
          original_path: legacy.original_path,
        },
      };
    }

    const libraryPath = await copyIntoLibrary(source_path, hash);
    await this.notes.placeNewDocumentFirst(db);
    const created = await db.pdf_document.create({
      data: {
        file_path: libraryPath,
        content_hash: hash,
        original_path: source_path,
        // The original path, never the library one: the name is what the reader
        // recognises the file by, and the copy is named by its hash.
        name: name && name.length > 0 ? name : defaultNameFor(source_path),
        ordering: 0,
        created_at: Date.now(),
      },
    });
    context.events.add(new PdfDocumentImportedEvent(created.id, hash, created.file_path, source_path));
    return { kind: "created", document: await withStrips(db, created, this.notes) };
  }
}
