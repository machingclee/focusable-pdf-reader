/** Second lab: nested writes, raw composition, engine limits. */
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient, Prisma } from "/Users/chingcheonglee/Repos/Javascript/2026-08-23-tauri-pdf-focus-viewer/backend/src/generated/prisma/client.ts";

const adapter = new PrismaBunSqlite({ url: "file:/tmp/prisma-lab/lab.db" });
const prisma = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });

const queries: string[] = [];
let capturing = false;
prisma.$on("query", (event) => {
  if (capturing) queries.push(event.query.replace(/\s+/g, " ").trim());
});

function section(title: string) {
  console.log(`\n===== ${title} =====`);
}

async function capture<T>(fn: () => Promise<T>) {
  queries.length = 0;
  capturing = true;
  const result = await fn();
  capturing = false;
  return { result, sql: [...queries] };
}
const printSql = (sql: string[]) => sql.forEach((q, i) => console.log(`  [${i + 1}] ${q}`));

section("nested connect / disconnect / set");
{
  const connect = await capture(() =>
    prisma.folder.update({ where: { id: 5 }, data: { focusable_strips: { connect: { id: 16 } } } }),
  );
  printSql(connect.sql);

  const disconnect = await capture(() =>
    prisma.folder.update({ where: { id: 5 }, data: { focusable_strips: { disconnect: { id: 16 } } } }),
  );
  printSql(disconnect.sql);

  const set = await capture(() =>
    prisma.folder.update({ where: { id: 5 }, data: { focusable_strips: { set: [{ id: 16 }, { id: 31 }] } } }),
  );
  printSql(set.sql);
  console.log("  after set, filed strips:", set.result.id);
}

section("nested delete: folder delete cascades in the schema");
{
  const sql = await capture(async () => {
    const folder = await prisma.folder.create({
      data: { pdf_document_id: 2, name: "cascade-lab", ordering: 7, created_at: Date.now() },
    });
    await prisma.focusable_strip.create({
      data: {
        pdf_document_id: 2, folder_id: folder.id, ordering: 0, page_number: 1,
        top: 0, height: 1, left: 0, width: 1, page_width: 600, page_height: 800, created_at: Date.now(),
      },
    });
    await prisma.folder.delete({ where: { id: folder.id } });
    return prisma.focusable_strip.count({ where: { folder_id: folder.id } });
  });
  printSql(sql.sql);
  console.log("  strips left after folder delete:", sql.result);
}

section("relationLoadStrategy still accepted?");
{
  try {
    const res = await capture(() =>
      prisma.folder.findMany({ where: { pdf_document_id: 2 }, include: { focusable_strips: true }, relationLoadStrategy: "join" } as never),
    );
    printSql(res.sql);
    console.log("  accepted, queries:", res.sql.length);
  } catch (error) {
    console.log("  rejected:", (error as Error).message.split("\n")[0]);
  }
}

section("createMany skipDuplicates");
{
  try {
    const res = await capture(() =>
      prisma.event_audit.createMany({
        data: [{ request_id: "lab-skip", kind: "event", event_type: "X", payload: "{}", event_order: 0, success: true, failure_reason: "", created_at: Date.now() }],
        skipDuplicates: true,
      }),
    );
    printSql(res.sql);
    console.log("  inserted:", res.result.count);
    await prisma.event_audit.deleteMany({ where: { request_id: "lab-skip" } });
  } catch (error) {
    console.log("  rejected:", (error as Error).message.split("\n")[0]);
  }
}

section("Prisma.join in a raw query");
{
  const ids = [1, 2];
  const rows = await capture(() =>
    prisma.$queryRaw<{ id: number }[]>`
      SELECT d.id FROM pdf_document AS d WHERE d.id IN (${Prisma.join(ids)}) ORDER BY d.id
    `,
  );
  printSql(rows.sql);
  console.log("  rows:", rows.result);
}

section("Prisma.sql composition and Prisma.empty");
{
  const where = Prisma.sql`WHERE d.id > ${0}`;
  const rows = await capture(() =>
    prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT d.id FROM pdf_document AS d ${where} ORDER BY d.id ${Prisma.empty}`),
  );
  printSql(rows.sql);
  console.log("  rows:", rows.result);
}

section("raw aggregate types on SQLite");
{
  const rows = await capture(() =>
    prisma.$queryRaw<{ total: bigint; avg_pages: number | null }[]>`
      SELECT COUNT(*) AS total, AVG(page_count) AS avg_pages FROM pdf_document
    `,
  );
  printSql(rows.sql);
  console.log("  types:", rows.result.map((r) => [typeof r.total, typeof r.avg_pages]));
  console.log("  values:", rows.result);
}

section("$queryRaw with a value inside a float/limit position");
{
  const limit = 2;
  try {
    const rows = await capture(() =>
      prisma.$queryRaw<{ id: number }[]>`SELECT id FROM folder LIMIT ${limit}`,
    );
    printSql(rows.sql);
    console.log("  rows:", rows.result);
  } catch (error) {
    console.log("  rejected:", (error as Error).message.split("\n")[0]);
  }
}

section("findUnique on a unique non-id column");
{
  const rows = await capture(() => prisma.pdf_document.findUnique({ where: { file_path: "/tmp/prisma-lab/lab-doc.pdf" } }));
  printSql(rows.sql);
  console.log("  found:", rows.result?.id ?? null);
}

section("update returning and updateMany comparison");
{
  const one = await capture(() =>
    prisma.app_state.update({ where: { key: "lab-state" }, data: { value: "v2" } }).catch((e) => e),
  );
  printSql(one.sql);
  console.log("  single update error:", one.result instanceof Error ? one.result.message.split("\n")[0] : "ok");
}

await prisma.$disconnect();
console.log("\nlab2 finished");
