/**
 * The annotation entity, against a real database.
 *
 * What a reader can observe: a pin is a row on one page of one document, its text
 * is trimmed and never empty, the page it names has to exist on that document, a
 * strip's page is handed exactly the pins drawn on it, and undo/redo leave the
 * pin under the same id — which is what a `[annotation:<id>]` reference in a note
 * depends on.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AUDIT_WRITER, Container, MemoryAuditWriter, TRANSACTION_RUNNER, createCqrsModule } from "@machingclee/express-cqrs";
import { PDF_FOCUS_VIEWER_COMPONENTS } from "../src/bounded-contexts/components.ts";
import { ApplyHistoryCommand } from "../src/bounded-contexts/history-management/command/ApplyHistoryCommand.ts";
import { SessionHistory } from "../src/bounded-contexts/history-management/service/SessionHistory.ts";
import { CreatePdfAnnotationCommand } from "../src/bounded-contexts/pdf-markup-management/command/CreatePdfAnnotationCommand.ts";
import { DeletePdfAnnotationCommand } from "../src/bounded-contexts/pdf-markup-management/command/DeletePdfAnnotationCommand.ts";
import { DeletePdfDocumentCommand } from "../src/bounded-contexts/pdf-note-management/command/DeletePdfDocumentCommand.ts";
import { UpdatePdfAnnotationCommand } from "../src/bounded-contexts/pdf-markup-management/command/UpdatePdfAnnotationCommand.ts";
import { GetPdfAnnotationQuery } from "../src/bounded-contexts/pdf-markup-management/query/GetPdfAnnotationQuery.ts";
import { ListPdfAnnotationsQuery } from "../src/bounded-contexts/pdf-markup-management/query/ListPdfAnnotationsQuery.ts";
import { ListNotesQuery } from "../src/bounded-contexts/pdf-note-management/query/ListNotesQuery.ts";
import { presentPages } from "../src/bounded-contexts/pdf-markup-management/highlight/marks.ts";
import { createPrismaClient } from "../src/infrastructure/prisma/client.ts";
import { applyMigrations } from "../src/infrastructure/prisma/migrate.ts";
import { PrismaUnitOfWork } from "../src/infrastructure/prisma/unitOfWork.ts";

const root = mkdtempSync(join(tmpdir(), "pdf-annotations-"));
const databasePath = join(root, "database.db");
process.env.DATABASE_URL = `file:${databasePath}`;

const db = createPrismaClient(databasePath);
const unitOfWork = new PrismaUnitOfWork(db);
const container = new Container();
const audit = new MemoryAuditWriter();
container.registerValue(TRANSACTION_RUNNER, unitOfWork);
container.registerValue(AUDIT_WRITER, audit);
container.registerValue(PrismaUnitOfWork, unitOfWork);
const cqrs = createCqrsModule({
  container,
  components: PDF_FOCUS_VIEWER_COMPONENTS,
  strictDomainTypes: true,
});
const history = container.resolve(SessionHistory);

let order = 0;

/** A document row with a known page count, so placement can be checked against it. */
async function seedDocument(name: string, pageCount: number | null = 10) {
  const document = await db.pdf_document.create({
    data: {
      name,
      file_path: join(root, `${name}-${order++}.pdf`),
      page_count: pageCount,
      ordering: order,
      created_at: Date.now(),
    },
  });
  return document;
}

/** A strip of a page, which is what a note card is: a band of one page. */
async function seedStrip(documentId: number, pageNumber: number) {
  return db.note.create({
    data: {
      pdf_document_id: documentId,
      ordering: 0,
      page_number: pageNumber,
      top: 100,
      height: 60,
      left: 40,
      width: 400,
      page_width: 595,
      page_height: 842,
      text_excerpt: null,
      remark: "",
      created_at: Date.now(),
    },
  });
}

const pin = (documentId: number, page_number: number, x: number, y: number, text: string) =>
  cqrs.commandBus.send(new CreatePdfAnnotationCommand(documentId, { page_number, x, y, text }));

