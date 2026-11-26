import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { replaceDocumentHighlights, stripColumns } from "../highlight/marks.ts";
import { moveLibraryCopyToTrash, restoreLibraryCopy } from "../../../common/library.ts";
import { PlaceNoteCommand } from "../command/historyReplayCommands.ts";
import { RemoveCreatedStripCommand } from "../command/historyReplayCommands.ts";
import { RestoreCreatedStripCommand } from "../command/historyReplayCommands.ts";
import { RestoreNoteCommand } from "../command/historyReplayCommands.ts";
import { RestoreNoteFolderCommand } from "../command/historyReplayCommands.ts";
import { RestoreImportCommand } from "../command/historyReplayCommands.ts";
import { RestorePdfDocumentCommand } from "../command/historyReplayCommands.ts";
import { RevertImportCommand } from "../command/historyReplayCommands.ts";

/** The opposite of filing a strip into a folder: the folder and position it left. */
@CommandHandler(PlaceNoteCommand, { inject: [PrismaUnitOfWork] })
export class PlaceNoteCommandHandler implements ICommandHandler<PlaceNoteCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: PlaceNoteCommand): Promise<void> {
    await this.uow.db().note.update({
      where: { id: command.id },
      data: { note_folder_id: command.folderId, ordering: command.ordering },
    });
  }
}

/** Undo of creating a strip. The folder is removed only when this save opened it and it is empty. */
@CommandHandler(RemoveCreatedStripCommand, { inject: [PrismaUnitOfWork] })
export class RemoveCreatedStripCommandHandler implements ICommandHandler<RemoveCreatedStripCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RemoveCreatedStripCommand): Promise<void> {
    const db = this.uow.db();
    await db.note.delete({ where: { id: command.stripId } });
    if (command.createdFolderId === null) return;
    const remaining = await db.note.count({ where: { note_folder_id: command.createdFolderId } });
    if (remaining === 0) await db.note_folder.delete({ where: { id: command.createdFolderId } });
  }
}

/** Redo of creating a strip, under the ids the first save used. */
@CommandHandler(RestoreCreatedStripCommand, { inject: [PrismaUnitOfWork] })
export class RestoreCreatedStripCommandHandler implements ICommandHandler<RestoreCreatedStripCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RestoreCreatedStripCommand): Promise<void> {
    const db = this.uow.db();
    if (command.folder) await db.note_folder.create({ data: command.folder });
    await db.note.create({ data: stripColumns(command.strip) });
  }
}

/** Redo of deleting a strip, or the strip half of restoring a folder. */
@CommandHandler(RestoreNoteCommand, { inject: [PrismaUnitOfWork] })
export class RestoreNoteCommandHandler implements ICommandHandler<RestoreNoteCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RestoreNoteCommand): Promise<void> {
    const db = this.uow.db();
    await db.note.create({ data: stripColumns(command.strip) });
  }
}

/** Undo of deleting a folder. */
@CommandHandler(RestoreNoteFolderCommand, { inject: [PrismaUnitOfWork] })
export class RestoreNoteFolderCommandHandler implements ICommandHandler<RestoreNoteFolderCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RestoreNoteFolderCommand): Promise<void> {
    const db = this.uow.db();
    await db.note_folder.create({ data: command.folder });
    for (const strip of command.strips) {
      await db.note.create({ data: stripColumns(strip) });
    }
  }
}

/** Undo of deleting a document. The library copy comes back from the trash first. */
@CommandHandler(RestorePdfDocumentCommand, { inject: [PrismaUnitOfWork] })
export class RestorePdfDocumentCommandHandler implements ICommandHandler<RestorePdfDocumentCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RestorePdfDocumentCommand): Promise<void> {
    await restoreLibraryCopy(command.document.file_path);
    const db = this.uow.db();
    await db.pdf_document.create({ data: command.document });
    for (const folder of command.folders) await db.note_folder.create({ data: folder });
    for (const strip of command.strips) {
      await db.note.create({ data: stripColumns(strip) });
    }
    await replaceDocumentHighlights(db, command.document.id, command.highlights);
  }
}

/** Undo of an import. Created rows go away and their copies wait in the trash for a redo. */
@CommandHandler(RevertImportCommand, { inject: [PrismaUnitOfWork] })
export class RevertImportCommandHandler implements ICommandHandler<RevertImportCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RevertImportCommand, _context: CommandContext): Promise<void> {
    const db = this.uow.db();
    if (command.createdIds.length > 0) {
      await db.pdf_document.deleteMany({ where: { id: { in: command.createdIds } } });
    }
    for (const upgrade of command.upgrades) {
      await db.pdf_document.update({
        where: { id: upgrade.id },
        data: {
          file_path: upgrade.file_path,
          content_hash: upgrade.content_hash,
          original_path: upgrade.original_path,
        },
      });
    }
    for (const item of command.previousOrder) {
      if (command.createdIds.includes(item.id)) continue;
      await db.pdf_document.update({ where: { id: item.id }, data: { ordering: item.ordering } });
    }
    for (const filePath of command.createdFiles) await moveLibraryCopyToTrash(filePath);
  }
}

/** Redo of an import. The copies come back, then the same rows. */
@CommandHandler(RestoreImportCommand, { inject: [PrismaUnitOfWork] })
export class RestoreImportCommandHandler implements ICommandHandler<RestoreImportCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RestoreImportCommand): Promise<void> {
    for (const filePath of command.createdFiles) await restoreLibraryCopy(filePath);
    const db = this.uow.db();
    for (const document of command.created) await db.pdf_document.create({ data: document });
    for (const upgrade of command.upgrades) {
      await db.pdf_document.update({
        where: { id: upgrade.id },
        data: {
          file_path: upgrade.file_path,
          content_hash: upgrade.content_hash,
          original_path: upgrade.original_path,
        },
      });
    }
    for (const item of command.order) {
      await db.pdf_document.update({ where: { id: item.id }, data: { ordering: item.ordering } });
    }
  }
}
