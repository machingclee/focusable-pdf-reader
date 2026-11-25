import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ListPdfTagFoldersQuery } from "../query/ListPdfTagFoldersQuery.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagFolder } from "../types.ts";

/** Every tag folder, in drag order. */
@QueryHandler(ListPdfTagFoldersQuery, { inject: [PrismaUnitOfWork, PdfTagCatalogService] })
export class ListPdfTagFoldersQueryHandler
  implements IQueryHandler<ListPdfTagFoldersQuery, PdfTagFolder[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
  ) { }

  handle(): Promise<PdfTagFolder[]> {
    return this.catalog.listFolders(this.uow.db());
  }
}
