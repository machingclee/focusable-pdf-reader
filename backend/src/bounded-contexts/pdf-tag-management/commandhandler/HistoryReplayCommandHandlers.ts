import {
  CommandHandler,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import {
  ReplaceDocumentPdfTagsCommand,
  RestorePdfTagCommand,
  RestorePdfTagFolderCommand,
} from "../command/historyReplayCommands.ts";

/**
 * Redo of creating a tag folder, or undo of deleting one.
 *
 * The row is written with the id it had; `order` then rewrites every folder's
 * position, because the delete that this undoes left the survivors dense.
 */
@CommandHandler(RestorePdfTagFolderCommand, { inject: [PrismaUnitOfWork] })
export class RestorePdfTagFolderCommandHandler
  implements ICommandHandler<RestorePdfTagFolderCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RestorePdfTagFolderCommand): Promise<void> {
    const db = this.uow.db();
    await db.pdf_tag_folder.create({ data: command.folder });
    for (const [ordering, id] of command.order.entries()) {
      await db.pdf_tag_folder.update({ where: { id }, data: { ordering } });
    }
  }
}

/** Redo of creating a tag, or undo of deleting one. */
@CommandHandler(RestorePdfTagCommand, { inject: [PrismaUnitOfWork] })
export class RestorePdfTagCommandHandler implements ICommandHandler<RestorePdfTagCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RestorePdfTagCommand): Promise<void> {
    await this.uow.db().pdf_tag.create({ data: command.tag });
  }
}

/**
 * Undo of a copy: make the document carry exactly the tag set it carried before.
 *
 * The same difference a paste writes, with the wanted set given instead of read
 * from a source document. No event and no history step: this command only exists
 * to replay a step the undo stack already holds.
 */
@CommandHandler(ReplaceDocumentPdfTagsCommand, { inject: [PrismaUnitOfWork] })
export class ReplaceDocumentPdfTagsCommandHandler
  implements ICommandHandler<ReplaceDocumentPdfTagsCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: ReplaceDocumentPdfTagsCommand): Promise<void> {
    const db = this.uow.db();
    const document = await db.pdf_document.findUnique({
      where: { id: command.documentId },
      include: {
        assigned_tags: {
          include: { assigned_pdf_tag: { select: { id: true, pdf_tag_id: true } } },
        },
      },
    });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${command.documentId} does not exist`);

    const wanted = new Set(command.pdfTagIds);
    const carried = new Set(
      document.assigned_tags.map((link) => link.assigned_pdf_tag.pdf_tag_id),
    );
    const removed = document.assigned_tags.filter(
      (link) => !wanted.has(link.assigned_pdf_tag.pdf_tag_id),
    );
    const added = [...wanted].filter((tagId) => !carried.has(tagId));

    // Prove every added tag still exists before touching the target: a replay
    // that cannot finish must leave the document as it was.
    if (added.length > 0) {
      const tags = await db.pdf_tag.findMany({
        where: { id: { in: added } },
        select: { id: true },
      });
      if (tags.length !== added.length) {
        const found = new Set(tags.map((tag) => tag.id));
        const unknown = added.find((tagId) => !found.has(tagId));
        throw ErrorFactory.ofBadRequest(`PDF tag ${unknown} does not exist`);
      }
    }

    for (const link of removed) {
      await db.assigned_pdf_tag.delete({ where: { id: link.assigned_pdf_tag.id } });
    }
    const now = Date.now();
    for (const pdfTagId of added) {
      // The assignment row owns the tag; the junction owns the document. Both
      // are written together because neither has meaning without the other.
      await db.rel_pdf_document_assigned_pdf_tag.create({
        data: {
          created_at: now,
          pdf_document: { connect: { id: document.id } },
          assigned_pdf_tag: { create: { pdf_tag_id: pdfTagId, created_at: now } },
        },
      });
    }
  }
}
