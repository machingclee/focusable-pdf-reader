import { QueryHandler, type IQueryHandler } from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { loadDocumentAnnotations } from "../annotation/rows.ts";
import { ListPdfAnnotationsQuery } from "../query/ListPdfAnnotationsQuery.ts";
import type { Annotation } from "../types.ts";

/**
 * Every pin of one document.
 *
 * The document is what is being marked, so the list names it once and every row
 * carries its own page. A document with nothing pinned is `[]`; a document that
 * does not exist is a 404, the same as an unmarked one is not.
 */
@QueryHandler(ListPdfAnnotationsQuery, { inject: [PrismaUnitOfWork] })
export class ListPdfAnnotationsQueryHandler
  implements IQueryHandler<ListPdfAnnotationsQuery, Annotation[]> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(query: ListPdfAnnotationsQuery): Promise<Annotation[]> {
    const db = this.uow.db();
    const document = await db.pdf_document.findUnique({
      where: { id: query.id },
      select: { id: true },
    });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${query.id} does not exist`);
    return loadDocumentAnnotations(db, query.id);
  }
}
