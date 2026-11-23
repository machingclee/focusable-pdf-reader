import { QueryHandler, type IQueryHandler } from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { GetFocusableStripQuery } from "../query/GetFocusableStripQuery.ts";
import type { FocusableStripWithDocument } from "../types.ts";

/**
 * One strip, with the document it belongs to.
 *
 * A strip that is gone is a 404 rather than a null body: the caller is a
 * reference written down earlier, and the honest answer to "where is note 12"
 * is that it no longer exists — which the card draws as a deleted note instead
 * of an empty one.
 */
@QueryHandler(GetFocusableStripQuery, { inject: [PrismaUnitOfWork] })
export class GetFocusableStripQueryHandler
  implements IQueryHandler<GetFocusableStripQuery, FocusableStripWithDocument> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(query: GetFocusableStripQuery): Promise<FocusableStripWithDocument> {
    const strip = await this.uow.db().focusable_strip.findUnique({
      where: { id: query.id },
      // The same shape `/focusable-strips` answers with, so one type describes
      // both and the nested note reads `pdf_document` without a second request.
      include: { pdf_document: { select: { id: true, name: true, file_path: true } } },
    });
    if (!strip) throw ErrorFactory.ofNotFound(`Focusable strip ${query.id} does not exist`);
    return strip;
  }
}
