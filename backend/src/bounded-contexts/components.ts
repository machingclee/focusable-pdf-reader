/**
 * The decorated components of the PDF notes bounded context.
 *
 * The Node port has no component scanning, so this list plays the role of the
 * `@Component` scan in the Java reference project: one place that says which
 * handlers, services and policies belong to this bounded context.
 */

import { ApplyHistoryCommandHandler } from "./pdf-note-management/commandhandler/ApplyHistoryCommandHandler.ts";
import { AssignFocusableStripFolderCommandHandler } from "./pdf-note-management/commandhandler/AssignFocusableStripFolderCommandHandler.ts";
import { CreateFocusableStripCommandHandler } from "./pdf-note-management/commandhandler/CreateFocusableStripCommandHandler.ts";
import { CreateFolderCommandHandler } from "./pdf-note-management/commandhandler/CreateFolderCommandHandler.ts";
import { DeleteFocusableStripCommandHandler } from "./pdf-note-management/commandhandler/DeleteFocusableStripCommandHandler.ts";
import { DeleteFolderCommandHandler } from "./pdf-note-management/commandhandler/DeleteFolderCommandHandler.ts";
import { DeletePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/DeletePdfDocumentCommandHandler.ts";
import {
  PlaceFocusableStripCommandHandler,
  RemoveCreatedStripCommandHandler,
  RestoreCreatedStripCommandHandler,
  RestoreFocusableStripCommandHandler,
  RestoreFolderCommandHandler,
  RestoreImportCommandHandler,
  RestorePdfDocumentCommandHandler,
  RevertImportCommandHandler,
} from "./pdf-note-management/commandhandler/HistoryReplayCommandHandlers.ts";
import { ImportPdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/ImportPdfDocumentCommandHandler.ts";
import { RenameFolderCommandHandler } from "./pdf-note-management/commandhandler/RenameFolderCommandHandler.ts";
import { RenamePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/RenamePdfDocumentCommandHandler.ts";
import { ReorderFocusableStripsCommandHandler } from "./pdf-note-management/commandhandler/ReorderFocusableStripsCommandHandler.ts";
import { ReorderFoldersCommandHandler } from "./pdf-note-management/commandhandler/ReorderFoldersCommandHandler.ts";
import { ReorderPdfDocumentsCommandHandler } from "./pdf-note-management/commandhandler/ReorderPdfDocumentsCommandHandler.ts";
import { ResolvePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/ResolvePdfDocumentCommandHandler.ts";
import { UpdateAppStateCommandHandler } from "./pdf-note-management/commandhandler/UpdateAppStateCommandHandler.ts";
import { ReplacePdfHighlightsCommandHandler } from "./pdf-note-management/commandhandler/ReplacePdfHighlightsCommandHandler.ts";
import { UpdateFocusableStripCommandHandler } from "./pdf-note-management/commandhandler/UpdateFocusableStripCommandHandler.ts";
import { DomainEventLogPolicy } from "./common/DomainEventLogPolicy.ts";
import { HistoryPolicy } from "./pdf-note-management/policy/HistoryPolicy.ts";
import { PdfPolicy } from "./pdf-note-management/policy/PdfPolicy.ts";
import { SessionHistory } from "./pdf-note-management/history/SessionHistory.ts";
import { PdfNotesService } from "./pdf-note-management/service/PdfNotesService.ts";
import { GetAppStateQueryHandler } from "./pdf-note-management/queryhandler/GetAppStateQueryHandler.ts";
import { GetPdfHighlightsQueryHandler } from "./pdf-note-management/queryhandler/GetPdfHighlightsQueryHandler.ts";
import { GetFocusableStripQueryHandler } from "./pdf-note-management/queryhandler/GetFocusableStripQueryHandler.ts";
import { ListFocusableStripsQueryHandler } from "./pdf-note-management/queryhandler/ListFocusableStripsQueryHandler.ts";
import { ListFoldersWithStripsQueryHandler } from "./pdf-note-management/queryhandler/ListFoldersWithStripsQueryHandler.ts";
import { ListPdfDocumentsQueryHandler } from "./pdf-note-management/queryhandler/ListPdfDocumentsQueryHandler.ts";

/** Every decorated component the domain pipeline should instantiate. */
export const PDF_NOTE_MANAGEMENT_COMPONENTS = [
  // commands
  ResolvePdfDocumentCommandHandler,
  ImportPdfDocumentCommandHandler,
  RenamePdfDocumentCommandHandler,
  DeletePdfDocumentCommandHandler,
  CreateFocusableStripCommandHandler,
  AssignFocusableStripFolderCommandHandler,
  UpdateFocusableStripCommandHandler,
  ReplacePdfHighlightsCommandHandler,
  DeleteFocusableStripCommandHandler,
  ReorderFocusableStripsCommandHandler,
  CreateFolderCommandHandler,
  RenameFolderCommandHandler,
  DeleteFolderCommandHandler,
  ReorderFoldersCommandHandler,
  ReorderPdfDocumentsCommandHandler,
  UpdateAppStateCommandHandler,
  ApplyHistoryCommandHandler,
  PlaceFocusableStripCommandHandler,
  RemoveCreatedStripCommandHandler,
  RestoreCreatedStripCommandHandler,
  RestoreFocusableStripCommandHandler,
  RestoreFolderCommandHandler,
  RestorePdfDocumentCommandHandler,
  RevertImportCommandHandler,
  RestoreImportCommandHandler,
  // queries
  ListPdfDocumentsQueryHandler,
  ListFocusableStripsQueryHandler,
  GetFocusableStripQueryHandler,
  ListFoldersWithStripsQueryHandler,
  GetAppStateQueryHandler,
  GetPdfHighlightsQueryHandler,
  // services
  PdfNotesService,
  SessionHistory,
  // policies
  PdfPolicy,
  HistoryPolicy,
  DomainEventLogPolicy,
];
