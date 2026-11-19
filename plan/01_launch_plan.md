# PLAN: Bun + Express + Prisma backend for PDF Focus Viewer

## 0. Biggest risk first — compile test

Prisma 7 (`prisma-client` generator, `runtime = "bun"`) generates a plain TypeScript client, which suits `bun build --compile`. It still needs a SQLite driver adapter. The official adapters (`@prisma/adapter-better-sqlite3`, `@prisma/adapter-libsql`) both use native addons, and bundling those into one compiled binary is fragile.

Test first:

- Prisma 7 client + a community adapter built on Bun's own SQLite (`prisma-adapter-bun-sqlite`, no native addon).
- `bun build --compile`, run the binary, do one write and one read.

Fallback if the test fails: `@prisma/adapter-libsql`, with its native `.node` file shipped next to the binary.

## 1. Layout

```
backend/                      # bun workspace, own package.json
  prisma/schema.prisma
  prisma/migrations/…         # produced by `prisma migrate dev`
  prisma.config.ts
  src/index.ts                # starts up, migrates, listens, reports the port
  src/appDataDir.ts           # finds the app storage folder on mac/win/linux
  src/migrate.ts              # applies migrations itself when the app runs
  src/migrations.generated.ts # migration SQL built into the binary (made by a script)
  src/routes/…
  src/generated/prisma/       # generated client
src-tauri/binaries/pdf-backend-<target-triple>[.exe]   # compiled output
```

## 2. Schema (first version)

```prisma
model PdfDocument {
  id          Int      @id @default(autoincrement())
  name        String                       // editable later
  filePath    String   @unique @map("file_path")
  fingerprint String?                      // pdf.js fingerprint, to re-link a moved file
  pageCount   Int?     @map("page_count")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  focusableStrips FocusableStrip[]
  @@map("pdf_document")
}

model FocusableStrip {
  id            Int      @id @default(autoincrement())
  pdfDocumentId Int      @map("pdf_document_id")
  pdfDocument   PdfDocument @relation(fields: [pdfDocumentId], references: [id], onDelete: Cascade)
  pageNumber    Int      @map("page_number")   // 1-based, same as data-page
  top           Float                          // position on the page in PDF points, so zoom doesn't matter
  height        Float
  left          Float                          // column edges, used to place the note marker
  width         Float
  pageWidth     Float    @map("page_width")
  pageHeight    Float    @map("page_height")
  textExcerpt   String?  @map("text_excerpt")  // first ~200 chars: list label and backup locator
  remark        String   @default("")          // markdown
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@index([pdfDocumentId, pageNumber])
  @@map("focusable_strip")
}
```

Why these fields are enough to reopen a strip in the right place:

- `top` and `height` are what `findParagraphAt` (`src/paragraph.ts`) already returns in PDF points.
- When a strip is reopened, the app sets `contentLock = { page: pageNumber, fracY: (top + height / 2) / pageHeight }` and `stripHeight = height`. That is the same mechanism the strip already uses to stay on the paragraph while scrolling.
- `ParagraphBox` needs a small change to also return `left` and `width`. `columnAround` already computes them.

## 3. Migration workflow

**In development:**

- `bun run db:migrate:dev --name xxx` runs `prisma migrate dev` against `backend/prisma/dev.db` and regenerates the client.
- `db:studio` and `db:reset` scripts come along with it.

**In the packaged app:** the Prisma migrate tool can't be bundled into the binary, so `src/migrate.ts` applies migrations itself:

- A prebuild script reads `prisma/migrations/*/migration.sql` into `src/migrations.generated.ts`, so the SQL is built into the binary.
- On startup it reads Prisma's own `_prisma_migrations` table, using the same columns (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) and the same sha256 checksum. Dev and production databases therefore keep identical migration records.
- Pending migrations are applied in order, each in its own transaction. It turns `foreign_keys` off and back on around each one, and runs `PRAGMA foreign_key_check` afterwards, because Prisma's SQLite table rebuilds need that.
- It copies the database to `database.db.bak-<timestamp>` before applying anything.
- If an already-applied migration's checksum has changed, the backend refuses to start and logs why.

