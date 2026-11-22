/**
 * Captures the SQL Prisma 7 emits for the patterns the article describes.
 * Runs against a copy of the project database.
 */
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "/Users/chingcheonglee/Repos/Javascript/2026-08-23-tauri-pdf-focus-viewer/backend/src/generated/prisma/client.ts";

const adapter = new PrismaBunSqlite({ url: "file:/tmp/prisma-lab/lab.db" });
const prisma = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });

const originalLog = console.log;
let capturing = false;
const queries: string[] = [];
prisma.$on("query", (event) => {
  if (!capturing) return;
  queries.push(event.query.replace(/\s+/g, " ").trim());
});

function section(title: string) {
  console.log(`\n===== ${title} =====`);
}

async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  queries.length = 0;
  capturing = true;
  const result = await fn();
  capturing = false;
  return { result, sql: [...queries] };
}

function printSql(sql: string[]) {
  sql.forEach((q, i) => console.log(`  [${i + 1}] ${q}`));
}

// ── 1. include: one query or two? ──────────────────────────────────────
section("include folders with strips (default strategy)");
{
  const { result, sql } = await capture(() =>
    prisma.folder.findMany({
      where: { pdf_document_id: 2 },
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      include: { focusable_strips: { orderBy: [{ ordering: "asc" }, { id: "asc" }] } },
    }),
  );
  printSql(sql);
  console.log("  rows:", result.length, "strips in first folder:", result[0]?.focusable_strips.length);
}

section("include the to-one parent (folder -> document)");
{
  const { result, sql } = await capture(() =>
    prisma.folder.findMany({ where: { pdf_document_id: 2 }, include: { pdf_document: true } }),
  );
  printSql(sql);
  console.log("  folder -> document:", result[0]?.pdf_document?.name?.slice(0, 20));
}

// ── 2. counting ────────────────────────────────────────────────────────
section("_count include on a to-many relation");
{
  const { result, sql } = await capture(() =>
    prisma.folder.findMany({
      where: { pdf_document_id: 2 },
      include: { _count: { select: { focusable_strips: true } } },
    }),
  );
  printSql(sql);
  console.log("  counts:", result.map((f) => f._count.focusable_strips));
}

section("_count include together with the rows themselves");
{
  const { result, sql } = await capture(() =>
    prisma.folder.findUnique({
      where: { id: 5 },
      include: { _count: { select: { focusable_strips: true } }, focusable_strips: true },
    }),
  );
  printSql(sql);
  console.log("  count vs loaded:", result?._count.focusable_strips, result?.focusable_strips.length);
}

section("count() with a filter");
{
  const { result, sql } = await capture(() =>
    prisma.event_audit.count({ where: { success: true } }),
  );
  printSql(sql);
  console.log("  successful audits:", result);
}

section("orderBy a relation _count");
{
  const { result, sql } = await capture(() =>
    prisma.pdf_document.findMany({
      orderBy: { folders: { _count: "desc" } },
      include: { _count: { select: { folders: true, focusable_strips: true } } },
    }),
  );
  printSql(sql);
  console.log(
    "  order:",
    result.map((d) => `${d.id}:${d._count.folders}/${d._count.focusable_strips}`),
  );
}

section("aggregate: _max, _min, _sum, _avg, _count");
{
  const { result, sql } = await capture(() =>
    prisma.focusable_strip.aggregate({
      where: { pdf_document_id: 2 },
      _max: { ordering: true, page_number: true },
      _min: { ordering: true },
      _count: { _all: true },
      _avg: { page_number: true },
    }),
  );
  printSql(sql);
  console.log("  aggregate:", result);
}

section("groupBy with having on an aggregate");
{
  const { result, sql } = await capture(() =>
    prisma.focusable_strip.groupBy({
      by: ["page_number"],
      where: { pdf_document_id: 2 },
      _count: { _all: true },
      having: { page_number: { _count: { gt: 1 } } },
      orderBy: { _count: { page_number: "desc" } },
    }),
  );
  printSql(sql);
  console.log("  groups:", result.map((g) => `${g.page_number}:${g._count._all}`));
}

// ── 3. relation filters ────────────────────────────────────────────────
section("to-many filter: some / none / every");
{
  const some = await capture(() =>
    prisma.pdf_document.findMany({
      where: { folders: { some: { focusable_strips: { some: {} } } } },
      select: { id: true },
    }),
  );
  printSql(some.sql);
  console.log("  with folders that hold strips:", some.result.map((d) => d.id));

  const none = await capture(() =>
    prisma.pdf_document.findMany({
      where: { folders: { none: {} } },
      select: { id: true },
    }),
  );
  printSql(none.sql);
  console.log("  without folders:", none.result.map((d) => d.id));

  const every = await capture(() =>
    prisma.folder.findMany({
      where: { focusable_strips: { every: { page_number: { gte: 6 } } } },
      select: { id: true },
    }),
  );
  printSql(every.sql);
  console.log("  folders whose strips are all on page >= 6:", every.result.map((f) => f.id));
}

