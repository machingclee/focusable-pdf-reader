import { QueryHandler, type IQueryHandler } from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { documentHighlightJson, loadDocumentMarks } from "../highlight/marks.ts";
import { GetPdfHighlightsQuery } from "../query/GetPdfHighlightsQuery.ts";

/** The marks of one document. A missing document is a 404, an unmarked one is `[]`. */
@QueryHandler(GetPdfHighlightsQuery, { inject: [PrismaUnitOfWork] })
export class GetPdfHighlightsQueryHandler implements IQueryHandler<GetPdfHighlightsQuery, string> {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async handle(query: GetPdfHighlightsQuery): Promise<string> {
    const db = this.uow.db();
    const document = await db.pdf_document.findUnique({ where: { id: query.id }, select: { id: true } });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${query.id} does not exist`);
    return documentHighlightJson(await loadDocumentMarks(db, query.id));
  }
}
