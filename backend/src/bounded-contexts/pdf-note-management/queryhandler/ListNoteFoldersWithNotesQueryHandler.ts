import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ListNoteFoldersWithNotesQuery } from "../query/ListNoteFoldersWithNotesQuery.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { NoteFolderWithNotes } from "../types.ts";

/** The folders of one document, each with its strips, both in drag order. */
@QueryHandler(ListNoteFoldersWithNotesQuery, { inject: [PrismaUnitOfWork, PdfNotesService] })
export class ListNoteFoldersWithNotesQueryHandler
  implements IQueryHandler<ListNoteFoldersWithNotesQuery, NoteFolderWithNotes[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly notes: PdfNotesService,
  ) { }

  handle(query: ListNoteFoldersWithNotesQuery): Promise<NoteFolderWithNotes[]> {
    return this.notes.listFoldersWithStrips(this.uow.db(), query.pdfDocumentId);
  }
}
