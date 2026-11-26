import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { ReorderNotesCommand } from "../command/ReorderNotesCommand.ts";
import { NotesReorderedEvent } from "../event/NotesReorderedEvent.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { NoteFolderWithNotes } from "../types.ts";

/**
 * Strips that share a home. `note_folder_id: null` is the group of strips that are in
 * no folder, which the strip menu can move a strip into and out of.
 */
type StripGroup = { note_folder_id: number | null; note_ids: number[] };

/**
 * Apply a drag: the new membership and order of one or more folders (or the
 * unfiled group). The groups must describe the groups' current strips exactly,
 * so a strip cannot disappear or be pulled in from a group the request forgot.
 */
@CommandHandler(ReorderNotesCommand, {
  inject: [PrismaUnitOfWork, SessionHistory, PdfNotesService],
  emits: [NotesReorderedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class ReorderNotesCommandHandler implements ICommandHandler<ReorderNotesCommand, NoteFolderWithNotes[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
    private readonly notes: PdfNotesService,
  ) { }

  async handle(
    command: ReorderNotesCommand,
    context: CommandContext,
  ): Promise<NoteFolderWithNotes[]> {
    const db = this.uow.db();
    const previous = await this.currentGroups(db, command.input.groups);
    const folders = await this.reorderStrips(db, command.input.groups);
    const stripCount = command.input.groups.reduce(
      (total, group) => total + group.note_ids.length,
      0,
    );

    context.events.add(new NotesReorderedEvent(command.input.groups.length, stripCount));
    if (!sameGroups(previous, command.input.groups)) {
      recordHistory(context, this.history, {
        label: "Reorder strips",
        undo: new ReorderNotesCommand({ groups: previous }),
        redo: command,
        trashFiles: [],
      });
    }
    return folders;
  }

  /** The membership each named group has now, in drag order. */
  private async currentGroups(db: Prisma.TransactionClient, groups: StripGroup[]): Promise<StripGroup[]> {
    const folderIds = groups.flatMap((group) => (group.note_folder_id === null ? [] : [group.note_folder_id]));
    const folders = folderIds.length === 0
      ? []
      : await db.note_folder.findMany({ where: { id: { in: folderIds } }, select: { id: true, pdf_document_id: true } });
    let documentId = folders[0]?.pdf_document_id;
    if (documentId === undefined) {
      const sampleId = groups.flatMap((group) => group.note_ids)[0];
      if (sampleId !== undefined) {
        const sample = await db.note.findUnique({
          where: { id: sampleId },
          select: { pdf_document_id: true },
        });
        documentId = sample?.pdf_document_id;
      }
    }
    return Promise.all(groups.map(async (group) => {
      const strips = await db.note.findMany({
        where: {
          note_folder_id: group.note_folder_id,
          ...(group.note_folder_id === null && documentId !== undefined ? { pdf_document_id: documentId } : {}),
        },
        orderBy: [{ ordering: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      return { note_folder_id: group.note_folder_id, note_ids: strips.map((strip) => strip.id) };
    }));
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
  ): Promise<NoteFolderWithNotes[]> {
    const folderIds = groups.flatMap((group) => (group.note_folder_id === null ? [] : [group.note_folder_id]));
    if (new Set(folderIds).size !== folderIds.length) {
      throw ErrorFactory.ofBadRequest("groups must not repeat a note_folder_id");
    }
    const unfiledGroups = groups.filter((group) => group.note_folder_id === null).length;
    if (unfiledGroups > 1) throw ErrorFactory.ofBadRequest("groups must not repeat the unfiled group");

    const foundFolders = await db.note_folder.findMany({ where: { id: { in: folderIds } } });
    if (foundFolders.length !== folderIds.length) throw ErrorFactory.ofNotFound("A folder in groups does not exist");
    const folderDocumentIds = new Set(foundFolders.map((folder) => folder.pdf_document_id));
    if (folderDocumentIds.size > 1) throw ErrorFactory.ofBadRequest("groups must all belong to one document");

    const payloadIds = groups.flatMap((group) => group.note_ids);
    if (payloadIds.length === 0) throw ErrorFactory.ofBadRequest("groups must list at least one strip");
    if (new Set(payloadIds).size !== payloadIds.length) {
      throw ErrorFactory.ofBadRequest("a strip cannot appear twice in groups");
    }

    const foundStrips = await db.note.findMany({ where: { id: { in: payloadIds } } });
    if (foundStrips.length !== payloadIds.length) throw ErrorFactory.ofNotFound("A strip in groups does not exist");

    // The unfiled group has no folder to name its document, so those strips name it
    // themselves. Both sources have to agree: a request cannot move a strip between
    // documents by pointing it at someone else's folder.
    const documentIds = new Set([
      ...folderDocumentIds,
      ...foundStrips.map((strip) => strip.pdf_document_id),
    ]);
    if (documentIds.size !== 1) throw ErrorFactory.ofBadRequest("groups must all belong to one document");
    const pdfDocumentId = foundStrips[0]!.pdf_document_id;

    // The lists together must be exactly what those groups hold now: nothing left
    // behind in a group the request forgot, nothing pulled in from one it did not
    // name. This is also what stops a move from deleting a strip, and it is why
    // the destination may list a strip that is still in the source today.
    const current = await db.note.findMany({
      where: {
        pdf_document_id: pdfDocumentId,
        OR: [
          ...(folderIds.length > 0 ? [{ note_folder_id: { in: folderIds } }] : []),
          ...(unfiledGroups === 1 ? [{ note_folder_id: null }] : []),
        ],
      },
    });
    this.notes.assertSameIds(
      current.map((strip) => strip.id),
      payloadIds,
      "groups must list every strip of the given groups once",
    );

    // One update per strip inside the command transaction. A group emptied by
    // the drag simply contributes no writes.
    for (const group of groups) {
      for (const [ordering, id] of group.note_ids.entries()) {
        await db.note.update({
          where: { id },
          data: { note_folder_id: group.note_folder_id, ordering },
        });
      }
    }
    return this.notes.listFoldersWithStrips(db, pdfDocumentId);
  }
}

function sameGroups(left: readonly StripGroup[], right: readonly StripGroup[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((group, index) => {
    const other = right[index];
    if (!other || group.note_folder_id !== other.note_folder_id) return false;
    return group.note_ids.length === other.note_ids.length
      && group.note_ids.every((id, position) => id === other.note_ids[position]);
  });
}
