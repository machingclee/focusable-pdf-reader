import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ListPdfTagsQuery } from "../query/ListPdfTagsQuery.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagWithCount } from "../types.ts";

/** Every tag, with how many documents carry it, in catalogue order. */
@QueryHandler(ListPdfTagsQuery, { inject: [PrismaUnitOfWork, PdfTagCatalogService] })
export class ListPdfTagsQueryHandler
  implements IQueryHandler<ListPdfTagsQuery, PdfTagWithCount[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
  ) { }

  handle(): Promise<PdfTagWithCount[]> {
    return this.catalog.listTags(this.uow.db());
  }
}
