import { describe, expect, test } from "bun:test";
import { renderNoteMarkdown } from "../src/notesHtml";
import {
  clampImageWidth,
  insertAtSelection,
  noteImageFile,
  noteImagePath,
  replaceImageSrcs,
  replaceImageWidth,
} from "../src/markdown/noteImages";

describe("noteImagePath", () => {
  test("keeps a plain images path and drops a stored width", () => {
    expect(noteImagePath("images/image-1.png")).toEqual({ cleanPath: "images/image-1.png" });
    expect(noteImagePath("images/image-1.png?width=320")).toEqual({
      cleanPath: "images/image-1.png",
      width: 320,
    });
  });

  test("leaves an ordinary URL untouched", () => {
    expect(noteImagePath("https://example.com/a.png")).toEqual({
      cleanPath: "https://example.com/a.png",
    });
  });
});

describe("noteImageFile", () => {
  test("joins a filename onto the images directory", () => {
    expect(noteImageFile("images/image-1.png", "/data/images")).toBe("/data/images/image-1.png");
    expect(noteImageFile("images/image-1.png", "C:\\data\\images")).toBe("C:\\data\\images\\image-1.png");
  });

  test("refuses anything that is not one file in that directory", () => {
    expect(noteImageFile("images/../secret", "/data/images")).toBeNull();
    expect(noteImageFile("images/nested/a.png", "/data/images")).toBeNull();
    expect(noteImageFile("https://example.com/a.png", "/data/images")).toBeNull();
    expect(noteImageFile("images/image-1.png", null)).toBeNull();
  });
});

describe("clampImageWidth", () => {
  test("stops at the image's own width", () => {
    expect(clampImageWidth(2000, 800)).toBe(800);
    expect(clampImageWidth(400, 800)).toBe(400);
  });

  test("does not enlarge a picture smaller than the floor", () => {
    expect(clampImageWidth(10, 30)).toBe(30);
    expect(clampImageWidth(100, 30)).toBe(30);
  });

  test("uses the floor until the image's size is known", () => {
    expect(clampImageWidth(10, null)).toBe(50);
    expect(clampImageWidth(120, null)).toBe(120);
  });
});

describe("replaceImageWidth", () => {
  test("writes the dragged width onto the matching picture", () => {
    const markdown = "before\n\n![pasted image](images/image-1.png)\n\nafter";
    expect(replaceImageWidth(markdown, "images/image-1.png", 240)).toBe(
      "before\n\n![pasted image](images/image-1.png?width=240)\n\nafter",
    );
    expect(replaceImageWidth(replaceImageWidth(markdown, "images/image-1.png", 240), "images/image-1.png", 180)).toBe(
      "before\n\n![pasted image](images/image-1.png?width=180)\n\nafter",
    );
  });
});

describe("insertAtSelection", () => {
  test("replaces the selection and parks the caret after the insertion", () => {
    expect(insertAtSelection("abcdef", 2, 4, "X")).toEqual({ value: "abXef", caret: 3 });
    expect(insertAtSelection("abcdef", 6, 6, "!")).toEqual({ value: "abcdef!", caret: 7 });
  });
});

describe("replaceImageSrcs", () => {
  test("inlines a pasted picture and keeps its width", () => {
    const html = renderNoteMarkdown("![pasted image](images/image-1.png?width=320)");
    const next = replaceImageSrcs(
      html,
      new Map([["images/image-1.png?width=320", "data:image/png;base64,QQ=="]]),
    );
    expect(next).toContain('src="data:image/png;base64,QQ=="');
    expect(next).toContain('width="320"');
    expect(next).not.toContain("images/image-1.png");
  });

  test("leaves a src that has no file", () => {
    const html = '<img src="images/missing.png" alt="pasted image">';
    expect(replaceImageSrcs(html, new Map())).toBe(html);
  });
});
