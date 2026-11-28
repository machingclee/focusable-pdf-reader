import { QueryHandler, type IQueryHandler } from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { GetPdfAnnotationQuery } from "../query/GetPdfAnnotationQuery.ts";
import type { AnnotationWithDocument } from "../types.ts";

/**
 * One annotation, with the document it belongs to.
 *
 * A pin that is gone is a 404, not an empty row: the caller is a reference
 * written down earlier, and "it was deleted" is the answer the card should be
 * able to draw — the same rule `GET /notes/:id` follows.
 */
@QueryHandler(GetPdfAnnotationQuery, { inject: [PrismaUnitOfWork] })
export class GetPdfAnnotationQueryHandler
  implements IQueryHandler<GetPdfAnnotationQuery, AnnotationWithDocument> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(query: GetPdfAnnotationQuery): Promise<AnnotationWithDocument> {
    const row = await this.uow.db().annotation.findUnique({
      where: { id: query.id },
      include: { pdf_document: { select: { id: true, name: true, file_path: true } } },
    });
    if (!row) throw ErrorFactory.ofNotFound(`Annotation ${query.id} does not exist`);
    return row;
  }
}