describe("annotations", () => {
  beforeAll(() => {
    applyMigrations(databasePath);
  });

  beforeEach(async () => {
    // Every test starts from its own rows. The history stack is the process's and
    // is only ever read at its top, which each test's own command has just set.
    await db.annotation.deleteMany();
    await db.highlight.deleteMany();
    await db.note.deleteMany();
    await db.note_folder.deleteMany();
    await db.pdf_document.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
    rmSync(root, { recursive: true, force: true });
  });

  test("pins text to a page, trimmed, and reads it back with its document", async () => {
    const document = await seedDocument("Chapter 1");
    const created = await pin(document.id, 3, 120.456, 640.004, "  the argument turns here  ");

    expect(created.text).toBe("the argument turns here");
    expect(created.page_number).toBe(3);
    // Rounded to hundredths of a point, like the viewer's own mark lists.
    expect(created.x).toBe(120.46);
    expect(created.y).toBe(640);

    const read = await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id));
    expect(read.pdf_document).toEqual({
      id: document.id,
      name: "Chapter 1",
      file_path: document.file_path,
    });
  });

  test("the content has a width of its own, which the reader can change", async () => {
    const document = await seedDocument("Width");
    const created = await pin(document.id, 1, 10, 10, "**wide** content");
    // A new pin starts at the default width.
    expect(created.width).toBe(150);

    const widened = await cqrs.commandBus.send(
      new UpdatePdfAnnotationCommand(created.id, { width: 420.004 }),
    );
    expect(widened.width).toBe(420);
    // A resize is not a retype and not a move.
    expect(widened.text).toBe("**wide** content");
    expect(widened.page_number).toBe(1);
    expect(widened.x).toBe(10);
    expect(history.peek("undo")?.label).toBe("Resize annotation");

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    expect((await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id))).width).toBe(150);
  });

  test("the writing has a type size of its own, which the reader takes up and down", async () => {
    const document = await seedDocument("Type size");
    const created = await pin(document.id, 1, 10, 10, "a marginal note");
    // A new pin is written in the size the viewer draws writing at.
    expect(created.font_size).toBe(9);

    const bigger = await cqrs.commandBus.send(
      new UpdatePdfAnnotationCommand(created.id, { font_size: 12.256 }),
    );
    // Rounded like a placement, and no other column moved with it.
    expect(bigger.font_size).toBe(12.26);
    expect(bigger.width).toBe(150);
    expect(bigger.text).toBe("a marginal note");
    expect(bigger.page_number).toBe(1);
    expect(bigger.x).toBe(10);
    expect(history.peek("undo")?.label).toBe("Annotation text size");

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    expect((await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id))).font_size).toBe(9);

    await cqrs.commandBus.send(new ApplyHistoryCommand("redo"));
    expect((await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id))).font_size).toBe(12.26);
  });

  test("a pin may be created at a size of the reader's choosing", async () => {
    const document = await seedDocument("Created size");
    const created = await cqrs.commandBus.send(
      new CreatePdfAnnotationCommand(document.id, {
        page_number: 1,
        x: 10,
        y: 10,
        font_size: 12,
        text: "bigger from the start",
      }),
    );
    expect(created.font_size).toBe(12);
  });

  test("a type size outside the readable bounds is refused", async () => {
    const document = await seedDocument("Type size rules");
    const created = await pin(document.id, 1, 10, 10, "text");

    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { font_size: 3 })),
    ).rejects.toThrow(/font_size must be between/);
    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { font_size: 40 })),
    ).rejects.toThrow(/font_size must be between/);
    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { font_size: Number.NaN })),
    ).rejects.toThrow(/finite/);
    expect((await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id))).font_size).toBe(9);
  });

  test("a width outside the page's sensible bounds is refused", async () => {
    const document = await seedDocument("Width rules");
    const created = await pin(document.id, 1, 10, 10, "text");

    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { width: 10 })),
    ).rejects.toThrow(/width must be between/);
    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { width: 5_000 })),
    ).rejects.toThrow(/width must be between/);
    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { width: Number.NaN })),
    ).rejects.toThrow(/finite/);
    expect((await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id))).width).toBe(150);
  });

  test("a document lists its pins oldest first, and an unmarked one is empty", async () => {
    const first = await seedDocument("One");
    const second = await seedDocument("Two");
    const a = await pin(first.id, 1, 10, 10, "a");
    const b = await pin(first.id, 2, 20, 20, "b");
    await pin(second.id, 1, 30, 30, "c");

    const listed = await cqrs.queryBus.send(new ListPdfAnnotationsQuery(first.id));
    expect(listed.map((row) => row.id)).toEqual([a.id, b.id]);
    expect(await cqrs.queryBus.send(new ListPdfAnnotationsQuery(second.id))).toHaveLength(1);

    const empty = await seedDocument("Empty");
    expect(await cqrs.queryBus.send(new ListPdfAnnotationsQuery(empty.id))).toEqual([]);
  });

  test("a strip's preview is handed only the pins on its own page", async () => {
    const document = await seedDocument("Badges");
    const onPageThree = await pin(document.id, 3, 100, 200, "page three");
    const onPageFour = await pin(document.id, 4, 100, 200, "page four");
    const strip = await seedStrip(document.id, 3);

    const [presented] = await presentPages(db, [strip]);
    const annotations = JSON.parse(presented!.annotations) as unknown[];
    expect(annotations).toEqual([
      { id: onPageThree.id, x: 100, y: 200, width: 150, font_size: 9, text: "page three" },
    ]);
    // The other list a preview paints is still there and still empty.
    expect(presented!.highlights).toBe("[]");
    expect(onPageFour.id).not.toBe(onPageThree.id);

    const listed = await cqrs.queryBus.send(new ListNotesQuery({ pdfDocumentId: document.id }));
    expect(JSON.parse(listed[0]!.annotations)).toHaveLength(1);
  });

  test("the text is rewritten in place and the same text writes no history step", async () => {
    const document = await seedDocument("Edit");
    const created = await pin(document.id, 1, 10, 10, "first draft");

    const updated = await cqrs.commandBus.send(
      new UpdatePdfAnnotationCommand(created.id, { text: "  second draft " }),
    );
    expect(updated.text).toBe("second draft");
    expect(updated.id).toBe(created.id);
    expect(updated.x).toBe(created.x);
    expect(history.peek("undo")?.label).toBe("Annotation");

    const before = history.peek("undo");
    await cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { text: "second draft" }));
    expect(history.peek("undo")).toBe(before);
  });

  test("undo of a new pin removes it, redo puts the same id back", async () => {
    const document = await seedDocument("Undo");
    const created = await pin(document.id, 2, 100, 300, "remember this");

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    expect(await db.annotation.findUnique({ where: { id: created.id } })).toBeNull();

    await cqrs.commandBus.send(new ApplyHistoryCommand("redo"));
    const restored = await db.annotation.findUnique({ where: { id: created.id } });
    expect(restored?.text).toBe("remember this");
    expect(restored?.page_number).toBe(2);
    expect(restored?.x).toBe(100);
    expect(restored?.y).toBe(300);
  });

  test("undo of a delete restores the row, id included, so references keep working", async () => {
    const document = await seedDocument("Delete");
    const created = await pin(document.id, 5, 40, 50, "a pin worth keeping");

    await cqrs.commandBus.send(new DeletePdfAnnotationCommand(created.id));
    expect(await db.annotation.findUnique({ where: { id: created.id } })).toBeNull();
    expect(history.peek("undo")?.label).toBe("Delete annotation");

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    const restored = await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id));
    expect(restored.text).toBe("a pin worth keeping");
    expect(restored.page_number).toBe(5);
    expect(restored.created_at).toBe(created.created_at);
  });

  test("a pin is moved as a whole placement, and undo puts it back where it was", async () => {
    const document = await seedDocument("Move");
    const created = await pin(document.id, 2, 100, 300, "this belongs on another line");

    const moved = await cqrs.commandBus.send(
      new UpdatePdfAnnotationCommand(created.id, { page_number: 6, x: 240.004, y: 88.456 }),
    );
    expect(moved.page_number).toBe(6);
    expect(moved.x).toBe(240);
    expect(moved.y).toBe(88.46);
    // A move is not a retype: the writing is untouched.
    expect(moved.text).toBe("this belongs on another line");
    expect(history.peek("undo")?.label).toBe("Move annotation");

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    const back = await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id));
    expect(back.page_number).toBe(2);
    expect(back.x).toBe(100);
    expect(back.y).toBe(300);

    await cqrs.commandBus.send(new ApplyHistoryCommand("redo"));
    const again = await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id));
    expect(again.page_number).toBe(6);
    expect(again.x).toBe(240);
    expect(again.y).toBe(88.46);
  });

  test("a move that names half a placement, or a page past the end, is refused", async () => {
    const document = await seedDocument("Half a move", 4);
    const created = await pin(document.id, 1, 10, 20, "stays put");

    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { page_number: 2 })),
    ).rejects.toThrow(/page, x and y together/);
    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { x: 5, y: 5 })),
    ).rejects.toThrow(/page, x and y together/);
    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { page_number: 9, x: 5, y: 5 })),
    ).rejects.toThrow(/at most 4/);
    await expect(
      cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, {})),
    ).rejects.toThrow(/names the text/);

    const untouched = await cqrs.queryBus.send(new GetPdfAnnotationQuery(created.id));
    expect(untouched.page_number).toBe(1);
    expect(untouched.x).toBe(10);
    expect(untouched.y).toBe(20);
  });

  test("a move that lands where the pin already is writes no history step", async () => {
    const document = await seedDocument("Stayed");
    const created = await pin(document.id, 3, 40, 50, "already here");
    const before = history.peek("undo");

    const same = await cqrs.commandBus.send(
      new UpdatePdfAnnotationCommand(created.id, { page_number: 3, x: 40, y: 50 }),
    );
    expect(same.id).toBe(created.id);
    expect(history.peek("undo")).toBe(before);
  });

  test("undo of a text edit writes the text it had before", async () => {
    const document = await seedDocument("Retype");
    const created = await pin(document.id, 1, 1, 1, "before");
    await cqrs.commandBus.send(new UpdatePdfAnnotationCommand(created.id, { text: "after" }));

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    const undone = await db.annotation.findUnique({ where: { id: created.id } });
    expect(undone?.text).toBe("before");

    await cqrs.commandBus.send(new ApplyHistoryCommand("redo"));
    const redone = await db.annotation.findUnique({ where: { id: created.id } });
    expect(redone?.text).toBe("after");
  });

  test("refuses an empty text, a page the document does not have, and a point off the paper", async () => {
    const document = await seedDocument("Rules", 4);

    await expect(pin(document.id, 1, 10, 10, "   ")).rejects.toThrow(/text must not be empty/);
    await expect(pin(document.id, 5, 10, 10, "past the end")).rejects.toThrow(/at most 4/);
    await expect(pin(document.id, 0, 10, 10, "page zero")).rejects.toThrow(/positive integer/);
    await expect(pin(document.id, 1, -1, 10, "off the left")).rejects.toThrow(/non-negative/);
    await expect(pin(document.id, 1, 10, Number.NaN, "not a point")).rejects.toThrow(/non-negative/);
    expect(await db.annotation.count()).toBe(0);
  });

  test("a document whose page count was never recorded still takes a pin", async () => {
    const document = await seedDocument("Unknown pages", null);
    const created = await pin(document.id, 42, 10, 10, "any page");
    expect(created.page_number).toBe(42);
  });

  test("a missing document or annotation is a 404", async () => {
    await expect(pin(9999, 1, 10, 10, "nowhere")).rejects.toThrow(/does not exist/);
    await expect(cqrs.queryBus.send(new GetPdfAnnotationQuery(9999))).rejects.toThrow(/does not exist/);
    await expect(cqrs.commandBus.send(new UpdatePdfAnnotationCommand(9999, { text: "x" }))).rejects.toThrow(/does not exist/);
    await expect(cqrs.commandBus.send(new DeletePdfAnnotationCommand(9999))).rejects.toThrow(/does not exist/);
  });

  test("deleting a document takes its pins, and undoing the delete brings them back", async () => {
    const document = await seedDocument("Whole document");
    const a = await pin(document.id, 1, 10, 20, "first");
    const b = await pin(document.id, 7, 30, 40, "second");

    await cqrs.commandBus.send(new DeletePdfDocumentCommand(document.id));
    expect(await db.annotation.count()).toBe(0);

    await cqrs.commandBus.send(new ApplyHistoryCommand("undo"));
    const restored = await cqrs.queryBus.send(new ListPdfAnnotationsQuery(document.id));
    expect(restored.map((row) => ({ id: row.id, text: row.text }))).toEqual([
      { id: a.id, text: "first" },
      { id: b.id, text: "second" },
    ]);
    expect(restored[1]!.page_number).toBe(7);
  });
});

