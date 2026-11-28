/**
 * `/annotations` and the document's annotation list, as RTK Query endpoints.
 *
 * An annotation is a row with an id, so it is not written as a whole list the way
 * a document's highlight strokes are: a pin is created, retyped and removed on its
 * own, and one of them is read on its own by a `[annotation:<id>]` reference in a
 * note — which may live in another document entirely, so the list query cannot
 * answer it.
 *
 * Every write also invalidates the notes' own lists, for the same reason a
 * highlight write does: `GET /notes` hands each strip the pins on its page, and a
 * card's preview paints them. Without that invalidation a pin would appear on the
 * page and not in the preview of the note about that page, until something else
 * refreshed the column.
 *
 * Nothing here is written optimistically: the backend is on this machine, and a
 * pin that appeared at a point the server then refused would be a mark the reader
 * believes in and cannot find again.
 */
import type { TagDescription } from "@reduxjs/toolkit/query";
import { baseApi, type TagType } from "./baseApi";
import type {
  Annotation,
  AnnotationWithDocument,
  NewAnnotationInput,
  UpdateAnnotationInput,
} from "../../types/dto";

/** The tags a write makes stale: the pins, and every card preview that paints them. */
const ANNOTATION_WRITE_TAGS: TagDescription<TagType>[] = [
  { type: "Annotation" },
  { type: "Note", id: "LIST" },
  { type: "NoteFolder", id: "LIST" },
];

/** The fields a patch may carry, written onto a cached row in place. */
type AnnotationChanges = Omit<UpdateAnnotationInput, "id" | "documentId">;

function applyAnnotationChanges(
  row: { text: string; page_number: number; x: number; y: number; width: number; font_size: number },
  changes: AnnotationChanges,
): void {
  if (changes.text !== undefined) row.text = changes.text;
  if (changes.page_number !== undefined) row.page_number = changes.page_number;
  if (changes.x !== undefined) row.x = changes.x;
  if (changes.y !== undefined) row.y = changes.y;
  if (changes.width !== undefined) row.width = changes.width;
  if (changes.font_size !== undefined) row.font_size = changes.font_size;
}

export const annotationApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    /** Every pin of one document, oldest first. */
    listDocumentAnnotations: builder.query<Annotation[], number>({
      query: (id) => `/pdf-documents/${id}/annotations`,
      transformResponse: (body: { annotations: Annotation[] }) => body.annotations,
      providesTags: (result, _error, id) => [
        { type: "Annotation", id: "LIST" },
        { type: "Annotation", id: `doc-${id}` },
        ...(result ?? []).map((annotation) => ({ type: "Annotation" as const, id: annotation.id })),
      ],
    }),

    /**
     * One pin, with its document.
     *
     * This is what a markdown reference resolves: the note it was pasted into may
     * be about a different PDF, so the row has to be readable by itself.
     */
    getAnnotation: builder.query<AnnotationWithDocument, number>({
      query: (id) => `/annotations/${id}`,
      providesTags: (_result, _error, id) => [{ type: "Annotation", id }],
    }),

    createAnnotation: builder.mutation<Annotation, { documentId: number } & NewAnnotationInput>({
      query: ({ documentId, ...body }) => ({
        url: `/pdf-documents/${documentId}/annotations`,
        method: "POST",
        body,
      }),
      invalidatesTags: ANNOTATION_WRITE_TAGS,
    }),

    /**
     * Change one pin: retype it, or move it — written to the cache first.
     *
     * One endpoint for both because both are one row and one history step; the body
     * says which by what it carries (`text` for a retype, the page and the point for
     * a move).
     *
     * The write is **optimistic**: the pin is drawn from the cached list, so a drag
     * that waited for the round trip would show the piece snap back and then jump
     * forward again. The two entries that draw a pin are patched before the request
     * leaves — the document's list, and the single row a `[annotation:<id>]` chip
     * resolves — and both are rolled back if the server refuses, leaving the pin
     * where it was. The tag invalidation still refetches on success, so the patch is
     * a bridge to the real row, never the truth.
     */
    updateAnnotation: builder.mutation<Annotation, UpdateAnnotationInput>({
      query: ({ id, documentId: _documentId, ...changes }) => ({
        url: `/annotations/${id}`,
        method: "PATCH",
        body: changes,
      }),
      invalidatesTags: (_result, _error, { id }) => [...ANNOTATION_WRITE_TAGS, { type: "Annotation", id }],
      async onQueryStarted({ id, documentId, ...changes }, { dispatch, queryFulfilled }) {
        const patches = [
          dispatch(
            annotationApi.util.updateQueryData("getAnnotation", id, (draft) => {
              applyAnnotationChanges(draft, changes);
            }),
          ),
        ];
        if (documentId != null) {
          patches.push(
            dispatch(
              annotationApi.util.updateQueryData("listDocumentAnnotations", documentId, (draft) => {
                const row = draft.find((candidate) => candidate.id === id);
                if (row) applyAnnotationChanges(row, changes);
              }),
            ),
          );
        }
        try {
          await queryFulfilled;
        } catch {
          for (const patch of patches) patch.undo();
        }
      },
    }),

    deleteAnnotation: builder.mutation<void, number>({
      query: (id) => ({ url: `/annotations/${id}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, id) => [...ANNOTATION_WRITE_TAGS, { type: "Annotation", id }],
    }),
  }),
});
