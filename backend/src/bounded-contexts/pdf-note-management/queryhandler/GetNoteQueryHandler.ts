import { QueryHandler, type IQueryHandler } from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { presentPages } from "../../pdf-markup-management/highlight/marks.ts";
import { GetNoteQuery } from "../query/GetNoteQuery.ts";
import type { NoteWithDocument } from "../types.ts";

/**
 * One strip, with the document it belongs to.
 *
 * A strip that is gone is a 404 rather than a null body: the caller is a
 * reference written down earlier, and the honest answer to "where is note 12"
 * is that it no longer exists — which the card draws as a deleted note instead
 * of an empty one.
 */
@QueryHandler(GetNoteQuery, { inject: [PrismaUnitOfWork] })
export class GetNoteQueryHandler
  implements IQueryHandler<GetNoteQuery, NoteWithDocument> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(query: GetNoteQuery): Promise<NoteWithDocument> {
    const strip = await this.uow.db().note.findUnique({
      where: { id: query.id },
      // The same shape `/notes` answers with, so one type describes
      // both and the nested note reads `pdf_document` without a second request.
      include: {
        pdf_document: { select: { id: true, name: true, file_path: true } },
      },
    });
    if (!strip) throw ErrorFactory.ofNotFound(`Focusable strip ${query.id} does not exist`);
    const [presented] = await presentPages(this.uow.db(), [strip]);
    return presented!;
  }
}
