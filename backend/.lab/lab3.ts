import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "/Users/chingcheonglee/Repos/Javascript/2026-08-23-tauri-pdf-focus-viewer/backend/src/generated/prisma/client.ts";
const prisma = new PrismaClient({ adapter: new PrismaBunSqlite({ url: "file:/tmp/prisma-lab/lab.db" }) });

for (const [label, fn] of [
  ["relationLoadStrategy", () => prisma.folder.findMany({ where: { pdf_document_id: 2 }, include: { focusable_strips: true }, relationLoadStrategy: "join" } as never)],
  ["createMany skipDuplicates", () => prisma.event_audit.createMany({ data: [{ request_id: "x", kind: "event", event_type: "X", payload: "{}", event_order: 0, success: true, failure_reason: "", created_at: 1 }], skipDuplicates: true })],
  ["createMany nested relation", () => prisma.pdf_document.createMany({ data: [{ name: "x", file_path: "/tmp/x.pdf", created_at: 1, folders: { create: [] } } as never] })],
  ["groupBy unknown orderBy", () => prisma.focusable_strip.groupBy({ by: ["page_number"], _count: { _all: true } })],
] as const) {
  try {
    const r = await (fn as () => Promise<unknown>)();
    console.log(`${label}: OK`, JSON.stringify(r).slice(0, 80));
  } catch (e) {
    const msg = (e as Error).message.replace(/\s+/g, " ").trim();
    console.log(`${label}: ERROR ${msg.slice(0, 260)}`);
  }
}
await prisma.$disconnect();
