import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "express-prisma-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ReorderFocusableStripsCommand } from "../command/ReorderFocusableStripsCommand.ts";
import { FocusableStripsReorderedEvent } from "../event/FocusableStripsReorderedEvent.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { FolderWithStrips } from "../types.ts";

/**
 * Strips that share a home. `folder_id: null` is the group of strips that are in
 * no folder, which the strip menu can move a strip into and out of.
 */
type StripGroup = { folder_id: number | null; strip_ids: number[] };

/**
 * Apply a drag: the new membership and order of one or more folders (or the
 * unfiled group). The groups must describe the groups' current strips exactly,
 * so a strip cannot disappear or be pulled in from a group the request forgot.
 */
@CommandHandler(ReorderFocusableStripsCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FocusableStripsReorderedEvent],
})
export class ReorderFocusableStripsCommandHandler implements ICommandHandler<ReorderFocusableStripsCommand, FolderWithStrips[]> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(
    command: ReorderFocusableStripsCommand,
    context: CommandContext,
  ): Promise<FolderWithStrips[]> {
    const folders = await this.reorderStrips(this.uow.db(), command.input.groups);
    const stripCount = command.input.groups.reduce(
      (total, group) => total + group.strip_ids.length,
      0,
    );

    context.events.add(new FocusableStripsReorderedEvent(command.input.groups.length, stripCount));
    return folders;
  }

  /**
   * Rewrite which strips sit in the given groups, and their order.
   *
   * A group is a folder, or `null` for the strips in no folder. A drag that stays
   * inside one group sends one group; a drag into another sends the source and the
   * destination, each with its full new id list. The lists together must be exactly
   * the strips those groups hold now, so a strip cannot disappear or be pulled in
   * from a group the request forgot.
   */
  private async reorderStrips(
    db: Prisma.TransactionClient,
    groups: StripGroup[],
  ): Promise<FolderWithStrips[]> {
    const folderIds = groups.flatMap((group) => (group.folder_id === null ? [] : [group.folder_id]));
    if (new Set(folderIds).size !== folderIds.length) {
      throw ErrorFactory.badRequest("groups must not repeat a folder_id");
    }
    const unfiledGroups = groups.filter((group) => group.folder_id === null).length;
    if (unfiledGroups > 1) throw ErrorFactory.badRequest("groups must not repeat the unfiled group");

    const foundFolders = await db.folder.findMany({ where: { id: { in: folderIds } } });
    if (foundFolders.length !== folderIds.length) throw ErrorFactory.notFound("A folder in groups does not exist");
    const folderDocumentIds = new Set(foundFolders.map((folder) => folder.pdf_document_id));
    if (folderDocumentIds.size > 1) throw ErrorFactory.badRequest("groups must all belong to one document");

    const payloadIds = groups.flatMap((group) => group.strip_ids);
    if (payloadIds.length === 0) throw ErrorFactory.badRequest("groups must list at least one strip");
    if (new Set(payloadIds).size !== payloadIds.length) {
      throw ErrorFactory.badRequest("a strip cannot appear twice in groups");
    }

    const foundStrips = await db.focusable_strip.findMany({ where: { id: { in: payloadIds } } });
    if (foundStrips.length !== payloadIds.length) throw ErrorFactory.notFound("A strip in groups does not exist");

    // The unfiled group has no folder to name its document, so those strips name it
    // themselves. Both sources have to agree: a request cannot move a strip between
    // documents by pointing it at someone else's folder.
    const documentIds = new Set([
      ...folderDocumentIds,
      ...foundStrips.map((strip) => strip.pdf_document_id),
    ]);
    if (documentIds.size !== 1) throw ErrorFactory.badRequest("groups must all belong to one document");
    const pdfDocumentId = foundStrips[0]!.pdf_document_id;

    // The lists together must be exactly what those groups hold now: nothing left
    // behind in a group the request forgot, nothing pulled in from one it did not
    // name. This is also what stops a move from deleting a strip, and it is why
    // the destination may list a strip that is still in the source today.
    const current = await db.focusable_strip.findMany({
      where: {
        pdf_document_id: pdfDocumentId,
        OR: [
          ...(folderIds.length > 0 ? [{ folder_id: { in: folderIds } }] : []),
          ...(unfiledGroups === 1 ? [{ folder_id: null }] : []),
        ],
      },
    });
    PdfNotesService.assertSameIds(
      current.map((strip) => strip.id),
      payloadIds,
      "groups must list every strip of the given groups once",
    );

    // One update per strip inside the command transaction. A group emptied by
    // the drag simply contributes no writes.
    for (const group of groups) {
      for (const [ordering, id] of group.strip_ids.entries()) {
        await db.focusable_strip.update({
          where: { id },
          data: { folder_id: group.folder_id, ordering },
        });
      }
    }
    return PdfNotesService.listFoldersWithStrips(db, pdfDocumentId);
  }
}
