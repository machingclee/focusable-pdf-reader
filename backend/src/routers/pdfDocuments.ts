import { Router } from "express";
import type { AppPrisma } from "../db.ts";
import { bodyObject, notFound, optionalPositiveInteger, optionalString, parseIdParam, requireString } from "../http.ts";

/**
 * `/pdf-documents` - one row per opened PDF file.
 */
export function createPdfDocumentsRouter(prisma: AppPrisma): Router {
  const router = Router();

  /** Every document, newest first, with how many strips it has. */
  router.get("/", async (_req, res) => {
    const documents = await prisma.pdfDocument.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { focusableStrips: true } } },
    });
    res.json(documents);
  });

  /**
   * Called every time a file is opened: create the document if the path is new,
   * otherwise refresh its metadata. Returns the document with all its strips so
   * the viewer can draw markers in one round trip.
   *
   * `name` is only written on update when `updateName: true` is sent, so a name
   * the user edited is not reset to the file name on the next open.
   */
  router.post("/resolve", async (req, res) => {
    const body = bodyObject(req.body);
    const filePath = requireString(body, "filePath", 4096);
    const name = optionalString(body, "name", 512);
    const fingerprint = optionalString(body, "fingerprint", 512);
    const pageCount = optionalPositiveInteger(body, "pageCount");
    const updateName = body.updateName === true;

    const document = await prisma.pdfDocument.upsert({
      where: { filePath },
      create: {
        filePath,
        name: name && name.length > 0 ? name : defaultNameFor(filePath),
        fingerprint: fingerprint ?? null,
        pageCount: pageCount ?? null,
        createdAt: Date.now(),
      },
      update: {
        ...(fingerprint === undefined ? {} : { fingerprint }),
        ...(pageCount === undefined ? {} : { pageCount }),
        ...(updateName && name ? { name } : {}),
      },
      include: {
        focusableStrips: { orderBy: [{ pageNumber: "asc" }, { top: "asc" }] },
      },
    });

    res.json(document);
  });

  /** Rename a document. */
  router.patch("/:id", async (req, res) => {
    const id = parseIdParam(req.params.id);
    const body = bodyObject(req.body);
    const name = requireString(body, "name", 512);

    const existing = await prisma.pdfDocument.findUnique({ where: { id } });
    if (!existing) throw notFound(`PDF document ${id} does not exist`);

    const document = await prisma.pdfDocument.update({ where: { id }, data: { name } });
    res.json(document);
  });

  return router;
}

/** Last path segment without its extension, used when the client sends no name. */
function defaultNameFor(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return stem.length > 0 ? stem : fileName;
}
