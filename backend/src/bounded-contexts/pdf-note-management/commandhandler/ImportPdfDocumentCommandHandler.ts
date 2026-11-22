import { resolve } from "node:path";
import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
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
import { defaultNameFor, withStrips } from "../../documents.ts";
import { PdfDocumentImportedEvent } from "../event/PdfDocumentImportedEvent.ts";
import type { PdfDocumentWithStrips } from "../types.ts";

/**
 * Take a PDF the reader picked into the library, and answer with its document.
 *
 * Every application command uses the required transaction mode. This handler
 * hashes and copies the PDF inside that transaction because the desktop app is
 * the only client and Postgres will tolerate the longer transaction. The
 * content hash makes the import idempotent: opening the same PDF from a second
 * folder finds the row by content and returns it, notes and all.
 *
 * A future multi-client deployment should move the file preparation outside
 * the command so the database transaction contains only database work.
 */
@CommandHandler(ImportPdfDocumentCommand, {
  inject: [PrismaUnitOfWork],
  emits: [PdfDocumentImportedEvent],
})
export class ImportPdfDocumentCommandHandler implements ICommandHandler<ImportPdfDocumentCommand, PdfDocumentWithStrips> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(
    command: ImportPdfDocumentCommand,
    context: CommandContext,
  ): Promise<PdfDocumentWithStrips> {
    const { source_path, name } = command.input;
    const db = this.uow.db();

    // The reader can also be handed a library path — from Recents after a
    // restart, or from the Notes tab — and that copy is already the document's
    // own file, so there is nothing to copy and nothing to hash.
    if (isInsideDir(libraryDir(), source_path)) {
      const existing = await db.pdf_document.findUnique({
        where: { file_path: resolve(source_path) },
      });
      if (existing) return withStrips(db, existing);
      // The database was reset but the copies were kept: fall through, and the
      // hash below recreates the row for the file that is already there.
    }

    if (!(await isExistingFile(source_path))) throw ErrorFactory.notFound("The file does not exist");
    // The header, not the extension: this endpoint is given any local path, and
    // a renamed text file would otherwise land in the library and fail later in
    // pdf.js with a much less useful message.
    if (!(await isPdfFile(source_path))) throw ErrorFactory.badRequest("Not a PDF file");

    const hash = await hashFile(source_path);

    // Same bytes, already imported: the same document, wherever they were
    // opened from. The copy is (re)written because the reader may have deleted it.
    const byHash = await db.pdf_document.findUnique({ where: { content_hash: hash } });
    if (byHash) {
      await copyIntoLibrary(source_path, hash);
      return withStrips(db, byHash);
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
      return withStrips(db, updated);
    }

    const libraryPath = await copyIntoLibrary(source_path, hash);
    const created = await db.pdf_document.create({
      data: {
        file_path: libraryPath,
        content_hash: hash,
        original_path: source_path,
        // The original path, never the library one: the name is what the reader
        // recognises the file by, and the copy is named by its hash.
        name: name && name.length > 0 ? name : defaultNameFor(source_path),
        created_at: Date.now(),
      },
    });
    context.events.add(new PdfDocumentImportedEvent(created.id, hash, created.file_path, source_path));
    return withStrips(db, created);
  }
}
