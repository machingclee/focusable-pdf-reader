import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "/Users/chingcheonglee/Repos/Javascript/2026-08-23-tauri-pdf-focus-viewer/backend/src/generated/prisma/client.ts";
const prisma = new PrismaClient({ adapter: new PrismaBunSqlite({ url: "file:/tmp/prisma-lab/lab.db" }), log: [{ emit: "event", level: "query" }] });
const q: string[] = []; let cap = false;
prisma.$on("query", (e) => { if (cap) q.push(e.query.replace(/\s+/g, " ").trim()); });
async function run(label: string, fn: () => Promise<unknown>, show = 2) {
  q.length = 0; cap = true;
  try {
    const r = await fn();
    cap = false;
    console.log(`\n== ${label}: OK ${JSON.stringify(r).slice(0, 120)}`);
    q.slice(0, show).forEach((s, i) => console.log(`  [${i + 1}] ${s}`));
  } catch (e: any) {
    cap = false;
    console.log(`\n== ${label}: ERROR code=${e?.code ?? "-"} ${e.message.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}
await run("update on a missing row", () => prisma.folder.update({ where: { id: 999999 }, data: { name: "x" } }));
await run("findUniqueOrThrow on a missing row", () => prisma.folder.findUniqueOrThrow({ where: { id: 999999 } }));
await run("filtered _count", () => prisma.folder.findMany({ where: { pdf_document_id: 2 }, include: { _count: { select: { focusable_strips: { where: { page_number: 7 } } } } } }));
await run("_count inside where", () => prisma.folder.findMany({ where: { _count: { focusable_strips: { gt: 2 } } } as never }));
await run("mode insensitive on SQLite", () => prisma.pdf_document.findMany({ where: { name: { contains: "ocpp", mode: "insensitive" } } as never }));
await run("update with increment", () => prisma.focusable_strip.update({ where: { id: 32 }, data: { ordering: { increment: 1 } } }));
await run("update with decrement back", () => prisma.focusable_strip.update({ where: { id: 32 }, data: { ordering: { decrement: 1 } } }));
await run("createManyAndReturn", () => (prisma.event_audit as any).createManyAndReturn({ data: [{ request_id: "lab-ret", kind: "event", event_type: "X", payload: "{}", event_order: 0, success: true, failure_reason: "", created_at: 1 }] }));
await run("deleteMany the lab-ret rows", () => prisma.event_audit.deleteMany({ where: { request_id: "lab-ret" } }));
await run("interactive transaction with isolationLevel", () => prisma.$transaction(async (tx) => tx.folder.count(), { isolationLevel: "Serializable" as never }));
await run("nulls ordering", () => prisma.pdf_document.findMany({ orderBy: { content_hash: { sort: "asc", nulls: "last" } } as never }));
await run("findMany take negative", () => prisma.event_audit.findMany({ orderBy: { id: "desc" }, take: -2 }));
await run("count with select", () => prisma.event_audit.count({ select: { _all: true, request_user_email: true } }));
await prisma.$disconnect();
