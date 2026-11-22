import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ListPdfDocumentsQuery } from "../query/ListPdfDocumentsQuery.ts";
import type { PdfDocumentWithCount } from "../types.ts";

/** Every document, newest first, with how many strips it has. */
@QueryHandler(ListPdfDocumentsQuery, { inject: [PrismaUnitOfWork] })
export class ListPdfDocumentsQueryHandler
  implements IQueryHandler<ListPdfDocumentsQuery, PdfDocumentWithCount[]> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  handle(): Promise<PdfDocumentWithCount[]> {
    return this.uow.db().pdf_document.findMany({
      orderBy: { created_at: "desc" },
      // Strips hang off the document as well as off folders, so this counts the
      // folder-less ones too.
      include: { _count: { select: { focusable_strips: true } } },
    });
  }
}
