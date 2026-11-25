/**
 * Pictures pasted into a note.
 *
 * The remark stores `images/<filename>`, never a machine path. The file itself
 * is written by `save_pasted_image`: `backend/images` in dev, and the app data
 * directory's `images/` folder in a packaged build. Reading it back is
 * `convertFileSrc` inside the webview and a data URL in the HTML export, which
 * the system browser opens and so cannot use the app's asset protocol.
 *
 * Cmd/Ctrl+V is taken over completely: the webview's clipboard API raises a
 * macOS permission dialog, so both the image and the fallback text come from
 * Rust (`read_clipboard_image`, `read_clipboard_text`).
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";

type ClipboardImage = { width: number; height: number; rgba: number[] };

/** Pasted pictures are scaled down to this width before they are stored. */
const MAX_PASTED_WIDTH = 1400;

export type NoteImageRef = {
  /** The `images/…` path, without a `?width=` suffix. */
  cleanPath: string;
  /** Width dragged in the preview, when the remark recorded one. */
  width?: number;
};

/**
 * Split a markdown image src into its file and the width the preview stored.
 *
 * `?width=` is this app's own suffix, written when the picture is dragged. It
 * is not part of the filename.
 */
export function noteImagePath(src: string): NoteImageRef {
  const widthMatch = src.match(/\?width=(\d+)/);
  const parsed = widthMatch ? parseInt(widthMatch[1], 10) : Number.NaN;
  const cleanPath = src.replace(/\?width=\d+$/, "");
  return parsed > 0 ? { cleanPath, width: parsed } : { cleanPath };
}

/**
 * Absolute path of a stored `images/<filename>` reference.
 *
 * Anything that is not a single filename under `images/` — another URL, a
 * nested folder, `..` — is left alone. The export reads this path, and the
 * filesystem scope reaches the whole home directory, so a note must not be
 * able to name a file outside the images folder.
 */
export function noteImageFile(cleanPath: string, imagesDir: string | null): string | null {
  if (!imagesDir || !cleanPath.startsWith("images/")) return null;
  const name = cleanPath.slice("images/".length);
  if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    return null;
  }
  const separator = imagesDir.includes("\\") ? "\\" : "/";
  const base = imagesDir.endsWith("/") || imagesDir.endsWith("\\") ? imagesDir.slice(0, -1) : imagesDir;
  return `${base}${separator}${name}`;
}

/** The src an `<img>` in the webview should use for a note picture. */
export function noteImageSrc(cleanPath: string, imagesDir: string | null): string {
  const file = noteImageFile(cleanPath, imagesDir);
  return file ? convertFileSrc(file) : cleanPath;
}

/**
 * The dragged width of a picture, never larger than the file itself.
 *
 * `naturalWidth` is the image's own pixel width. Until that is known there is
 * no ceiling, only the same 50px floor the drag has always had. A picture
 * smaller than that floor stays at its own size: the floor must not enlarge it.
 */
export function clampImageWidth(width: number, naturalWidth: number | null): number {
  const rounded = Math.round(width);
  const floor = naturalWidth != null && naturalWidth > 0 && naturalWidth < 50 ? naturalWidth : 50;
  const raised = Math.max(floor, rounded);
  if (naturalWidth != null && naturalWidth > 0) return Math.min(naturalWidth, raised);
  return raised;
}

/**
 * Write a dragged width onto one picture's markdown src as `?width=`.
 *
 * `cleanPath` is the src without that suffix. Every copy of the same picture
 * in the note takes the new width; a src that is not this picture is left alone.
 */
export function replaceImageWidth(markdown: string, cleanPath: string, width: number): string {
  const escaped = cleanPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(
    new RegExp(`(!\\[[^\\]]*\\]\\(${escaped})(?:\\?width=\\d+)?(\\))`, "g"),
    `$1?width=${width}$2`,
  );
}

