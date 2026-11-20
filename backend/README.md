# PDF Focus Viewer - backend

Bun + Express + Prisma (SQLite) API for the desktop app. Compiled with
`bun build --compile` into the Tauri sidecar binary, so it must run without
`node_modules` and without a Prisma engine binary.

## Requirements

- [Bun](https://bun.sh) 1.4+ (`brew install bun`)

## Setup

```bash
cd backend
bun install
bun run codegen   # prisma generate + bundle migrations into src/migrations.generated.ts
```

## Development

```bash
bun run dev       # http://127.0.0.1:4317, database prisma/dev.db, restarts on change
```

`bun run dev` sets `DATABASE_URL=file:./prisma/dev.db` so development never
touches the real app data folder. (The `VAR=value` prefix is POSIX shell
syntax; on Windows use an `.env` file - see `.env.example`.)

### Database workflow

| Command | What it does |
| --- | --- |
| `bun run migrate --name add_something` | `prisma migrate dev`: new `prisma/migrations/<ts>_<name>/migration.sql` + applies it + regenerates the client |
| `bun run generate` | Regenerate the Prisma client only |
| `bun run db:studio` | Prisma Studio on `prisma/dev.db` |
| `bun run db:reset` | Drop, recreate and re-migrate `prisma/dev.db` |
| `bun run migrations:bundle` | Rewrite `src/migrations.generated.ts` from `prisma/migrations/` |
| `bun run typecheck` | `bun check` (runs codegen first) |

Commit `prisma/migrations/`, never `prisma/dev.db` or `src/generated/`.
Run `bun run migrations:bundle` after adding a migration, or use
`bun run codegen` - both build scripts do it for you.

## Build (Tauri sidecar)

```bash
bun run build:mac       # -> ../src-tauri/binaries/pdf-backend-aarch64-apple-darwin
bun run build:mac-x64   # -> ../src-tauri/binaries/pdf-backend-x86_64-apple-darwin
bun run build:windows   # -> ../src-tauri/binaries/pdf-backend-x86_64-pc-windows-msvc.exe
```

Each target runs `codegen` first, so the migrations SQL is embedded in the
binary. The Prisma driver adapter is `prisma-adapter-bun-sqlite`, which sits on
Bun's own `bun:sqlite` and needs no native addon, so the compiled binary is a
single self-contained file.

### Why the binary is ~93 MB

That size is the Bun runtime, not our dependencies. Measured with
`bun build --metafile` and by compiling a `console.log` equivalent:

| Piece | Size | Share |
| --- | --- | --- |
| Bun runtime (JavaScriptCore + ICU + stdlib), embedded in every `--compile` binary | 87.4 MB | 94% |
| Prisma client - SQLite query compiler (WASM, base64) | 4.4 MB | 4.7% |
| iconv-lite (express/body-parser) + express + mime-db + qs | 0.7 MB | 0.8% |
| our own `src/` | < 0.1 MB | - |

Only the **SQLite** query compiler is bundled - no Postgres/MySQL/SQL Server/
MongoDB compilers, no migration engine, no Prisma CLI, no `pglite.wasm`. The
Prisma part is load-bearing and cannot be trimmed further without dropping the
ORM.

`--minify` is enabled in all build scripts (0.45 MB, the only flag that helps:
`--bytecode` adds ~9 MB and `strip` finds no symbols). The DMG that Tauri
produces compresses this to roughly 40 MB; the `.app` on disk stays ~93 MB.

Bun 1.4.4 leaves a `.bun-build` scratch file (~83 MB) in the working directory
after every compile. The build scripts `rm -f .*.bun-build` on success and the
pattern is git-ignored, so repeated builds do not fill the disk.

## Runtime contract with Rust

- Listens on `127.0.0.1` (`HOST` to override). `PORT=0` lets the OS pick a free
  port, which is what Rust passes.
- Prints exactly `BACKEND_READY port=<n>` on stdout once listening; every other
  log line goes to stderr.
- Reads `DATABASE_URL=file:<app data dir>/database.db`. Without it, falls back to
  the platform app data folder computed in `src/appDataDir.ts`
  (`~/Library/Application Support/com.machingclee.pdf-focus-viewer/` on macOS,
  `%APPDATA%\com.machingclee.pdf-focus-viewer\` on Windows,
  `$XDG_DATA_HOME/com.machingclee.pdf-focus-viewer/` on Linux).
- Exits on `SIGINT`/`SIGTERM`, and also when its stdin closes - the backstop for
  the Tauri app crashing or being force-quit before it can kill the child. The
  stdin watch is auto-enabled when stdin is a pipe (`BACKEND_STDIN_WATCHDOG=1`
  or `0` to force it).
- `BACKEND_TOKEN` (optional) turns on `X-Backend-Token` checking for every
  request, so other local programs cannot drive the API.
- CORS allows only the Tauri webview origins and the Vite dev server; override
  with `ALLOWED_ORIGINS`.

## Migrations at runtime

`src/migrate.ts` applies migrations on startup, because the Prisma migrate CLI
cannot be bundled. It writes the same `_prisma_migrations` rows Prisma does
(identical columns, sha256 checksum over `migration.sql`, unix-epoch-millisecond
timestamps), so `backend/prisma/dev.db` and the packaged `database.db` stay
interchangeable - `prisma migrate status` accepts a database this code created,
and this code accepts one the CLI created.

Before applying anything it:

1. copies the database to `database.db.bak-<timestamp>` (skipped when the file
   does not exist yet);
2. refuses to start if an already-applied migration's checksum changed;
3. applies pending migrations in order, each in its own transaction with
   `PRAGMA foreign_keys = OFF` and `PRAGMA foreign_key_check` afterwards, since
   Prisma's SQLite migrations rebuild tables.

Only a warning (not a failure) is logged when the database records a migration
that the binary does not bundle.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | `{ status, pid, uptimeSeconds }` |
| `GET` | `/pdf-documents` | All documents, newest first, with `_count.focusable_strips` |
| `POST` | `/pdf-documents/resolve` | `{ file_path, name?, fingerprint?, page_count?, update_name? }` -> upsert by path, returns the document with its strips |
| `PATCH` | `/pdf-documents/:id` | `{ name }` |
| `GET` | `/focusable-strips` | All strips; `?pdf_document_id=&page_number=` to filter |
| `POST` | `/focusable-strips` | `{ pdf_document_id, page_number, top, height, left, width, page_width, page_height, text_excerpt?, remark? }` |
| `PATCH` | `/focusable-strips/:id` | `{ remark }` (markdown) |
| `DELETE` | `/focusable-strips/:id` | Remove one strip |
| `GET` | `/app-state` | Every remembered UI value as a flat `{ key: value }` map |
| `PUT` | `/app-state/:key` | `{ value }` -> upsert one remembered value |

`name` is only overwritten by `/resolve` when `update_name: true` is sent, so a
name the user edited survives the next open of the same file.

`app_state` holds UI state that has to survive a restart, one row per key
(`notes_panel.width` today). Values are `TEXT` so remembering one more thing
needs no migration; the client parses what it wrote and falls back to a default.

### Swagger

The same document is served two ways while the backend runs:

| Path | What it is |
| --- | --- |
| `/api-docs` | Swagger UI (interactive, "Try it out" works against the running server) |
| `/api-docs.json` | The generated OpenAPI 3.0.3 document |

It is built from the Zod schemas in `src/schemas.ts` at boot, so the docs cannot
drift from the validation the API actually enforces: a route declares
`bodySchema` / `responseSchema` / `querySchema` once and gets request validation,
response validation and documentation from that single declaration.

```bash
curl -s http://127.0.0.1:4317/api-docs.json | head -c 400   # dev backend
open http://127.0.0.1:4317/api-docs                          # dev backend
```

The docs are readable **without** `X-Backend-Token` (a browser cannot attach the
header to Swagger UI's own asset requests); everything else still requires it.
The packaged backend serves the same UI — the standalone binary embeds the
swagger-ui assets, so `open http://127.0.0.1:<port>/api-docs` works there too.

Strip geometry is in PDF points (1pt = 1 CSS px at 100% zoom), so it does not
depend on the current zoom. Reopening a strip means setting
`contentLock = { page: page_number, fracY: (top + height / 2) / page_height }` and
`stripHeight = height`.

Timestamps are deliberately simple: `created_at` is a `Float` holding unix epoch
milliseconds and the API writes it on create (`Date.now()`), which keeps SQLite
column TYPEs to REAL/TEXT/INTEGER and the JSON payload free of date strings.
There is no `updated_at` column.

## Layout

```
backend/
  prisma/schema.prisma
  prisma/migrations/            generated by prisma migrate dev
  prisma.config.ts              schema, migrations dir, datasource url
  scripts/build-migrations.ts   embeds migrations into src/migrations.generated.ts
  src/index.ts                  startup: migrate, listen, report the port
  src/app.ts                    createDocApp + middleware order + setupSwagger
  src/appDataDir.ts             platform app data folder + DATABASE_URL handling
  src/migrate.ts                bundled migration runner
  src/migrations.generated.ts   generated, git-ignored
  src/middleware/               one file per middleware
    allowTauriOrigins.ts        CORS for the Tauri webview origins
    requireBackendToken.ts      optional shared-secret check
    attachDb.ts                 puts the Prisma client on req.db
    validate.ts                 bodySchema -> 400 middleware
  src/http.ts                   HttpError, param parsing, error handler
  src/schemas.ts                Zod request/response schemas (the docs come from here)
  src/docs/routeRegistry.ts     createDocApp, route registry, OpenAPI generator
  src/db.ts                     Prisma client over bun:sqlite
  src/routers/                  healthRouter, pdfDocumentRouter, focusableStripsRouter
  src/generated/prisma/         generated client, git-ignored
```
