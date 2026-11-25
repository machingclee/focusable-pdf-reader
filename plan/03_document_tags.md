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

All in `bounded-contexts/pdf-note-management`, registered in `components.ts`.

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

Events: `PdfTagFolderCreatedEvent`, `PdfTagFolderRenamedEvent`, `PdfTagFoldersReorderedEvent`, `PdfTagFolderDeletedEvent` (folder id + tags moved to Ungrouped), `PdfTagCreatedEvent`, `PdfTagUpdatedEvent`, `PdfTagDeletedEvent` (tag id + assignment count), **`PdfTagsAssignedEvent`** (documentId, count), **`PdfTagsUnassignedEvent`** (documentId, count). No `SessionHistory` entries for any of them.

Queries: `ListPdfTagFoldersQuery` → `PdfTagFolder[]`; `ListPdfTagsQuery` → `PdfTagWithCount[]` (`_count.assignments` as `document_count`, sorted folder `ordering` then name, Ungrouped last).

Service `PdfTagCatalogService`: `normalize` (trim + collapse whitespace, 1..64), `key` (lowercase), `assertUniqueFolder` / `assertUniqueTag` (409 with the existing name), the catalogue comparator, `tagsForDocument(db, id)` → `DocumentTag[]`.

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

One assignment row belongs to exactly one document: unassign deletes the row, never shares it. The database cannot enforce "one assignment per (document, tag)" because the two ids live in different tables, so step 2 of assign is the enforcement point, plus a test that assigns the same tag twice.

### 4.3 API

