import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ListFocusableStripsQuery } from "../query/ListFocusableStripsQuery.ts";
import type { FocusableStripWithDocument } from "../types.ts";

/** All strips, or the strips of one document / one page / no folder. */
@QueryHandler(ListFocusableStripsQuery, { inject: [PrismaUnitOfWork] })
export class ListFocusableStripsQueryHandler
  implements IQueryHandler<ListFocusableStripsQuery, FocusableStripWithDocument[]> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  handle(query: ListFocusableStripsQuery): Promise<FocusableStripWithDocument[]> {
    const { pdfDocumentId, pageNumber, unfiled } = query.filter;
    return this.uow.db().focusable_strip.findMany({
      where: {
        ...(pdfDocumentId === undefined ? {} : { pdf_document_id: pdfDocumentId }),
        ...(pageNumber === undefined ? {} : { page_number: pageNumber }),
        ...(unfiled === true ? { folder_id: null } : {}),
      },
      // The strip names its document, so this order holds for folder-less strips
      // too. `ordering` is the drag position inside the strip's own home.
      orderBy: [{ pdf_document_id: "asc" }, { ordering: "asc" }, { id: "asc" }],
      include: { pdf_document: { select: { id: true, name: true, file_path: true } } },
    });
  }
}
