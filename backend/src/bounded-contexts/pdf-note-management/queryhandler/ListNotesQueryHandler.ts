import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { presentPages } from "../../pdf-markup-management/highlight/marks.ts";
import { ListNotesQuery } from "../query/ListNotesQuery.ts";
import type { NoteWithDocument } from "../types.ts";

/** All strips, or the strips of one document / one page / no folder. */
@QueryHandler(ListNotesQuery, { inject: [PrismaUnitOfWork] })
export class ListNotesQueryHandler
  implements IQueryHandler<ListNotesQuery, NoteWithDocument[]> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(query: ListNotesQuery): Promise<NoteWithDocument[]> {
    const { pdfDocumentId, pageNumber, unfiled } = query.filter;
    const strips = await this.uow.db().note.findMany({
      where: {
        ...(pdfDocumentId === undefined ? {} : { pdf_document_id: pdfDocumentId }),
        ...(pageNumber === undefined ? {} : { page_number: pageNumber }),
        ...(unfiled === true ? { note_folder_id: null } : {}),
      },
      // The strip names its document, so this order holds for folder-less strips
      // too. `ordering` is the drag position inside the strip's own home.
      orderBy: [{ pdf_document_id: "asc" }, { ordering: "asc" }, { id: "asc" }],
      include: {
        pdf_document: { select: { id: true, name: true, file_path: true } },
      },
    });
    return presentPages(this.uow.db(), strips);
  }
}
