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
bun run codegen   # generate both Prisma clients + bundle both migration sets
```

## Development

```bash
bun run dev       # http://127.0.0.1:4317, restarts on change
```

The diagram at <http://127.0.0.1:4317/event-storming> ships inside
`@machingclee/express-cqrs`, so there is nothing to build here. See
[Event-storming diagram](#event-storming-diagram).

`bun run dev` sets `DATABASE_URL=file:./prisma/dev.db` so development never
touches the real app data folder. (The `VAR=value` prefix is POSIX shell syntax;
on Windows use an `.env` file - see `.env.example`.)

### Database workflow

| Command                                | What it does                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `bun run migrate --name add_something` | Business DB: new `prisma/migrations/<ts>_<name>/migration.sql` + applies it + regenerates the business client |
| `bun run generate`                     | Regenerate the business Prisma client only                                                                    |
| `bun run db:studio`                    | Prisma Studio on `prisma/dev.db`                                                                              |
| `bun run db:reset`                     | Drop, recreate and re-migrate `prisma/dev.db`                                                                 |
| `bun run migrations:bundle`            | Rewrite the generated migration bundle                                                                        |
| `bun run typecheck`                    | `bun check` (runs codegen first)                                                                              |

Commit `prisma/migrations/`, never `prisma/dev.db` or `src/generated/`. Run
`bun run migrations:bundle` after adding a migration, or use `bun run codegen`.
The `prisma/audit/` folder is retained only for older deployments that still use
the separate audit database; the current app does not read it.

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

| Piece                                                                             | Size     | Share |
| --------------------------------------------------------------------------------- | -------- | ----- |
| Bun runtime (JavaScriptCore + ICU + stdlib), embedded in every `--compile` binary | 87.4 MB  | 94%   |
| Prisma client - SQLite query compiler (WASM, base64)                              | 4.4 MB   | 4.7%  |
| iconv-lite (express/body-parser) + express + mime-db + qs                         | 0.7 MB   | 0.8%  |
| our own `src/`                                                                    | < 0.1 MB | -     |

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
- Reads `DATABASE_URL=file:<app data dir>/database.db` for the business database.
  Without it, falls back to the platform app data folder computed in
  `src/appDataDir.ts` (`~/Library/Application Support/com.machingclee.pdf-focus-viewer/`
  on macOS, `%APPDATA%\com.machingclee.pdf-focus-viewer\` on Windows,
  `$XDG_DATA_HOME/com.machingclee.pdf-focus-viewer/` on Linux).
- Opens one Prisma client for the business database. Audit rows use the business
  `event_audit` table through the same client.
- Exits on `SIGINT`/`SIGTERM`, and also when its stdin closes - the backstop for
  the Tauri app crashing or being force-quit before it can kill the child. The
  stdin watch is auto-enabled when stdin is a pipe (`BACKEND_STDIN_WATCHDOG=1`
  or `0` to force it).
- `BACKEND_TOKEN` (optional) turns on `X-Backend-Token` checking for every data
  request, so other local programs cannot drive the API. The docs (`/api-docs`,
  `/docs/*`) and the diagram page are exempt: a browser opening them cannot
  attach the header, and the token Rust generates lives only in the app.
- CORS allows only the Tauri webview origins and the Vite dev server; override
  with `ALLOWED_ORIGINS`.

## Migrations at runtime

`src/infrastructure/prisma/migrate.ts` applies migrations on startup, because the
Prisma migrate CLI cannot be bundled. It writes the same `_prisma_migrations` rows
Prisma does (identical columns, sha256 checksum over `migration.sql`,
unix-epoch-millisecond timestamps), so the development files and the packaged
files stay interchangeable. `prisma migrate status` accepts a database this code
created, and this code accepts one the CLI created.

Before applying anything it:

1. copies each database to `<database>.bak-<timestamp>` (skipped when the file
   does not exist yet);
2. refuses to start if an already-applied migration's checksum changed;
3. applies pending migrations in order, each in its own transaction with
   `PRAGMA foreign_keys = OFF` and `PRAGMA foreign_key_check` afterwards, since
   Prisma's SQLite migrations rebuild tables.

Only a warning (not a failure) is logged when the database records a migration
that the binary does not bundle.

## API

| Method   | Path                        | Purpose                                                                                                                   |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/health`                   | `{ status, pid, uptimeSeconds }`                                                                                          |
| `GET`    | `/pdf-documents`            | All documents, newest first, with `_count.focusable_strips`                                                               |
| `POST`   | `/pdf-documents/resolve`    | `{ file_path, name?, fingerprint?, page_count?, update_name? }` -> upsert by path when the file exists; 404 and no row when it does not |
| `POST`   | `/pdf-documents/import`     | `{ source_paths, name? }` -> copy each file into the library, returns the documents with their strips                     |
| `PATCH`  | `/pdf-documents/:id/rename` | `{ name }`                                                                                                                |
| `DELETE` | `/pdf-documents/:id`        | Remove the document, its folders and strips, and the library copy                                                         |
| `GET`    | `/focusable-strips`         | All strips; `?pdf_document_id=&page_number=&unfiled=` to filter                                                           |
| `POST`   | `/focusable-strips`         | `{ pdf_document_id, folder_id?, page_number, top, height, left, width, page_width, page_height, text_excerpt?, remark? }` |
| `POST`   | `/focusable-strips/reorder` | `{ groups: [{ folder_id, strip_ids }] }` -> reorder or move strips between folders                                        |
| `PATCH`  | `/focusable-strips/:id`     | geometry and/or `{ remark }` (markdown); omitted fields are left alone                                                    |
| `DELETE` | `/focusable-strips/:id`     | Remove one strip                                                                                                          |
| `GET`    | `/folders`                  | `?pdf_document_id=` -> the document's folders, each with its strips                                                       |
| `POST`   | `/folders`                  | `{ pdf_document_id, name }` -> append a folder                                                                            |
| `POST`   | `/folders/reorder`          | `{ pdf_document_id, folder_ids }` -> reorder the document's folders                                                       |
| `PATCH`  | `/folders/:id`              | `{ name }`                                                                                                                |
| `DELETE` | `/folders/:id`              | `?with_strips=true` also deletes the strips; a non-empty folder answers 409 otherwise                                     |
| `GET`    | `/app-state`                | The one settings row: `notes_panel_width`, `event_log_panel_width`, `last_opened_pdf_document_id`                         |
| `PATCH`  | `/app-state`                | Patch the columns named in the body; the others stay as they are                                                          |
| `GET`    | `/docs/commands`            | Commands, queries, policies, events and invariants, built from decorators                                                 |
| `GET`    | `/docs/command-flow`        | The documented way into the diagram: a browser gets a 302 to `/event-storming/`, anything else gets the paths as JSON     |
| `GET`    | `/event-storming`           | The event-storming diagram: the build shipped inside `@machingclee/express-cqrs`                                          |

Every JSON response uses one envelope:

```json
{ "success": true, "data": { "...": "..." } }
```

```json
{ "success": false, "errorMessage": "Validation failed" }
```

`ApiResponseSchema` in `src/apiResponse.ts` validates it, and
`src/middleware/apiEnvelope.ts` wraps every `res.json(...)` at the DocApp
boundary. Routes still return their domain payload; the envelope is applied once.
`ApiResponse.ok(...)` and `ApiResponse.fail(...)` are the constructors for
handlers that need to build a response explicitly.

The generated OpenAPI document uses `apiSuccessSchema(routeSchema)` for success
responses and `ApiErrorSchema` for errors. `/api-docs.json` is the one raw JSON
exception, because Swagger UI must read the OpenAPI document itself.

`name` is only overwritten by `/resolve` when `update_name: true` is sent, so a
name the user edited survives the next open of the same file.

`app_state` is one row. Each column is one remembered setting:
`notes_panel_width` is the Notes-of-this-PDF column, `event_log_panel_width`
is the event log, and `last_opened_pdf_document_id` is written when a document
is resolved. A missing column is null, and the client keeps its default.

### Swagger

The same document is served two ways while the backend runs:

| Path             | What it is                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| `/api-docs`      | Swagger UI (interactive, "Try it out" works against the running server) |
| `/api-docs.json` | The generated OpenAPI 3.0.3 document                                    |

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
The packaged backend serves the same UI at `http://127.0.0.1:<port>/api-docs`,
though it still resolves the `swagger-ui-dist` assets from the build machine's
`node_modules` path baked into the binary — a distributed `.app` would 404 them.

Strip geometry is in PDF points (1pt = 1 CSS px at 100% zoom), so it does not
depend on the current zoom. Reopening a strip means setting
`contentLock = { page: page_number, fracY: (top + height / 2) / page_height }` and
`stripHeight = height`.

Timestamps are deliberately simple: `created_at` is a `Float` holding unix epoch
milliseconds and the API writes it on create (`Date.now()`), which keeps SQLite
column TYPEs to REAL/TEXT/INTEGER and the JSON payload free of date strings.
There is no `updated_at` column.

### Event-storming diagram

`/docs/commands` is also _drawn_. The diagram belongs to `@machingclee/express-cqrs`
(the `event-storming/` project in that repository) and renders the same graph —
bounded contexts, actors, commands, events, policies, queries, each node with its
payload fields. This backend serves the copy that ships inside the package.

To change the diagram, work in that repository:

```bash
cd ../express-cqrs/event-storming
npm install && npm run dev          # http://localhost:5183, proxying /docs

npm run build                       # vite writes ../src/event-storming/public
cd .. && npm run build              # package build copies it into dist/
```

`bun run dev` here then serves whatever build the installed package carries.

`GET /docs/command-flow` is the documented entry point: it appears in the Swagger
UI under the `domain` tag with a **clickable link** — the banner at the top of
`/api-docs` and the operation's _External Docs_ both open `/event-storming/` in a
new tab. A browser navigating to the route itself is redirected, and every other
client gets where the page and its graph live:

```bash
curl -s -H 'Accept: application/json' http://127.0.0.1:4317/docs/command-flow
# {"page":"/event-storming/","pageUrl":"http://127.0.0.1:4317/event-storming/","flow":"/docs/commands","built":true}
```

Both routes are exempt from `X-Backend-Token`, and so is the graph the page draws
(`GET /docs/commands`). The page is opened in the user's browser, where the token
Rust generated does not exist — with the graph behind the check, the packaged app
could only ever show "401 Unauthorized" and a token field nobody could fill in.
`/docs` is in the same position as `/api-docs`, which already publishes the whole
API surface, and none of these routes touches the database; the data routes stay
token-protected.

The page is a static bundle, so it is mounted before the token check for the same
reason as the Swagger UI: a browser cannot attach `X-Backend-Token` to a page's
own asset requests.

`../express-cqrs/src/event-storming/public/` is committed in that repository. When it is missing, the
mount answers 404 with the build command instead of a bare error page. A packaged
binary can serve a copy from elsewhere by setting
`EVENT_STORMING_DIR=/path/to/the/build`.

The packaged app uses exactly that hook. `bun build --compile` embeds JavaScript
but not files read at run time, so the sidecar cannot see
`node_modules/@machingclee/express-cqrs/dist/event-storming/public`:
`import.meta.url` inside a compiled binary is `file:///$bunfs/root/<binary>`, and
the package's `./src/event-storming/public` fallback resolves against the working
directory, which is `/` for a double-clicked `.app`. So
`src-tauri/tauri.conf.json` ships the folder as a `bundle.resources` entry
(`$RESOURCES/event-storming`), and `src-tauri/src/lib.rs` passes
`EVENT_STORMING_DIR` to the sidecar when it spawns it. `bundle.sh` fails early
when the installed package does not carry the build. To change the diagram,
rebuild it in the package repository, publish, and bump the dependency here —
there is nothing to build in this repository.

### Domain pipeline (commands, queries, events and audit)

Every database-backed route is a thin controller over an in-process
command/query bus. The bus, the decorators, the event publisher, the audit port
and the flow builder live in `@machingclee/express-cqrs` (the Node variant of
`machinglee/domain.util`); the `PdfNoteManagement` bounded context lives in
`src/contexts/pdfNoteManagement/`; the package's `initializeCqrs`/`getCqrsModule`
functions hold the process-wide module singleton; and the Prisma client and
transaction/audit adapters live in `src/infrastructure/prisma/`.

```text
router -> commandBus.send(command) -> handler -> Prisma Client (one transaction)
                                             -> domain events -> policies
                                             -> event_audit rows
```

The context follows the Java reference layout: `command/`, `commandhandler/`,
`query/`, `queryhandler/`, `event/` and `policy/`, one class per file, with
`components.ts` listing the decorated components. It is intentionally bound to
Prisma: Prisma Client is the repository, so handlers inject `PrismaUnitOfWork`
and query through `db()`. There is no separate repository layer.

Read routes send a query instead: no transaction, no events and no audit rows.
`/health` stays a plain route.

| Decorator                                     | Placement                    | Meaning                                                                                                              |
| --------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@Payload({ field: "type" }, dtos?)`          | command/query/event class    | Fields the node carries, so the diagram can show a payload. `dtos` names nested shapes.                              |
| `@Policy({ excludeFromFlow: true })`          | policy class                 | Runs normally but is left out of the flow graph and the diagram.                                                     |
| `@Actor(...names)`                            | command/query class          | Who initiates it (event-storming actor).                                                                             |
| `@BoundedContext(name)`                       | command/query/event class    | Domain area; also keeps the class name stable under `--minify`.                                                      |
| `@Invariant(...rules)`                        | policy event listener method | Business reason a policy reacts to an event and routes it onward; documentation metadata surfaced by the flow graph. |
| `@CommandHandler(Command, { inject, emits })` | handler class                | Binds the command to this handler and declares the events it emits.                                                  |
| `@QueryHandler(Query, { inject })`            | handler class                | Binds the query to this handler.                                                                                     |
| `@Policy({ inject })`                         | policy class                 | A component that owns `@EventListener` methods.                                                                      |
| `@EventListener(Event, { sends })`            | policy method                | Listens to one event class (or a base class).                                                                        |
| `@Service({ inject })`                        | class                        | Plain injectable service.                                                                                            |
| `@Transactional({ mode })`                    | command handler class        | `required` (default) or `none`; see below.                                                                           |

Command and query classes extend `Command<R>` / `Query<R>`, and events extend
`DomainEvent`. TypeScript erases generic arguments, so a handler names its
message class explicitly (`@CommandHandler(CreateFocusableStripCommand)`) and its
dependencies are listed explicitly (`inject: [PrismaUnitOfWork]`). That is also
why the backend needs no `reflect-metadata` and no `experimentalDecorators`.

#### Minimal package entrypoint

The reusable entrypoint is `createCqrs`. A consumer supplies the component list
and an `AuditEventRepository`:

```ts
import {
  attachCqrs,
  createCqrs,
  type AuditBatch,
  type AuditEventRepository,
} from "@machingclee/express-cqrs";

class PrismaAuditEventRepository implements AuditEventRepository {
  constructor(private readonly prisma: AppPrisma) {}

  async save(batch: AuditBatch): Promise<void> {
    // insert batch.records into the audit table
  }
}

const cqrs = createCqrs({
  components: PDF_NOTE_MANAGEMENT_COMPONENTS,
  auditEventRepository: new PrismaAuditEventRepository(db),
});

app.use(attachCqrs(cqrs));
```

If the module must be created after migrations or another startup step, pass a
factory instead of an instance:

```ts
app.use(attachCqrs(() => cqrs));
```

The factory closes over the application's own dependencies. The package does not
need a global `getCqrsModule()`.

`createCqrs` owns the container, registers the command/query buses and wraps
the audit repository as the bus's `AuditWriter`. `attachCqrs` opens the request
context and puts `req.commandBus`, `req.queryBus`, `req.events` and `req.requestId`
on the request.

The audit repository is optional and interchangeable. It only implements
`save(batch)`, so the same application can use Prisma, SQL, a file or an
in-memory store. Omitting it uses a no-op repository and keeps commands, queries,
events, policies and the flow graph working without an audit database.

The `PrismaAuditEventRepository` constructor accepts any client with
`event_audit.createMany`, including the business client. To keep audit rows in
the same database:

```ts
const unitOfWork = new PrismaUnitOfWork(db);

initializeCqrs({
  components: PDF_NOTE_MANAGEMENT_COMPONENTS,
  auditEventRepository: new PrismaAuditEventRepository(db),
  transactionRunner: unitOfWork,
  configure: (container) => {
    container.registerValue(PrismaUnitOfWork, unitOfWork);
  },
});
```

No second Prisma client is needed in that setup. `initializeCqrs` receives the
complete options object; it does not import the context or Prisma itself.

If the handlers inject application services, pass `configure`. If commands need
transactions, pass a `transactionRunner`:

```ts
const unitOfWork = new PrismaUnitOfWork(prisma);

const cqrs = createCqrs({
  components: PDF_NOTE_MANAGEMENT_COMPONENTS,
  auditEventRepository: new PrismaAuditEventRepository(db),
  transactionRunner: unitOfWork,
  configure: (container) => {
    container.registerValue(PrismaUnitOfWork, unitOfWork);
  },
});
```

Without a `transactionRunner`, commands still run but are not wrapped in a
database transaction. The component list is the only required input; the audit
repository, transaction runner and `configure` callback are optional.

#### Transactions

- Every application command uses `mode: "required"`. The default opens one
  Prisma interactive transaction for a top-level command.
- A nested command (a policy reacting to an event) reuses the ambient
  transaction; the bus never opens a transaction inside another one.
- `ImportPdfDocumentCommandHandler` also uses `required`. Its file hash and copy
  run inside the transaction. This is acceptable for the single desktop client;
  `PrismaUnitOfWork` sets a 60-second transaction timeout for a large PDF. A
  future multi-client deployment should move the file preparation outside the
  command.
- The library still supports `@Transactional({ mode: "none" })` for other
  consumers. No application command uses it.
- Handlers and helpers must not call `$transaction` themselves: the command owns
  the transaction (on SQLite a nested transaction is a deadlock, not a savepoint).

#### Events and policies

`context.events.add(event)` dispatches after the handler returns, still inside
the transaction, so a policy can react and send a nested command. `addTransactional`
defers until the transaction commits. Listeners match subclasses, so
`@EventListener(DomainEvent)` sees every event (`DomainEventLogPolicy` logs when
`DOMAIN_EVENT_LOG=1`). A post-commit listener failure is logged and does not fail
a command that already committed.

`@Invariant` belongs on a policy's `@EventListener` method, not on a command
handler. The listener is where an event reaction and its follow-up commands are
justified; a handler's local validation is an implementation detail. Startup
rejects an invariant on anything other than a policy listener.

#### Audit trail

`event_audit` lives in the business database. The bus buffers the request's rows
with a per-request `event_order` and writes them once, after the top-level
command's transaction has committed or rolled back:

- success: the command row and each event row, `success = true`;
- failure: the same batch with the surviving records stamped `success = false`
  and a compact `failure_reason`;
- a failure while writing audit is logged and never changes the API result;
- `request_id` is the same id returned in the `X-Request-Id` response header.

The audit batch is written after the top-level command ends. The table has no
relations, so a row outlives the document, folder or strip it describes. A custom
`AuditEventRepository` can write to another database or an external store if the
deployment needs that separation; the contract that repository has to satisfy, and
worked examples for Prisma, `pg` and `mysql2`, are in the `## Audit` section of the
`@machingclee/express-cqrs` README.

`@machingclee/express-cqrs` is database-generic: it knows only the `TransactionRunner` and
`AuditWriter` ports. `createCqrs` composes the module without Prisma, and
`initializeCqrs`/`getCqrsModule` in the package only store the resulting singleton. The `PdfNoteManagement` context is intentionally Prisma-bound; its
handlers use `PrismaUnitOfWork.db()` directly. Prisma implements the transaction
and audit ports in `src/infrastructure/prisma/unitOfWork.ts` and
`src/infrastructure/prisma/auditWriter.ts`. Switching the datasource to
MySQL/Postgres therefore changes the context's Prisma queries and the
infrastructure wiring, not the `cqrs` library; on MySQL, add `@db.Text`
to `payload` and `failure_reason` (Prisma maps `String` to `VARCHAR(191)`).

#### Flow graph

`GET /docs/commands` returns the command/query/event/policy graph built from the
decorators — the Node answer to the Java prototype's bytecode-scanned diagram.
Each command, query and event also carries its **payload** (`field: type` rows,
plus a `dtos` map for nested shapes): TypeScript erases constructor parameter
types, so the payload is declared with `@Payload(...)`; where the command takes a
request body, `payloadOf(CreateFolderBodySchema)` derives it from the Zod schema
the route validates against, so the diagram cannot drift from the API.
A handler declares its events with `emits` and a policy may declare the commands
it sends with `sends`; an event emitted without a declaration is added at
runtime. Registering a handler is one line in
`PDF_NOTE_MANAGEMENT_COMPONENTS` in `src/contexts/pdfNoteManagement/components.ts`.

```ts
@BoundedContext("PdfNoteManagement")
@Payload({ folderId: "number", documentId: "number", name: "string" })
export class FolderRenamed extends DomainEvent { … }
```

A class without `@Payload` reports `{}` and the diagram simply shows no schema
chip for it.

The one policy in this app, `DomainEventLogPolicy`, is a development event log: it
listens to the `DomainEvent` base class, so drawing it would put an edge on every
node. It declares `@Policy({ excludeFromFlow: true })` and is therefore absent
from `/docs/commands` (`policies: []`) — it still runs and still receives events.

#### Class names and `--minify`

Audit `event_type` values and flow node names are class names, as in Java. Bun's
minifier renames undecorated classes but preserves the name of a decorated class,
so every command, query and event must carry `@Actor`/`@BoundedContext`.
`createCqrs` uses `strictDomainTypes: true` by default, so startup fails otherwise. That
validation is the guard against a future build change that would silently mangle
the audit vocabulary.

#### Adding a command

The command goes in its own file, `src/contexts/pdfNoteManagement/command/RenameFolderCommand.ts`:

```ts
@Actor("Reader")
@BoundedContext("PdfNoteManagement")
export class RenameFolderCommand extends Command<Folder> {
  constructor(
    readonly id: number,
    readonly name: string,
  ) {
    super();
  }
}
```

The handler goes in its own file, `src/contexts/pdfNoteManagement/commandhandler/RenameFolderCommandHandler.ts`:

```ts
@CommandHandler(RenameFolderCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FolderRenamed],
})
export class RenameFolderCommandHandler implements ICommandHandler<
  RenameFolderCommand,
  Folder
> {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async handle(
    command: RenameFolderCommand,
    context: CommandContext,
  ): Promise<Folder> {
    // ... database work through this.uow.db() ...
    context.events.add(
      new FolderRenamed(folder.id, folder.pdf_document_id, folder.name),
    );
    return folder;
  }
}
```

Then add the handler class to `PDF_NOTE_MANAGEMENT_COMPONENTS` in
`src/contexts/pdfNoteManagement/components.ts` and let the controller send the
command. The route keeps its Zod schemas, so Swagger and response validation do
not change.

## Layout

```
backend/
  prisma/schema.prisma          business schema
  prisma/migrations/            business migrations
  prisma.config.ts              business schema, migrations dir, datasource url
  prisma/audit/                 legacy separate-audit schema (not started)
  prisma.audit.config.ts        audit schema, migrations dir, datasource url
  scripts/build-migrations.ts   embeds both migration sets into generated bundles
  src/main.ts                  startup: migrate both DBs, listen, report the port
  src/app.ts                    createDocApp + middleware order + setupSwagger
  src/appDataDir.ts             platform app data folder + database URL handling
  src/middleware/               one file per middleware
    allowTauriOrigins.ts        CORS for the Tauri webview origins
    requireBackendToken.ts      optional shared-secret check
    validate.ts                 bodySchema -> 400 middleware
    apiEnvelope.ts              wraps every JSON response in { success, data|errorMessage }
  src/http.ts                   HttpError, param parsing, error handler
  src/apiResponse.ts            ApiResponse class and response-envelope schemas
  src/schemas.ts                Zod request/response schemas (the docs come from here)
  src/docs/routeRegistry.ts     createDocApp, route registry, OpenAPI generator
  src/event-storming/router.ts   /docs/commands and /docs/command-flow
  src/event-storming/assets.ts   serves the package's event-storming/public at /event-storming
  src/routers/                  one controller per resource
  @machingclee/express-cqrs    decorators, DI, command/query bus, events, audit port, flow
  src/contexts/pdfNoteManagement/ the single bounded context of this app
    command/                    one Command class per file
    commandhandler/             one Command Handler per file
    query/                      one Query class per file
    queryhandler/               one Query Handler per file
    event/                      one Domain Event per file
    policy/                     domain policies
    service/                    rules more than one handler needs: drag order, id-set checks
    components.ts               the context's decorated components
  src/event-storming/           app-local event-storming docs adapter
  src/infrastructure/prisma/
    client.ts                   business Prisma client over bun:sqlite
    instance.ts                 lazy business client singleton
    migrate.ts                  bundled migration runner
    migrations.generated.ts     business migrations, generated
    unitOfWork.ts               Prisma transaction adapter
    auditWriter.ts              business-database audit adapter
  src/generated/prisma/         generated business client, git-ignored
  src/generated/audit-prisma/   generated audit client, git-ignored
```
