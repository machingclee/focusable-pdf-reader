/**
 * The decorated components of the bounded contexts.
 *
 * The Node port has no component scanning, so these lists play the role of the
 * `@Component` scan in the Java reference project: one place that says which
 * handlers, services and policies belong to each context. The contexts are
 * wired into a single cqrs module, because they share one database and one
 * transaction per request; the split is about ownership of the code, not a
 * process or schema boundary.
 */

// ── PDF Note Management: documents, their folders and their strips ──
import { AssignNoteFolderCommandHandler } from "./pdf-note-management/commandhandler/AssignNoteFolderCommandHandler.ts";
import { CreateNoteCommandHandler } from "./pdf-note-management/commandhandler/CreateNoteCommandHandler.ts";
import { CreateNoteFolderCommandHandler } from "./pdf-note-management/commandhandler/CreateNoteFolderCommandHandler.ts";
import { DeleteNoteCommandHandler } from "./pdf-note-management/commandhandler/DeleteNoteCommandHandler.ts";
import { DeleteNoteFolderCommandHandler } from "./pdf-note-management/commandhandler/DeleteNoteFolderCommandHandler.ts";
import { DeletePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/DeletePdfDocumentCommandHandler.ts";
import { ImportPdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/ImportPdfDocumentCommandHandler.ts";
import { RenameNoteFolderCommandHandler } from "./pdf-note-management/commandhandler/RenameNoteFolderCommandHandler.ts";
import { RenamePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/RenamePdfDocumentCommandHandler.ts";
import { ReorderNotesCommandHandler } from "./pdf-note-management/commandhandler/ReorderNotesCommandHandler.ts";
import { ReorderNoteFoldersCommandHandler } from "./pdf-note-management/commandhandler/ReorderNoteFoldersCommandHandler.ts";
import { ReorderPdfDocumentsCommandHandler } from "./pdf-note-management/commandhandler/ReorderPdfDocumentsCommandHandler.ts";
import { ResolvePdfDocumentCommandHandler } from "./pdf-note-management/commandhandler/ResolvePdfDocumentCommandHandler.ts";
import { UpdateAppStateCommandHandler } from "./pdf-note-management/commandhandler/UpdateAppStateCommandHandler.ts";
import { UpdateNoteCommandHandler } from "./pdf-note-management/commandhandler/UpdateNoteCommandHandler.ts";
import {
  PlaceNoteCommandHandler,
  RemoveCreatedStripCommandHandler,
  RestoreCreatedStripCommandHandler,
  RestoreNoteCommandHandler,
  RestoreNoteFolderCommandHandler,
  RestoreImportCommandHandler,
  RestorePdfDocumentCommandHandler,
  RevertImportCommandHandler,
} from "./pdf-note-management/commandhandler/HistoryReplayCommandHandlers.ts";
import { GetAppStateQueryHandler } from "./pdf-note-management/queryhandler/GetAppStateQueryHandler.ts";
import { GetNoteQueryHandler } from "./pdf-note-management/queryhandler/GetNoteQueryHandler.ts";
import { ListNotesQueryHandler } from "./pdf-note-management/queryhandler/ListNotesQueryHandler.ts";
import { ListNoteFoldersWithNotesQueryHandler } from "./pdf-note-management/queryhandler/ListNoteFoldersWithNotesQueryHandler.ts";
import { ListPdfDocumentsQueryHandler } from "./pdf-note-management/queryhandler/ListPdfDocumentsQueryHandler.ts";
import { PdfNotesService } from "./pdf-note-management/service/PdfNotesService.ts";
import { PdfPolicy } from "./pdf-note-management/policy/PdfPolicy.ts";

// ── PDF Markup Management: the pins and strokes painted on a document's pages ──
import { CreatePdfAnnotationCommandHandler } from "./pdf-markup-management/commandhandler/CreatePdfAnnotationCommandHandler.ts";
import { DeletePdfAnnotationCommandHandler } from "./pdf-markup-management/commandhandler/DeletePdfAnnotationCommandHandler.ts";
import { UpdatePdfAnnotationCommandHandler } from "./pdf-markup-management/commandhandler/UpdatePdfAnnotationCommandHandler.ts";
import {
  RemoveCreatedAnnotationCommandHandler,
  RestoreAnnotationCommandHandler,
  SetAnnotationFieldsCommandHandler,
} from "./pdf-markup-management/commandhandler/AnnotationReplayCommandHandlers.ts";
import { ReplacePdfHighlightsCommandHandler } from "./pdf-markup-management/commandhandler/ReplacePdfHighlightsCommandHandler.ts";
import { GetPdfAnnotationQueryHandler } from "./pdf-markup-management/queryhandler/GetPdfAnnotationQueryHandler.ts";
import { GetPdfHighlightsQueryHandler } from "./pdf-markup-management/queryhandler/GetPdfHighlightsQueryHandler.ts";
import { ListPdfAnnotationsQueryHandler } from "./pdf-markup-management/queryhandler/ListPdfAnnotationsQueryHandler.ts";

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

// ── PDF Document Folder Management: folders of documents in the rail ──
import { AssignPdfDocumentsToFolderCommandHandler } from "./pdf-document-folder-management/commandhandler/AssignPdfDocumentsToFolderCommandHandler.ts";
import { CreatePdfDocumentFolderCommandHandler } from "./pdf-document-folder-management/commandhandler/CreatePdfDocumentFolderCommandHandler.ts";
import { DeletePdfDocumentFolderCommandHandler } from "./pdf-document-folder-management/commandhandler/DeletePdfDocumentFolderCommandHandler.ts";
import { RestorePdfDocumentFolderCommandHandler } from "./pdf-document-folder-management/commandhandler/HistoryReplayCommandHandlers.ts";
import { RemovePdfDocumentsFromFolderCommandHandler } from "./pdf-document-folder-management/commandhandler/RemovePdfDocumentsFromFolderCommandHandler.ts";
import { RenamePdfDocumentFolderCommandHandler } from "./pdf-document-folder-management/commandhandler/RenamePdfDocumentFolderCommandHandler.ts";
import { ReorderPdfDocumentFolderMembersCommandHandler } from "./pdf-document-folder-management/commandhandler/ReorderPdfDocumentFolderMembersCommandHandler.ts";
import { ReorderPdfDocumentFoldersCommandHandler } from "./pdf-document-folder-management/commandhandler/ReorderPdfDocumentFoldersCommandHandler.ts";
import { ListPdfDocumentFoldersQueryHandler } from "./pdf-document-folder-management/queryhandler/ListPdfDocumentFoldersQueryHandler.ts";
import { PdfDocumentFolderService } from "./pdf-document-folder-management/service/PdfDocumentFolderService.ts";
import { PdfDocumentFolderPolicy } from "./pdf-document-folder-management/policy/PdfDocumentFolderPolicy.ts";

// ── History Management: the session undo and redo stack ──
import { ApplyHistoryCommandHandler } from "./history-management/commandhandler/ApplyHistoryCommandHandler.ts";
import { SessionHistory } from "./history-management/service/SessionHistory.ts";
import { HistoryPolicy } from "./history-management/policy/HistoryPolicy.ts";

// ── Shared infrastructure ──
import { DomainEventLogPolicy } from "./common/DomainEventLogPolicy.ts";

/**
 * Every decorated component of the PDF note management context: documents,
 * their folders and their strips.
 */
export const PDF_NOTE_MANAGEMENT_COMPONENTS = [
  // commands
  ResolvePdfDocumentCommandHandler,
  ImportPdfDocumentCommandHandler,
  RenamePdfDocumentCommandHandler,
  DeletePdfDocumentCommandHandler,
  CreateNoteCommandHandler,
  AssignNoteFolderCommandHandler,
  UpdateNoteCommandHandler,
  DeleteNoteCommandHandler,
  ReorderNotesCommandHandler,
  CreateNoteFolderCommandHandler,
  RenameNoteFolderCommandHandler,
  DeleteNoteFolderCommandHandler,
  ReorderNoteFoldersCommandHandler,
  ReorderPdfDocumentsCommandHandler,
  UpdateAppStateCommandHandler,
  PlaceNoteCommandHandler,
  RemoveCreatedStripCommandHandler,
  RestoreCreatedStripCommandHandler,
  RestoreNoteCommandHandler,
  RestoreNoteFolderCommandHandler,
  RestorePdfDocumentCommandHandler,
  RevertImportCommandHandler,
  RestoreImportCommandHandler,
  // queries
  ListPdfDocumentsQueryHandler,
  ListNotesQueryHandler,
  GetNoteQueryHandler,
  ListNoteFoldersWithNotesQueryHandler,
  GetAppStateQueryHandler,
  // services
  PdfNotesService,
  // policies
  PdfPolicy,
];

/**
 * Every decorated component of the PDF markup management context: the pins and
 * the strokes painted on a document's pages.
 *
 * The context declares no events and has no policy of its own. Its commands
 * record a step through `recordHistory`, the way the notes and tag contexts do,
 * so the only event in play is the history context's `HistoryUndoRedoReadyEvent`.
 */
export const PDF_MARKUP_MANAGEMENT_COMPONENTS = [
  // commands
  CreatePdfAnnotationCommandHandler,
  UpdatePdfAnnotationCommandHandler,
  DeletePdfAnnotationCommandHandler,
  RestoreAnnotationCommandHandler,
  RemoveCreatedAnnotationCommandHandler,
  SetAnnotationFieldsCommandHandler,
  ReplacePdfHighlightsCommandHandler,
  // queries
  GetPdfHighlightsQueryHandler,
  ListPdfAnnotationsQueryHandler,
  GetPdfAnnotationQueryHandler,
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
 * Every decorated component of the document-folder context: the folders in the
 * Documents rail and the memberships that file a document in one.
 */
export const PDF_DOCUMENT_FOLDER_MANAGEMENT_COMPONENTS = [
  CreatePdfDocumentFolderCommandHandler,
  RenamePdfDocumentFolderCommandHandler,
  ReorderPdfDocumentFoldersCommandHandler,
  DeletePdfDocumentFolderCommandHandler,
  AssignPdfDocumentsToFolderCommandHandler,
  RemovePdfDocumentsFromFolderCommandHandler,
  ReorderPdfDocumentFolderMembersCommandHandler,
  RestorePdfDocumentFolderCommandHandler,
  ListPdfDocumentFoldersQueryHandler,
  PdfDocumentFolderService,
  PdfDocumentFolderPolicy,
];

/**
 * What the process actually wires: the contexts share one database and one
 * transaction per request, plus the development event log, which belongs to none.
 */
export const PDF_FOCUS_VIEWER_COMPONENTS = [
  ...PDF_NOTE_MANAGEMENT_COMPONENTS,
  ...PDF_MARKUP_MANAGEMENT_COMPONENTS,
  ...PDF_TAG_MANAGEMENT_COMPONENTS,
  ...PDF_DOCUMENT_FOLDER_MANAGEMENT_COMPONENTS,
  ...HISTORY_MANAGEMENT_COMPONENTS,
  DomainEventLogPolicy,
];