## 4. Where the database lives

`getAppDataDir()` returns the same folder Tauri's `app_data_dir()` uses:

- **mac:** `~/Library/Application Support/com.machingclee.pdf-focus-viewer/`
- **Windows:** `%APPDATA%\com.machingclee.pdf-focus-viewer\`
- **Linux:** `$XDG_DATA_HOME` or `~/.local/share/com.machingclee.pdf-focus-viewer/`

Rust works out the path and passes it to the backend as `DATABASE_URL=file:<dir>/database.db`. The TypeScript function is only a fallback for running the binary by hand. A `get_database_path` Tauri command exposes the path to the UI, for example a "Reveal database" menu item.

## 5. Starting and stopping the backend

**Starting:**

- The backend is registered as a Tauri sidecar via `tauri-plugin-shell` and `bundle.externalBin: ["binaries/pdf-backend"]`.
- In `setup`, Rust calls `app.shell().sidecar("pdf-backend")` with `PORT=0` and the database path.
- The backend listens on `127.0.0.1`. Port 0 means the OS assigns a free port, so two apps can never race for the same one.
- Once listening, the backend prints `BACKEND_READY port=NNNNN`. Rust reads that line from its output, stores the port, and sends a `backend-ready` event. A `get_backend_port` command waits until the port is known.

**Stopping:**

- Rust keeps the process handle and calls `child.kill()` when Tauri reports the app is exiting (`RunEvent::ExitRequested` / `RunEvent::Exit`).
- Backup in case Rust never gets to do that: when Tauri dies, the backend's input stream closes, and the backend calls `process.exit()` when it sees that. This works on both mac and Windows and covers crashes and force-quit, so the backend never keeps running on its own.
- The reference project's crash supervisor and close-confirmation flow are skipped for now.

**Network:** the backend allows requests from the Tauri webview origins (`tauri://localhost` and `http://tauri.localhost`). Optionally, a random token is passed at launch and checked on every request, so other programs on the machine can't call it.

**Building:**

- `build:backend` runs `bun build --compile --target=bun-darwin-arm64 …` and writes `src-tauri/binaries/pdf-backend-aarch64-apple-darwin`. A Windows x64 variant writes `pdf-backend-x86_64-pc-windows-msvc.exe`.
- Tauri's `beforeBuildCommand` runs it automatically.

## 6. API (first set)

- `GET /health`
- `POST /pdf-documents/resolve` with `{ filePath, name, fingerprint, pageCount }`: creates or updates the document by path and returns it with its strips. Called every time a file is opened.
- `GET /pdf-documents`, `PATCH /pdf-documents/:id` with `{ name }`
- `GET /focusable-strips` to list all of them (for a notes panel)
- `POST /focusable-strips`, `PATCH /focusable-strips/:id` with `{ remark }`, `DELETE /focusable-strips/:id`

## 7. Frontend

- **Saving:** after a double-click places the strip (`parkFocusAtPoint` in `src/App.tsx`), keep the paragraph box it used. An "Add note" button in the toolbox saves it with `POST /focusable-strips`.
- **Markers:** in each page, show a small note icon in the left margin at `top * zoom` for each saved strip on that page. Clicking it opens a popover with the remark rendered as markdown via `react-markdown`, plus Edit and Delete.
- **Notes list:** a panel listing every strip. Double-clicking one opens the file if it isn't open, scrolls to the page, places the strip as described in section 2, and turns focus mode on.

## Order of work

1. Compile test (Prisma + adapter + `bun build --compile`).
2. Backend scaffold, schema, `migrate.ts`, routes.
3. Rust sidecar: start, read the port, shut down.
4. Frontend: API client, saving, markers and popover, notes list and jump.

## Open questions

1. **Dev mode:** Tauri skips starting the backend in dev, and `bun --watch` runs it on a fixed port (e.g. 4317) through one `npm run dev` (recommended, same as the reference project)? Or Tauri starts it in dev too, so dev matches production?
2. **`fingerprint`:** keep it now so a moved or renamed PDF can be re-linked, or leave it out for the later schema work?
3. **Windows builds:** needed from the start, or is a mac-only build script fine for now?