// ── 4. reading one row ─────────────────────────────────────────────────
section("findUnique vs findFirst");
{
  const unique = await capture(() => prisma.folder.findUnique({ where: { id: 5 } }));
  printSql(unique.sql);
  const first = await capture(() =>
    prisma.folder.findFirst({ where: { pdf_document_id: 2 }, orderBy: { id: "asc" } }),
  );
  printSql(first.sql);
  console.log("  same row:", unique.result?.id === first.result?.id);
}

section("select and omit");
{
  const selected = await capture(() =>
    prisma.folder.findMany({ where: { pdf_document_id: 2 }, select: { id: true, name: true } }),
  );
  printSql(selected.sql);
  const omitted = await capture(() =>
    prisma.folder.findMany({ omit: { created_at: true }, where: { pdf_document_id: 2 } }),
  );
  printSql(omitted.sql);
  console.log("  selected keys:", Object.keys(selected.result[0] ?? {}));
  console.log("  omitted keys:", Object.keys(omitted.result[0] ?? {}));
}

// ── 5. pagination ──────────────────────────────────────────────────────
section("offset pagination: skip + take");
{
  const { result, sql } = await capture(() =>
    prisma.event_audit.findMany({ orderBy: { created_at: "desc" }, skip: 0, take: 3 }),
  );
  printSql(sql);
  console.log("  ids:", result.map((r) => r.id));
}

section("cursor pagination");
{
  const { result, sql } = await capture(() =>
    prisma.event_audit.findMany({
      orderBy: { id: "asc" },
      take: 3,
      cursor: { id: 10 },
      skip: 1,
    }),
  );
  printSql(sql);
  console.log("  ids after cursor 10:", result.map((r) => r.id));
}

section("distinct");
{
  const { result, sql } = await capture(() =>
    prisma.focusable_strip.findMany({ where: { pdf_document_id: 2 }, distinct: ["page_number"], orderBy: { page_number: "asc" } }),
  );
  printSql(sql);
  console.log("  distinct pages:", result.map((r) => r.page_number));
}

// ── 6. writes ──────────────────────────────────────────────────────────
section("create");
{
  const { result, sql } = await capture(() =>
    prisma.folder.create({ data: { pdf_document_id: 2, name: "created", ordering: 9, created_at: Date.now() } }),
  );
  printSql(sql);
  console.log("  created folder:", result.id);
  await prisma.folder.delete({ where: { id: result.id } });
}

section("createMany on SQLite");
{
  const { result, sql } = await capture(() =>
    prisma.event_audit.createMany({
      data: [
        { request_id: "lab-1", kind: "command", event_type: "LabEvent", payload: "{}", event_order: 0, success: true, failure_reason: "", created_at: Date.now() },
        { request_id: "lab-1", kind: "event", event_type: "LabEvent", payload: "{}", event_order: 1, success: true, failure_reason: "", created_at: Date.now() },
      ],
    }),
  );
  printSql(sql);
  console.log("  inserted:", result.count);
  const cleanup = await capture(() => prisma.event_audit.deleteMany({ where: { request_id: "lab-1" } }));
  printSql(cleanup.sql);
}

section("upsert");
{
  const { result, sql } = await capture(() =>
    prisma.app_state.upsert({
      where: { key: "lab-key" },
      create: { key: "lab-key", value: "first", updated_at: Date.now() },
      update: { value: "second", updated_at: Date.now() },
    }),
  );
  printSql(sql);
  console.log("  upsert value:", result.value);
  await prisma.app_state.deleteMany({ where: { key: "lab-key" } });
}

section("updateMany and deleteMany");
{
  const update = await capture(() =>
    prisma.focusable_strip.updateMany({ where: { folder_id: 5, ordering: { gt: 0 } }, data: { remark: "lab" } }),
  );
  printSql(update.sql);
  console.log("  updated rows:", update.result.count);
  const revert = await capture(() =>
    prisma.focusable_strip.updateMany({ where: { folder_id: 5 }, data: { remark: "" } }),
  );
  printSql(revert.sql);
}

section("nested write: connect, disconnect, set");
{
  const connect = await capture(() =>
    prisma.folder.update({ where: { id: 5 }, data: { focusable_strips: { connect: { id: 16 } } } }),
  );
  printSql(connect.sql);
  const disconnect = await capture(() =>
    prisma.folder.update({ where: { id: 5 }, data: { focusable_strips: { disconnect: { id: 16 } } } }),
  );
  printSql(disconnect.sql);
}

