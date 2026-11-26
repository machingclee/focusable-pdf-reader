import { QueryHandler, type IQueryHandler } from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ListPdfDocumentFoldersQuery } from "../query/ListPdfDocumentFoldersQuery.ts";
import { PdfDocumentFolderService } from "../service/PdfDocumentFolderService.ts";
import type { PdfDocumentFolderView } from "../types.ts";

/** Every document folder, in drag order, with its documents in membership order. */
@QueryHandler(ListPdfDocumentFoldersQuery, { inject: [PrismaUnitOfWork, PdfDocumentFolderService] })
export class ListPdfDocumentFoldersQueryHandler
  implements IQueryHandler<ListPdfDocumentFoldersQuery, PdfDocumentFolderView[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly folders: PdfDocumentFolderService,
  ) {}

  handle(): Promise<PdfDocumentFolderView[]> {
    return this.folders.listFolders(this.uow.db());
  }
}
