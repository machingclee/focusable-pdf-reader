import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ListPdfDocumentsQuery } from "../query/ListPdfDocumentsQuery.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { PdfDocumentWithCount } from "../types.ts";

/** Every document, in drag order, with how many strips it has. */
@QueryHandler(ListPdfDocumentsQuery, { inject: [PrismaUnitOfWork, PdfNotesService] })
export class ListPdfDocumentsQueryHandler
  implements IQueryHandler<ListPdfDocumentsQuery, PdfDocumentWithCount[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly notes: PdfNotesService,
  ) { }

  handle(): Promise<PdfDocumentWithCount[]> {
    return this.notes.listDocuments(this.uow.db());
  }
}