section("nested write: connectOrCreate");
{
  const { result, sql } = await capture(() =>
    prisma.pdf_document.upsert({
      where: { file_path: "/tmp/prisma-lab/lab-doc.pdf" },
      create: {
        name: "lab doc",
        file_path: "/tmp/prisma-lab/lab-doc.pdf",
        created_at: Date.now(),
        folders: { create: [{ name: "auto", ordering: 0, created_at: Date.now() }] },
      },
      update: {},
      include: { folders: true },
    }),
  );
  printSql(sql);
  console.log("  nested created folders:", result.folders.length);
  await prisma.pdf_document.deleteMany({ where: { file_path: "/tmp/prisma-lab/lab-doc.pdf" } });
}

// ── 7. transactions ────────────────────────────────────────────────────
section("batch transaction: $transaction([...])");
{
  const { result, sql } = await capture(() =>
    prisma.$transaction([
      prisma.folder.count(),
      prisma.focusable_strip.count(),
    ]),
  );
  printSql(sql);
  console.log("  counts:", result);
}

section("interactive transaction with timeout options");
{
  const { result, sql } = await capture(() =>
    prisma.$transaction(
      async (tx) => {
        const folder = await tx.folder.findUnique({ where: { id: 5 } });
        const strips = await tx.focusable_strip.count({ where: { folder_id: 5 } });
        return { name: folder?.name, strips };
      },
      { maxWait: 5_000, timeout: 60_000 },
    ),
  );
  printSql(sql);
  console.log("  inside transaction:", result);
}

// ── 8. raw SQL ─────────────────────────────────────────────────────────
section("raw LEFT JOIN: documents with their folder count, including zero");
{
  const rows = await capture(() =>
    prisma.$queryRaw<{ id: number; name: string; folders: number }[]>`
      SELECT d.id,
             d.name,
             COUNT(f.id) AS folders
      FROM pdf_document AS d
      LEFT JOIN folder AS f ON f.pdf_document_id = d.id
      GROUP BY d.id, d.name
      ORDER BY d.id
    `,
  );
  printSql(rows.sql);
  console.log("  rows:", rows.result);
}

section("raw query with a parameter and Prisma.sql composition");
{
  const ids = [2];
  const rows = await capture(() =>
    prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT f.id
      FROM folder AS f
      LEFT JOIN focusable_strip AS s ON s.folder_id = f.id
      WHERE f.pdf_document_id IN (${ids.join(",")}) AND s.id IS NULL
    `,
  );
  printSql(rows.sql);
  console.log("  empty folders:", rows.result);
}

section("executeRaw for a write");
{
  const written = await capture(() =>
    prisma.$executeRaw`UPDATE focusable_strip SET remark = remark WHERE id = 16`,
  );
  printSql(written.sql);
  console.log("  rows touched:", written.result);
}

// ── 9. the relation-count filter gap ───────────────────────────────────
section("filter parents by relation count: no where support, workarounds");
{
  // (a) Cannot express a count comparison in `where`; the closest filter is
  // "has some children", which is not "has more than N children".
  const someOnly = await capture(() =>
    prisma.folder.findMany({ where: { focusable_strips: { some: {} } }, select: { id: true } }),
  );
  printSql(someOnly.sql);

  // (b) Load counts, filter in application code.
  const inApp = await capture(() =>
    prisma.folder.findMany({
      include: { _count: { select: { focusable_strips: true } } },
    }),
  );
  printSql(inApp.sql);
  const bigEnough = inApp.result.filter((f) => f._count.focusable_strips > 2).map((f) => f.id);
  console.log("  folders with more than 2 strips (filtered in app):", bigEnough);

  // (c) groupBy + having expresses the count comparison in SQL.
  const grouped = await capture(() =>
    prisma.focusable_strip.groupBy({
      by: ["folder_id"],
      having: { folder_id: { _count: { gt: 2 } } },
      _count: { _all: true },
    }),
  );
  printSql(grouped.sql);
  console.log("  groupBy + having:", grouped.result.map((g) => `${g.folder_id}:${g._count._all}`));

  // (d) Raw SQL for the same question.
  const raw = await capture(() =>
    prisma.$queryRaw<{ id: number; n: bigint }[]>`
      SELECT f.id, COUNT(s.id) AS n
      FROM folder AS f
      LEFT JOIN focusable_strip AS s ON s.folder_id = f.id
      WHERE f.pdf_document_id = 2
      GROUP BY f.id
      HAVING COUNT(s.id) > 2
    `,
  );
  printSql(raw.sql);
  console.log("  raw having:", raw.result.map((r) => `${r.id}:${r.n}`));
}

await prisma.$disconnect();
originalLog("\nlab finished");
