import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ListFoldersWithStripsQuery } from "../query/ListFoldersWithStripsQuery.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { FolderWithStrips } from "../types.ts";

/** The folders of one document, each with its strips, both in drag order. */
@QueryHandler(ListFoldersWithStripsQuery, { inject: [PrismaUnitOfWork, PdfNotesService] })
export class ListFoldersWithStripsQueryHandler
  implements IQueryHandler<ListFoldersWithStripsQuery, FolderWithStrips[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly notes: PdfNotesService,
  ) { }

  handle(query: ListFoldersWithStripsQuery): Promise<FolderWithStrips[]> {
    return this.notes.listFoldersWithStrips(this.uow.db(), query.pdfDocumentId);
  }
}
