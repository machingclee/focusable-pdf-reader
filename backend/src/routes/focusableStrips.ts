import { Router } from "express";
import type { AppPrisma } from "../db.ts";
import {
  badRequest,
  bodyObject,
  notFound,
  optionalString,
  parseIdParam,
  parseOptionalQueryInt,
  requireFiniteNumber,
  requireInteger,
} from "../http.ts";

/**
 * `/focusable-strips` - a saved focus strip plus the note attached to it.
 *
 * Geometry is in PDF points (1pt = 1 CSS px at 100% zoom), so a strip keeps its
 * place at any zoom level. Reopening one is:
 * `contentLock = { page: pageNumber, fracY: (top + height / 2) / pageHeight }`
 * with `stripHeight = height`.
 */
export function createFocusableStripsRouter(prisma: AppPrisma): Router {
  const router = Router();

  /** All strips, or the strips of one document / one page. */
  router.get("/", async (req, res) => {
    const pdfDocumentId = parseOptionalQueryInt(req.query.pdfDocumentId, "pdfDocumentId");
    const pageNumber = parseOptionalQueryInt(req.query.pageNumber, "pageNumber");

    const strips = await prisma.focusableStrip.findMany({
      where: {
        ...(pdfDocumentId === undefined ? {} : { pdfDocumentId }),
        ...(pageNumber === undefined ? {} : { pageNumber }),
      },
      orderBy: [{ pdfDocumentId: "asc" }, { pageNumber: "asc" }, { top: "asc" }],
      include: { pdfDocument: { select: { id: true, name: true, filePath: true } } },
    });

    res.json(strips);
  });

  /** Save the strip the viewer just placed. */
  router.post("/", async (req, res) => {
    const body = bodyObject(req.body);
    const pdfDocumentId = requireInteger(body, "pdfDocumentId");
    const pageNumber = requireInteger(body, "pageNumber");
    const top = requireFiniteNumber(body, "top");
    const height = requireFiniteNumber(body, "height");
    const left = requireFiniteNumber(body, "left");
    const width = requireFiniteNumber(body, "width");
    const pageWidth = requireFiniteNumber(body, "pageWidth");
    const pageHeight = requireFiniteNumber(body, "pageHeight");
    const textExcerpt = optionalString(body, "textExcerpt", 2000);
    const remark = optionalString(body, "remark", 100_000);

    if (height <= 0) throw badRequest('"height" must be greater than 0');
    if (width <= 0) throw badRequest('"width" must be greater than 0');
    if (pageWidth <= 0 || pageHeight <= 0) throw badRequest('"pageWidth" and "pageHeight" must be greater than 0');
    if (top < 0) throw badRequest('"top" must not be negative');
    if (left < 0) throw badRequest('"left" must not be negative');

    const document = await prisma.pdfDocument.findUnique({ where: { id: pdfDocumentId } });
    if (!document) throw notFound(`PDF document ${pdfDocumentId} does not exist`);

    const strip = await prisma.focusableStrip.create({
      data: {
        pdfDocumentId,
        pageNumber,
        top,
        height,
        left,
        width,
        pageWidth,
        pageHeight,
        textExcerpt: textExcerpt ?? null,
        remark: remark ?? "",
        createdAt: Date.now(),
      },
    });

    res.status(201).json(strip);
  });

  /** Update a strip's markdown remark. */
  router.patch("/:id", async (req, res) => {
    const id = parseIdParam(req.params.id);
    const body = bodyObject(req.body);
    const remark = optionalString(body, "remark", 100_000);
    if (remark === undefined) throw badRequest('"remark" is required');

    const existing = await prisma.focusableStrip.findUnique({ where: { id } });
    if (!existing) throw notFound(`Focusable strip ${id} does not exist`);

    const strip = await prisma.focusableStrip.update({ where: { id }, data: { remark } });
    res.json(strip);
  });

  /** Remove a strip. */
  router.delete("/:id", async (req, res) => {
    const id = parseIdParam(req.params.id);

    const existing = await prisma.focusableStrip.findUnique({ where: { id } });
    if (!existing) throw notFound(`Focusable strip ${id} does not exist`);

    await prisma.focusableStrip.delete({ where: { id } });
    res.status(204).end();
  });

  return router;
}