/**
 * The split itself, checked against the graph the decorators build.
 *
 * Moving the files is easy; moving the `@BoundedContext` with them is what makes
 * markup a context of its own. A class left annotated with the notes context
 * would pass every other test in this file.
 */
describe("markup bounded context", () => {
  const markupContext = "PDF Markup Management";
  const noteContext = "PDF Note Management";
  const historyContext = "History Management";

  const markupCommands = [
    "CreatePdfAnnotationCommand",
    "UpdatePdfAnnotationCommand",
    "DeletePdfAnnotationCommand",
    "ReplacePdfHighlightsCommand",
    "RestoreAnnotationCommand",
    "RemoveCreatedAnnotationCommand",
    "SetAnnotationFieldsCommand",
  ];
  const markupQueries = [
    "GetPdfHighlightsQuery",
    "ListPdfAnnotationsQuery",
    "GetPdfAnnotationQuery",
  ];

  test("every pin and stroke node reports the markup context", () => {
    const flow = cqrs.flow();

    const commands = flow.commands.filter((command) => markupCommands.includes(command.name));
    expect(commands.map((command) => command.name).sort()).toEqual([...markupCommands].sort());
    expect(commands.every((command) => command.context === markupContext)).toBe(true);

    const queries = flow.queries.filter((query) => markupQueries.includes(query.name));
    expect(queries.map((query) => query.name).sort()).toEqual([...markupQueries].sort());
    expect(queries.every((query) => query.context === markupContext)).toBe(true);
  });

  test("the document that owns the rows is still the notes context's", () => {
    const flow = cqrs.flow();
    expect(flow.commands.find((command) => command.name === "DeletePdfDocumentCommand")?.context)
      .toBe(noteContext);
    expect(flow.queries.find((query) => query.name === "ListNotesQuery")?.context)
      .toBe(noteContext);
  });

  test("markup records a step it does not own", () => {
    const flow = cqrs.flow();

    const pin = flow.commands.find((command) => command.name === "CreatePdfAnnotationCommand");
    const strokes = flow.commands.find((command) => command.name === "ReplacePdfHighlightsCommand");
    expect(pin?.emits).toContain("HistoryUndoRedoReadyEvent");
    expect(strokes?.emits).toContain("HistoryUndoRedoReadyEvent");
    expect(flow.events.find((event) => event.name === "HistoryUndoRedoReadyEvent")?.context)
      .toBe(historyContext);
  });
});
