/**
 * The decorated components of the three bounded contexts.
 *
 * The Node port has no component scanning, so these lists play the role of the
 * `@Component` scan in the Java reference project: one place that says which
 * handlers, services and policies belong to each context. The contexts are
 * wired into a single cqrs module, because they share one database and one
 * transaction per request; the split is about ownership of the code, not a
 * process or schema boundary.
 */

// ── PDF Note Management: documents, folders, strips, highlights ──
import { AssignFocusableStripFolderCommandHandler } from "./pdf-note-management/commandhandler/AssignFocusableStripFolderCommandHandler.ts";
import { CreateFocusableStripCommandHandler } from "./pdf-note-management/commandhandler/CreateFocusableStripCommandHandler.ts";
import { CreateFolderCommandHandler } from "./pdf-note-management/commandhandler/CreateFolderCommandHandler.ts";
import { DeleteFocusableStripCommandHandler } from "./pdf-note-management/commandhandler/DeleteFocusableStripCommandHandler.ts";
import { DeleteFolderCommandHandler } from "./pdf-note-management/commandhandler/DeleteFolderCommandHandler.ts";
import { DeletePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/DeletePdfDocumentCommandHandler.ts";
import { ImportPdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/ImportPdfDocumentCommandHandler.ts";
import { RenameFolderCommandHandler } from "./pdf-note-management/commandhandler/RenameFolderCommandHandler.ts";
import { RenamePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/RenamePdfDocumentCommandHandler.ts";
import { ReorderFocusableStripsCommandHandler } from "./pdf-note-management/commandhandler/ReorderFocusableStripsCommandHandler.ts";
import { ReorderFoldersCommandHandler } from "./pdf-note-management/commandhandler/ReorderFoldersCommandHandler.ts";
import { ReorderPdfDocumentsCommandHandler } from "./pdf-note-management/commandhandler/ReorderPdfDocumentsCommandHandler.ts";
import { ReplacePdfHighlightsCommandHandler } from "./pdf-note-management/commandhandler/ReplacePdfHighlightsCommandHandler.ts";
import { ResolvePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/ResolvePdfDocumentCommandHandler.ts";
import { UpdateAppStateCommandHandler } from "./pdf-note-management/commandhandler/UpdateAppStateCommandHandler.ts";
import { UpdateFocusableStripCommandHandler } from "./pdf-note-management/commandhandler/UpdateFocusableStripCommandHandler.ts";
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
import { GetAppStateQueryHandler } from "./pdf-note-management/queryhandler/GetAppStateQueryHandler.ts";
import { GetFocusableStripQueryHandler } from "./pdf-note-management/queryhandler/GetFocusableStripQueryHandler.ts";
import { GetPdfHighlightsQueryHandler } from "./pdf-note-management/queryhandler/GetPdfHighlightsQueryHandler.ts";
import { ListFocusableStripsQueryHandler } from "./pdf-note-management/queryhandler/ListFocusableStripsQueryHandler.ts";
import { ListFoldersWithStripsQueryHandler } from "./pdf-note-management/queryhandler/ListFoldersWithStripsQueryHandler.ts";
import { ListPdfDocumentsQueryHandler } from "./pdf-note-management/queryhandler/ListPdfDocumentsQueryHandler.ts";
import { PdfNotesService } from "./pdf-note-management/service/PdfNotesService.ts";
import { PdfPolicy } from "./pdf-note-management/policy/PdfPolicy.ts";

// ── PDF Tag Management: the tag catalogue, its folders and assignments ──
import { AssignPdfTagsCommandHandler } from "./pdf-tag-management/commandhandler/AssignPdfTagsCommandHandler.ts";
import { CreatePdfTagCommandHandler } from "./pdf-tag-management/commandhandler/CreatePdfTagCommandHandler.ts";
import { CopyPdfTagsCommandHandler } from "./pdf-tag-management/commandhandler/CopyPdfTagsCommandHandler.ts";
import { CreatePdfTagFolderCommandHandler } from "./pdf-tag-management/commandhandler/CreatePdfTagFolderCommandHandler.ts";
import { DeleteAssignedPdfTagsCommandHandler } from "./pdf-tag-management/commandhandler/DeleteAssignedPdfTagsCommandHandler.ts";
import { DeletePdfTagCommandHandler } from "./pdf-tag-management/commandhandler/DeletePdfTagCommandHandler.ts";
import { DeletePdfTagFolderCommandHandler } from "./pdf-tag-management/commandhandler/DeletePdfTagFolderCommandHandler.ts";
import { RenamePdfTagFolderCommandHandler } from "./pdf-tag-management/commandhandler/RenamePdfTagFolderCommandHandler.ts";
import { ReorderPdfTagFoldersCommandHandler } from "./pdf-tag-management/commandhandler/ReorderPdfTagFoldersCommandHandler.ts";
import { UnassignPdfTagsCommandHandler } from "./pdf-tag-management/commandhandler/UnassignPdfTagsCommandHandler.ts";
import { UpdatePdfTagCommandHandler } from "./pdf-tag-management/commandhandler/UpdatePdfTagCommandHandler.ts";
import {
  ReplaceDocumentPdfTagsCommandHandler,
  RestorePdfTagCommandHandler,
  RestorePdfTagFolderCommandHandler,
} from "./pdf-tag-management/commandhandler/HistoryReplayCommandHandlers.ts";
import { ListPdfTagFoldersQueryHandler } from "./pdf-tag-management/queryhandler/ListPdfTagFoldersQueryHandler.ts";
import { ListPdfTagsQueryHandler } from "./pdf-tag-management/queryhandler/ListPdfTagsQueryHandler.ts";
import { PdfTagCatalogService } from "./pdf-tag-management/service/PdfTagCatalogService.ts";
import { PdfTagPolicy } from "./pdf-tag-management/policy/PdfTagPolicy.ts";

// ── History Management: the session undo and redo stack ──
import { ApplyHistoryCommandHandler } from "./history-management/commandhandler/ApplyHistoryCommandHandler.ts";
import { SessionHistory } from "./history-management/service/SessionHistory.ts";
import { HistoryPolicy } from "./history-management/policy/HistoryPolicy.ts";

// ── Shared infrastructure ──
import { DomainEventLogPolicy } from "./common/DomainEventLogPolicy.ts";

/**
 * Every decorated component of the PDF note management context: documents,
 * their folders, strips and highlights.
 */
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
  // policies
  PdfPolicy,
];

/**
 * Every decorated component of the PDF tag management context: the tag
 * catalogue, its folders and the assignment rows.
 */
export const PDF_TAG_MANAGEMENT_COMPONENTS = [
  // commands
  CreatePdfTagFolderCommandHandler,
  RenamePdfTagFolderCommandHandler,
  ReorderPdfTagFoldersCommandHandler,
  DeletePdfTagFolderCommandHandler,
  CreatePdfTagCommandHandler,
  UpdatePdfTagCommandHandler,
  DeletePdfTagCommandHandler,
  DeleteAssignedPdfTagsCommandHandler,
  AssignPdfTagsCommandHandler,
  UnassignPdfTagsCommandHandler,
  CopyPdfTagsCommandHandler,
  RestorePdfTagFolderCommandHandler,
  RestorePdfTagCommandHandler,
  ReplaceDocumentPdfTagsCommandHandler,
  // queries
  ListPdfTagFoldersQueryHandler,
  ListPdfTagsQueryHandler,
  // services
  PdfTagCatalogService,
  // policies
  PdfTagPolicy,
];

/**
 * Every decorated component of the history management context: the session
 * stack, the command that walks it, and the policy that fills it after a
 * change commits.
 */
export const HISTORY_MANAGEMENT_COMPONENTS = [
  // commands
  ApplyHistoryCommandHandler,
  // services
  SessionHistory,
  // policies
  HistoryPolicy,
];

/**
 * What the process actually wires: all three contexts, because one request can
 * span them (a document delete carries the tag assignments to remove, and every
 * reader command in either context records a history step), plus the
 * development event log, which belongs to none.
 */
export const PDF_FOCUS_VIEWER_COMPONENTS = [
  ...PDF_NOTE_MANAGEMENT_COMPONENTS,
  ...PDF_TAG_MANAGEMENT_COMPONENTS,
  ...HISTORY_MANAGEMENT_COMPONENTS,
  DomainEventLogPolicy,
];