One router, `pdfTagRouter`, mounted at `/pdf-tags`; the tag folders are its `/folders` sub-resource. Assignment stays on the document router because it acts on a document.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/pdf-tags` | — | `PdfTagWithCount[]` |
| POST | `/pdf-tags` | `{ name, pdf_tag_folder_id? }` | 201 `PdfTag` |
| PATCH | `/pdf-tags/:id` | `{ name?, pdf_tag_folder_id?: number \| null }` | `PdfTag` |
| DELETE | `/pdf-tags/:id` | — | 204 (assignments cascade) |
| GET | `/pdf-tags/folders` | — | `PdfTagFolder[]` |
| POST | `/pdf-tags/folders` | `{ name }` | 201 `PdfTagFolder` |
| POST | `/pdf-tags/folders/reorder` | `{ pdf_tag_folder_ids }` | `PdfTagFolder[]` |
| PATCH | `/pdf-tags/folders/:id` | `{ name }` | `PdfTagFolder` |
| DELETE | `/pdf-tags/folders/:id` | — | 204 (tags survive, Ungrouped) |
| **POST** | **`/pdf-documents/:id/tags`** | `{ pdf_tag_ids }` | 200 `DocumentTag[]` |
| **DELETE** | **`/pdf-documents/:id/tags`** | `{ pdf_tag_ids }` | 200 `DocumentTag[]` |
| GET | `/pdf-documents` | — | adds `tags: DocumentTag[]` |

`createDocRouter` validates a body on DELETE like any other method, so the DELETE-with-body mirrors the reference. `PdfDocumentWithCountSchema` gains `tags`; `PdfNotesService.listDocuments` includes `assigned_tags → assigned_pdf_tag → pdf_tag` and flattens to `{ id, name, pdf_tag_folder_id }`, sorted folder ordering then name.

`DeletePdfDocumentCommandHandler` additionally deletes the document's `assigned_pdf_tag` rows (collected from its junction rows) before deleting the document, so no orphan assignment survives.

### 4.4 Invariants and error codes

- Duplicate folder/tag name (case-insensitive) → 409; invalid name → 400; unknown folder/tag/document → 404; unknown tag id in an assignment → 400 naming it.
- Deleting a folder keeps its tags; deleting a tag deletes its assignments; deleting a document deletes its assignments and junctions.
- Folder `ordering` stays dense after reorder and after delete.
- Assign/unassign are idempotent; only actual changes are counted in the event.
- Every command emits exactly one event, so the audit trail and event-storming diagram stay complete.

## 5. Frontend

### 5.1 Types and API

`src/types/dto.ts`: `PdfTagFolder`, `PdfTag` (with `document_count`), `DocumentTag = { id, name, pdf_tag_folder_id }`, and `PdfDocumentListItem` gains `tags: DocumentTag[]`.

`src/store/api/baseApi.ts`: `ALL_TAG_TYPES` += `"PdfTag"`, `"PdfTagFolder"` (cross-window invalidation comes free).

New `src/store/api/pdfTagApi.ts`: `listPdfTags`, `createPdfTag`, `updatePdfTag`, `deletePdfTag`, `listPdfTagFolders`, `createPdfTagFolder`, `renamePdfTagFolder`, `deletePdfTagFolder`, `reorderPdfTagFolders`. Mutations invalidate `PdfTag` and `PdfTagFolder` (and `PdfDocument` LIST when a name, folder or assignment feeds the rail rows).

`src/store/api/pdfDocumentApi.ts`: **`assignPdfTags({ id, pdf_tag_ids })`** (POST) and **`unassignPdfTags({ id, pdf_tag_ids })`** (DELETE with body); both invalidate `PdfDocument` LIST and `PdfTag` (counts change).

Pure helpers: `src/tagFilter.ts` (`matchesTagFilter`: space-separated parts, case-insensitive) and `src/documentTagFilter.ts` (`filterDocumentsByTags` AND semantics, `groupTagsByFolder` with Ungrouped last, `pruneMissingTags`).

### 5.2 UI flows

- **Tag manager popover** (`TagManagerPopover`), portalled, anchored under a new `🏷` button in the `Documents` header (next to the count): folders pane (create, rename, drag-reorder via dnd-kit, delete) and tags pane (create in the selected folder, rename, move-to-folder, delete with usage count, search across all tags). Inline forms, no modals.
- **Assignment popover** (`DocumentTagsPopover`), opened by a new `Tags…` item in `DocumentContextMenu`: folder sidebar + tag checkboxes + search + inline "New tag"/"New folder"; local selection; Save computes the diff and sends **unassign for removed, then assign for added** (reference order), disabling Save while either call is in flight and showing backend errors inline; Cancel/Escape discards.
- **Filter + chips**: a filter button beside Tags opens the same folder-grouped tag list with checkboxes; active tags appear as a compact chip row with `x of y` and Clear; rows show up to three tag chips plus `+n`; deleted tags are pruned from the selection; dragging is disabled while the list is narrowed.
- Closing rules for the popovers: outside press, Escape, scroll outside the panel (one shared shell, `TagPopoverShell`); a document disappearing from the list closes the assignment popover.

### 5.3 Styles

New classes in `src/App.css`: `.tags-popover`, `.tags-popover-head`, `.tags-popover-foot`, `.tag-folder-list`, `.tag-folder-row`, `.tag-list`, `.tag-row`, `.tag-row.is-selected`, `.tag-usage`, `.tag-chip`, `.tag-chip.is-filter`, `.notes-doc-tags`, `.notes-tag-filter`, `.tag-form`-family fields; reuse `.notes-head-button` and the existing CSS variables.

## 6. Tests

Backend (`backend/tests/tags.test.ts`, real SQLite like `history.test.ts`): folder CRUD, dense ordering, reorder rejects a non-permutation, delete keeps tags; tag CRUD, duplicate name 409, move to folder and to Ungrouped, counts, delete cascades; **assign creates one `assigned_pdf_tag` + one junction per tag; assigning twice creates nothing; unknown tag id 400; unassign deletes the assignment row and its junction; unassigning an unassigned tag is a no-op; deleting a document leaves no assignment rows; deleting a tag removes assignments and decrements counts; `listDocuments` returns tags sorted folder then name**.

API integration (`tests/api.test.ts`): a `pdf tags` block over `pdfTagApi` + `assignPdfTags`/`unassignPdfTags` + `listDocuments.tags`; the OpenAPI path list and flow counts updated for the new routes and commands.

Frontend unit tests: `tests/tagFilter.test.ts`, `tests/documentTagFilter.test.ts`.

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
- No undo/redo for tag commands.

## 9. Out of scope

Tag colors, tag ordering inside a folder, per-note tags, searching by tag outside the documents rail, and any change to the notes `folder` behaviour.
