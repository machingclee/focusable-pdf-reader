/**
 * The hidden file input the Open control falls back to, and the browser drop
 * target's last step.
 *
 * A PDF can arrive as a path (the desktop dialog, a drop from Finder) or as a
 * `File` object (a drag out of a browser), and only an `<input type="file">` can
 * read the second. It is kept mounted and hidden, so asking for a file is a click
 * on an element that already exists rather than a dialog built on the spot.
 *
 * The value is cleared after every pick: the same file chosen twice in a row
 * fires no `change` event unless the field is empty first.
 */
import type { RefObject } from "react";

export type PdfFileInputProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
};

export function PdfFileInput({ inputRef, onFiles }: PdfFileInputProps) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf"
      multiple
      hidden
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        onFiles(files);
        event.target.value = "";
      }}
    />
  );
}