/** Put `text` in place of `[start, end)` and say where the caret then sits. */
export function insertAtSelection(
  value: string,
  start: number,
  end: number,
  text: string,
): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start, end, value.length));
  const to = Math.min(value.length, Math.max(start, end, 0));
  return {
    value: value.slice(0, from) + text + value.slice(to),
    caret: from + text.length,
  };
}

let imagesDirPromise: Promise<string> | null = null;

/** The images directory, remembered after the first successful lookup. */
export function loadImagesDir(): Promise<string | null> {
  if (!imagesDirPromise) {
    const pending = invoke<string>("get_images_dir");
    imagesDirPromise = pending;
    pending.catch(() => {
      if (imagesDirPromise === pending) imagesDirPromise = null;
    });
  }
  return imagesDirPromise.catch(() => null);
}

/** The images directory, once the shell has answered. Null until then, and in a plain browser. */
export function useImagesDir(): string | null {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadImagesDir().then((value) => {
      if (!cancelled) setDir(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return dir;
}

/**
 * The markdown a pasted image becomes, or null when the clipboard has no image.
 *
 * The picture is drawn down to 1400px wide and stored as a PNG.
 * The returned text is what the editor inserts: `![pasted image](images/<file>)`.
 */
export async function pastedImageMarkdown(): Promise<string | null> {
  const image = await invoke<ClipboardImage | null>("read_clipboard_image").catch(() => null);
  if (!image || image.width === 0 || image.height === 0) return null;
  const expected = image.width * image.height * 4;
  if (image.rgba.length !== expected) return null;

  const scale = image.width > MAX_PASTED_WIDTH ? MAX_PASTED_WIDTH / image.width : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) return null;
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (!outputContext) return null;
  outputContext.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
  if (!blob) return null;
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  const filename = await invoke<string>("save_pasted_image", { data: bytes });
  return `![pasted image](images/${filename})`;
}

/**
 * What Cmd/Ctrl+V should insert into a note.
 *
 * An image wins. Otherwise the clipboard's text, so taking the key away from
 * the editor does not drop an ordinary paste. Null when the clipboard holds
 * neither, or the read failed.
 */
export async function pasteInsertion(): Promise<string | null> {
  try {
    const image = await pastedImageMarkdown();
    if (image) return image;
  } catch {
    return null;
  }
  return invoke<string | null>("read_clipboard_text").catch(() => null);
}

/**
 * Swap stored `images/…` srcs for data URLs.
 *
 * `dataUrls` is keyed by the src as the HTML wrote it, query string included.
 * A width that was stored on the src is kept as an attribute, because a data
 * URL has nowhere to put `?width=`. Srcs with no entry are left as they are.
 */
export function replaceImageSrcs(html: string, dataUrls: ReadonlyMap<string, string>): string {
  return html.replace(/src="(images\/[^"]+)"/g, (match, src: string) => {
    const data = dataUrls.get(src);
    if (!data) return match;
    const width = noteImagePath(src).width;
    return width ? `src="${data}" width="${width}"` : `src="${data}"`;
  });
}

/**
 * Inline every pasted picture in an exported notes file.
 *
 * The export is opened by the system browser, which cannot load `asset://`
 * URLs or the app's images folder. A file that cannot be read stays as the
 * original src.
 */
export async function inlineNoteImages(html: string): Promise<string> {
  if (!html.includes('src="images/')) return html;
  const dir = await loadImagesDir();
  if (!dir) return html;

  const sources = new Set<string>();
  for (const match of html.matchAll(/src="(images\/[^"]+)"/g)) sources.add(match[1]);

  const dataUrls = new Map<string, string>();
  for (const src of sources) {
    const file = noteImageFile(noteImagePath(src).cleanPath, dir);
    if (!file) continue;
    try {
      const bytes = await readFile(file);
      dataUrls.set(src, `data:image/png;base64,${bytesToBase64(bytes)}`);
    } catch {
      // One missing picture is not a reason to drop the note around it.
    }
  }
  return replaceImageSrcs(html, dataUrls);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
