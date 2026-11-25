# PLAN: document tags — explicit junction, assign / unassign commands

## 1. Goal and success criteria

Give PDF documents tags, managed entirely inside the Notes view:

- a **Tags** button beside "Documents" opens a tag manager popover: tag folders on the left, their tags on the right, with create / rename / move / delete / drag-reorder;
- right-clicking a document row has a **Tags…** item that opens a small assignment popover (folder sidebar + tag checkboxes, Save/Cancel);
- the documents rail filters by tag, and each row shows its tags.

Done means: every command below exists with a handler, event, schema and router; assignment is two explicit commands that **create and delete `assigned_pdf_tag` rows plus their junction rows** (mirroring `AssignTagToScriptHandler` / `UnassignTagFromScriptHandler`); the three UI surfaces work against the real backend; `bun test` and `bun run typecheck` pass; the schema in `schema.prisma` matches the ERD in `backend/prisma/draw.io/schema.drawio`.

## 2. Why two commands instead of a set-replace

The previous plan had one `SetPdfDocumentTagsCommand` (set-replace) and no command that visibly creates the assignment entity. This revision replaces it with two commands that map 1:1 to the reference project's assign/unassign handlers, and with the reference endpoints (`POST` / `DELETE /scripts/{id}/tags` → `POST` / `DELETE /pdf-documents/{id}/tags`). Nothing else in the data model changes; the ERD stays as it is.

## 3. Schema (unchanged from the approved ERD)

```prisma
model pdf_tag_folder {
  id Int @id @default(autoincrement())
  name String
  name_lower String @unique   // written by the API
  ordering Int
  created_at Float
  tags pdf_tag[]
  @@index([id]) @@index([ordering])
}

model pdf_tag {
  id Int @id @default(autoincrement())
  name String
  name_lower String @unique
  pdf_tag_folder_id Int?
  pdf_tag_folder pdf_tag_folder? @relation(fields: [pdf_tag_folder_id], references: [id], onDelete: SetNull)
  created_at Float
  assignments assigned_pdf_tag[]
  @@index([id]) @@index([pdf_tag_folder_id])
}

/// No pdf_document_id: the document lives in the junction.
model assigned_pdf_tag {
  id Int @id @default(autoincrement())
  pdf_tag_id Int
  pdf_tag pdf_tag @relation(fields: [pdf_tag_id], references: [id], onDelete: Cascade)
  created_at Float
  documents rel_pdf_document_assigned_pdf_tag[]
  @@index([id]) @@index([pdf_tag_id])
}

model rel_pdf_document_assigned_pdf_tag {
  id Int @id @default(autoincrement())
  pdf_document_id Int
  pdf_document pdf_document @relation(fields: [pdf_document_id], references: [id], onDelete: Cascade)
  assigned_pdf_tag_id Int
  assigned_pdf_tag assigned_pdf_tag @relation(fields: [assigned_pdf_tag_id], references: [id], onDelete: Cascade)
  created_at Float
  @@unique([pdf_document_id, assigned_pdf_tag_id])
  @@index([pdf_document_id]) @@index([assigned_pdf_tag_id])
}
```

`pdf_document` gains `assigned_tags rel_pdf_document_assigned_pdf_tag[]`. Migration: `2026…_add_pdf_tags` (four tables, FKs, unique pair, indexes). `prisma migrate dev` cannot be used on the current `dev.db` (it already carries a duplicate-name `rename_default_folder_to_notes` row), so generate the SQL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` and apply with `prisma migrate deploy`; then `bun run codegen`.

## 4. Backend

All in `bounded-contexts/pdf-tag-management` (the tag catalogue is its own bounded context, `PDF Tag Management`), registered as `PDF_TAG_MANAGEMENT_COMPONENTS` in `bounded-contexts/components.ts`.

### 4.1 Commands (9)

| Command | Payload | Returns |
| --- | --- | --- |
| `CreatePdfTagFolderCommand` | `{ name }` | `PdfTagFolder` |
| `RenamePdfTagFolderCommand` | `id, name` | `PdfTagFolder` |
| `ReorderPdfTagFoldersCommand` | `{ pdf_tag_folder_ids }` | `PdfTagFolder[]` |
| `DeletePdfTagFolderCommand` | `id` | `void` |
| `CreatePdfTagCommand` | `{ name, pdf_tag_folder_id? }` | `PdfTagWithCount` |
| `UpdatePdfTagCommand` | `id, { name?, pdf_tag_folder_id?: number \| null }` | `PdfTagWithCount` |
| `DeletePdfTagCommand` | `id` | `void` |
| **`AssignPdfTagsCommand`** | `pdfDocumentId, pdfTagIds: number[]` | `DocumentTag[]` |
| **`UnassignPdfTagsCommand`** | `pdfDocumentId, pdfTagIds: number[]` | `DocumentTag[]` |
| **`CopyPdfTagsCommand`** | `fromDocumentId, toDocumentId` | `DocumentTag[]` (the target's, after the overwrite) |
| `DeleteAssignedPdfTagsCommand` (sent by policy, no route) | `documentId, assignedPdfTagIds: number[]` | `void` |

Events: `PdfTagFolderCreatedEvent`, `PdfTagFolderRenamedEvent`, `PdfTagFoldersReorderedEvent`, `PdfTagFolderDeletedEvent` (folder id + number of tags it held), `PdfTagCreatedEvent`, `PdfTagUpdatedEvent`, `PdfTagDeletedEvent` (tag id + assignment count), **`PdfTagsAssignedEvent`** (documentId, count), **`PdfTagsUnassignedEvent`** (documentId, count), **`PdfTagsCopiedEvent`** (fromDocumentId, toDocumentId, removedCount, assignedCount; sent only when the overwrite changed something), **`AssignedPdfTagsDeletedEvent`** (documentId, deletedCount, from the policy-sent cleanup). Every reader command also emits **`HistoryUndoRedoReadyEvent`** transactionally, carrying the command that undoes it and the command that redoes it (section 4.5).

Queries: `ListPdfTagFoldersQuery` → `PdfTagFolder[]`; `ListPdfTagsQuery` → `PdfTagWithCount[]` (`_count.assignments` as `document_count`, sorted folder `ordering` then name, Ungrouped last).

Service `PdfTagCatalogService`: `normalize` (trim + collapse whitespace, 1..64), `key` (lowercase), `assertUniqueFolder` / `assertUniqueTag` (409 with the existing name), the catalogue comparator, `tagsForDocument(db, id)` → `DocumentTag[]`, `assignmentIdsForDocument(db, id)` → `number[]` (the notes context calls it before deleting a document).

### 4.2 Assignment semantics

`AssignPdfTagsCommandHandler`:

1. load the document (404 if absent) and dedupe `pdfTagIds`;
2. read the document's existing assignment links;
3. load the requested `pdf_tag` rows; a missing id → 400 naming it;
4. for every requested tag **not already assigned**, create one `assigned_pdf_tag` (with `pdf_tag_id`, `created_at`) plus its junction row (`pdf_document_id`);
5. already-assigned ids are skipped, so retrying the same Save is safe;
6. add `PdfTagsAssignedEvent(documentId, createdCount)`, return `DocumentTag[]` for the document.

`UnassignPdfTagsCommandHandler`:

1. load the document (404) and its links whose `pdf_tag_id` is in the payload;
2. delete each matching `assigned_pdf_tag` row — its junction row goes by cascade; ids that are not assigned are skipped;
3. add `PdfTagsUnassignedEvent(documentId, removedCount)`, return the remaining `DocumentTag[]`.

`CopyPdfTagsCommandHandler` — the rail's paste:

1. load both documents (404 naming the one that is absent) with their assignment links; a document copied onto itself is one read and one comparison;
2. `wanted` = the source's tag ids, `carried` = the target's; the removals are the target's links whose tag is not wanted, the additions the wanted tags the target does not carry;
3. nothing on either side → return the target's tags, no event (a repeated paste writes nothing, like a repeated assign);
4. delete each removal's `assigned_pdf_tag` row (its junction cascades), then create one assignment plus junction per addition — the pair `AssignPdfTags` writes;
5. add `PdfTagsCopiedEvent(fromDocumentId, toDocumentId, removedCount, assignedCount)` and return the target's `DocumentTag[]`.

The copy is a *replace*, and it is one command rather than an unassign request followed by an assign request: a paste that failed between them would leave the target short of tags with nothing to undo it.

One assignment row belongs to exactly one document: unassign deletes the row, never shares it. The database cannot enforce "one assignment per (document, tag)" because the two ids live in different tables, so step 2 of assign is the enforcement point, plus a test that assigns the same tag twice.

### 4.3 API

One router, `pdfTagRouter`, mounted at `/pdf-tags`; the tag folders are its `/folders` sub-resource. Assignment stays on the document router because it acts on a document.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/pdf-tags` | — | `PdfTagWithCount[]` |
| POST | `/pdf-tags` | `{ name, pdf_tag_folder_id? }` | 201 `PdfTag` |
| PATCH | `/pdf-tags/:id` | `{ name?, pdf_tag_folder_id?: number \| null }` | `PdfTag` |
| DELETE | `/pdf-tags/:id` | — | 204 when no document carries it; 400 otherwise |
| GET | `/pdf-tags/folders` | — | `PdfTagFolder[]` |
| POST | `/pdf-tags/folders` | `{ name }` | 201 `PdfTagFolder` |
| POST | `/pdf-tags/folders/reorder` | `{ pdf_tag_folder_ids }` | `PdfTagFolder[]` |
| PATCH | `/pdf-tags/folders/:id` | `{ name }` | `PdfTagFolder` |
| DELETE | `/pdf-tags/folders/:id` | — | 204 when it holds no tags; 400 otherwise |
| **POST** | **`/pdf-documents/:id/tags`** | `{ pdf_tag_ids }` | 200 `DocumentTag[]` |
| **DELETE** | **`/pdf-documents/:id/tags`** | `{ pdf_tag_ids }` | 200 `DocumentTag[]` |
| **POST** | **`/pdf-documents/:id/tags/copy`** | `{ from_document_id }` | 200 `DocumentTag[]` (the target's new tags) |
| GET | `/pdf-documents` | — | adds `tags: DocumentTag[]` |

`createDocRouter` validates a body on DELETE like any other method, so the DELETE-with-body mirrors the reference. `PdfDocumentWithCountSchema` gains `tags`; `PdfNotesService.listDocuments` includes `assigned_tags → assigned_pdf_tag → pdf_tag` and flattens to `{ id, name, pdf_tag_folder_id }`, sorted folder ordering then name.

`DeletePdfDocumentCommandHandler` no longer deletes assignments itself: it asks `PdfTagCatalogService.assignmentIdsForDocument` for their ids before deleting the document (their junction rows cascade with it) and puts them on `PdfDocumentDeletedEvent`. `PdfTagPolicy` reacts by sending `DeleteAssignedPdfTagsCommand`, whose handler deletes those `assigned_pdf_tag` rows in the same transaction, so no orphan assignment survives and the document delete knows nothing about the tag catalogue.

### 4.4 Invariants and error codes

- Duplicate folder/tag name (case-insensitive) → 409; invalid name → 400; unknown folder/tag/document → 404; unknown tag id in an assignment → 400 naming it.
- Only an empty tag folder can be deleted (400 naming the tag count otherwise); only an unused tag can be deleted (400 naming the assignment count otherwise). Both rules live in `PdfTagPolicy`, which throws on the event and rolls the delete back. Deleting a document deletes its assignments and junctions through the policy-sent `DeleteAssignedPdfTagsCommand`.
- Folder `ordering` stays dense after reorder and after delete.
- Assign/unassign/copy are idempotent; only actual changes are counted in the event, and a copy that changes nothing sends none.
- Every command emits exactly one business event, so the audit trail and event-storming diagram stay complete; reader commands add the post-commit `HistoryUndoRedoReadyEvent` described in section 4.5.

### 4.5 Session history

The tag catalogue shares the process-wide `SessionHistory` with the notes context; the
stack belongs to the `History Management` context, which declares `HistoryUndoRedoReadyEvent`.
The reader has one Cmd+Z, and a tag rename or a paste is the same step as a strip. Every reader command calls `recordHistory`, which adds `HistoryUndoRedoReadyEvent` with `addTransactional`, so the step reaches the stack only after the write commits and a policy refusal (an empty-folder or unused-tag rule) leaves no undo behind. Applying an undo or redo suppresses recording, so the stored command just moves between stacks.

| Command | Undo (opposite command) | Redo |
| --- | --- | --- |
| `CreatePdfTagFolderCommand` | `DeletePdfTagFolderCommand` | `RestorePdfTagFolderCommand` (same id, same order) |
| `RenamePdfTagFolderCommand` | `RenamePdfTagFolderCommand` (previous name) | the command |
| `ReorderPdfTagFoldersCommand` | `ReorderPdfTagFoldersCommand` (previous permutation) | the command |
| `DeletePdfTagFolderCommand` | `RestorePdfTagFolderCommand` (row + complete order) | the command |
| `CreatePdfTagCommand` | `DeletePdfTagCommand` | `RestorePdfTagCommand` (same id) |
| `UpdatePdfTagCommand` | `UpdatePdfTagCommand` (previous name and folder) | the command |
| `DeletePdfTagCommand` | `RestorePdfTagCommand` (same id) | the command |
| `AssignPdfTagsCommand` | `UnassignPdfTagsCommand` (only the tags it added) | the command |
| `UnassignPdfTagsCommand` | `AssignPdfTagsCommand` (only the tags it removed) | the command |
| `CopyPdfTagsCommand` | `ReplaceDocumentPdfTagsCommand` (the target's previous set) | the command |

Two kinds of command deliberately record no step. `DeleteAssignedPdfTagsCommand` is the policy's cleanup of a deleted document's assignments; it runs inside the document delete, whose own step already owns the undo, and a separate step could not restore an assignment to a document that is gone. The three `historyReplayCommands` (`RestorePdfTagFolderCommand`, `RestorePdfTagCommand`, `ReplaceDocumentPdfTagsCommand`) exist only to replay a stored step, so they emit nothing and are not reader actions.

A command that changes nothing (a repeated assign, a reorder to the same permutation, a rename to the same name) records no step. Undoing a create deletes the row and redoing it inserts the same id, so the commands stored after it keep naming a row that exists. Undoing a folder delete restores the deleted row and rewrites every folder's `ordering`, because the delete had left the survivors dense.

## 5. Frontend

### 5.1 Types and API

`src/types/dto.ts`: `PdfTagFolder`, `PdfTag` (with `document_count`), `DocumentTag = { id, name, pdf_tag_folder_id }`, and `PdfDocumentListItem` gains `tags: DocumentTag[]`.

`src/store/api/baseApi.ts`: `ALL_TAG_TYPES` += `"PdfTag"`, `"PdfTagFolder"` (cross-window invalidation comes free).

New `src/store/api/pdfTagApi.ts`: `listPdfTags`, `createPdfTag`, `updatePdfTag`, `deletePdfTag`, `listPdfTagFolders`, `createPdfTagFolder`, `renamePdfTagFolder`, `deletePdfTagFolder`, `reorderPdfTagFolders`. Mutations invalidate `PdfTag` and `PdfTagFolder` (and `PdfDocument` LIST when a name, folder or assignment feeds the rail rows).

`src/store/api/pdfDocumentApi.ts`: **`assignPdfTags({ id, pdf_tag_ids })`** (POST) and **`unassignPdfTags({ id, pdf_tag_ids })`** (DELETE with body); both invalidate `PdfDocument` LIST and `PdfTag` (counts change).

Pure helpers: `src/tagFilter.ts` (`matchesTagFilter`: space-separated parts, case-insensitive; `stripTagsCommand`, which reads a `/tags` draft) and `src/documentTagFilter.ts` (`filterDocumentsByTag`: one tag at a time, and `pruneMissingTag`). `src/documentTagClipboard.ts` holds the document a copy came from, so a paste is the server's `CopyPdfTagsCommand` rather than a diff worked out in the window.

### 5.2 UI flows

- **Tag manager popover** (`TagManagerPopover`), portalled, anchored under a new `🏷` button in the `Documents` header (next to the count). Reference layout: a toolbar over each pane with a bordered `+ Tag Folder` / `+ Tag` button; folders with a drag grip, the first one selected on open, "Ungrouped" under a divider; plain tag rows for the selected folder; the search box searches every tag. Row actions live in a right-click menu — rename, move-to-folder, delete (two clicks, and the tag's delete says how many documents carry it). Dragging a folder row reorders the catalogue. Inline forms, no modals. The panel has a fixed height, so the two lists scroll instead of the panel resizing as the folder changes.
- **Assignment popover** (`DocumentTagsPopover`), opened by a new `Tags…` item in `DocumentContextMenu`: folder sidebar + tag checkboxes + search + inline "New tag"/"New folder"; local selection; Save computes the diff and sends **unassign for removed, then assign for added** (reference order), disabling Save while either call is in flight and showing backend errors inline; Cancel/Escape discards. The panel has a fixed height (both lists scroll), the footer lists the document's current tags as chips — the folder over the tag name, each with a **×** that takes it off the selection (Save writes the removal) — beside Cancel/Save, and each pane ends in an add row pinned to its bottom: the `+ New folder` / `+ New tag` button sits there and the name field takes its place, so starting a name neither floats the field over the list nor scrolls it away, and `Escape` cancels the add (dropping the draft and returning focus to the button) while leaving the popover open.
- **Filter field + chip** (`TagFilterInput`): the `Filter` button beside Tags is now a text field — the reference project's `/tags` search, which advertises a "more refined tag search", ported to the rail. Typing narrows the tag catalogue into a portalled list under the field; `Tab` / `↓` move the highlight down the list and `Shift+Tab` / `↑` move it back up, clamped at either end; `Enter` takes the highlighted tag — or the first match when nothing is highlighted — which applies the filter and empties the field; `Escape` clears the text and puts the field down. One tag at a time: a pick replaces the last. The picked tag appears as a chip with `×`, beside Clear; rows show up to three tag chips plus `+n`; a deleted tag is pruned from the filter; dragging is disabled while the list is narrowed.
- **Copy tags / Paste tags** in a document's row menu: `Copy tags` remembers the row **as a source** (`documentTagClipboard.ts`: module state, so it outlives the menu and the tab — the app never reads the system clipboard) and is disabled on a row with no tags; `Paste tags` sends **`CopyPdfTagsCommand`** (`POST /pdf-documents/{id}/tags/copy`, body `{ from_document_id }`), which reads the source and, in one transaction, unassigns the target's tags the source does not carry and assigns the ones it is missing — an overwrite, and a repeat of it changes nothing. Its title names the document the copy came from, and both actions report through the page status line.
- Closing rules for the popovers: outside press, Escape, scroll outside the panel (one shared shell, `TagPopoverShell`); an open inline add form claims Escape first — that press cancels the add and the panel closes on the next one — and a document disappearing from the list closes the assignment popover.

### 5.3 Styles

New classes in `src/App.css`: `.tags-popover`, `.tags-popover-head`, `.tags-popover-foot`, `.tag-folder-list`, `.tag-folder-row`, `.tag-list`, `.tag-row`, `.tag-row.is-selected`, `.tag-usage`, `.tag-chip`, `.tag-chip.is-filter`, `.notes-doc-tags`, `.notes-tag-filter`, `.notes-tag-search`, `.notes-tag-search-field`, `.tag-suggestions`, `.tag-suggestion`, `.tag-form`-family fields; reuse `.notes-head-button` and the existing CSS variables.

## 6. Tests

Backend (`backend/tests/tags.test.ts`, real SQLite like `history.test.ts`): folder CRUD, dense ordering, reorder rejects a non-permutation, deleting a folder that holds a tag is refused and the refusal rolls back, an emptied folder deletes and the rest renumber; tag CRUD, duplicate name 409, move to folder and to Ungrouped, counts, deleting an assigned tag is refused with the rows intact; **assign creates one `assigned_pdf_tag` + one junction per tag; assigning twice creates nothing; unknown tag id 400; unassign deletes the assignment row and its junction; unassigning an unassigned tag is a no-op; deleting a document removes only its own assignment rows through the policy-sent command; deleting an unused tag leaves the other assignments alone; `listDocuments` returns tags sorted folder then name**. **Copy**: it replaces the target's tags with the source's — the tag they share keeps its row, the target's extra one goes — copies onto a document with no tags, is idempotent, copies a document onto itself, reads the source's tags as they are at paste time, and refuses an unknown source or target without writing anything. **Undo/redo** (`backend/tests/history.test.ts`): every reader tag command pushes a step; create/delete/reorder/rename/edit of folders and tags move both ways under the same ids; assign and unassign undo exactly the rows they changed; a paste's undo restores the target's previous set; a refused delete and a change that changes nothing leave the stack untouched.

API integration (`tests/api.test.ts`): a `pdf tags` block over `pdfTagApi` + `assignPdfTags`/`unassignPdfTags` + `listDocuments.tags`; the OpenAPI path list and flow counts updated for the new routes and commands.

Frontend unit tests: `tests/tagFilter.test.ts`, `tests/documentTagFilter.test.ts`, `tests/documentTagClipboard.test.ts`.

## 7. Phases

1. Migration + client — typecheck and existing tests stay at their baseline.
2. Tag-folder backend (4 commands, query, router).
3. Tag-catalog backend (3 commands, query, router).
4. **Assignment commands** (assign/unassign, events, POST/DELETE routes, `listDocuments.tags`, document-delete cleanup).
5. Frontend data layer (DTOs, `pdfTagApi`, `assignPdfTags`/`unassignPdfTags`, helpers, tests).
6. Tag manager popover + header button.
7. Assignment popover + context-menu item + row chips.
8. Filter + polish + test pass.

## 8. Assumptions and decisions

- Explicit junction stays (Prisma's implicit table cannot be named, has `A`/`B`, no `id`, and loses the ERD's FK arrows). Verified against Prisma 7.10.1.
- Assign/unassign are **idempotent** rather than throwing on "already assigned"/"not assigned" like the Kotlin handlers, because Save is two requests and a retry after a partial failure must not 400.
- The dialog sends unassign before assign (reference order); a failure leaves the popover open with an inline error.
- Assignment is changed only from the document row's context menu; the manager is catalog-only.
- Tags are grouped globally in folders; the notes `folder` table is untouched.
- Tag commands share the notes context's `SessionHistory` (section 4.5); the policy-sent assignment cleanup stays part of the document-delete step.

## 9. Out of scope

Tag colors, tag ordering inside a folder, per-note tags, searching by tag outside the documents rail, and any change to the notes `folder` behaviour.
