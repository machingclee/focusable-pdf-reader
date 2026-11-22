import { describe, expect, test } from "bun:test";
import { deletedOpenDocument } from "../src/deletedOpenDocument";

const survivor = {
  file_path: "/library/probability.pdf",
  name: "probability",
};
const other = {
  file_path: "/library/other.pdf",
  name: "other",
};

describe("deletedOpenDocument", () => {
  test("a document that is not on screen changes nothing", () => {
    expect(deletedOpenDocument("/library/probability.pdf", "/library/gone.pdf", [survivor])).toEqual({
      action: "leave",
    });
  });

  test("the one document still in the library is the path to open", () => {
    expect(deletedOpenDocument("/library/gone.pdf", "/library/gone.pdf", [survivor])).toEqual({
      action: "open",
      file_path: survivor.file_path,
      name: survivor.name,
    });
  });

  test("several documents left rechecks the path that was deleted", () => {
    expect(deletedOpenDocument("/library/gone.pdf", "/library/gone.pdf", [survivor, other])).toEqual({
      action: "recheck",
      file_path: "/library/gone.pdf",
    });
  });

  test("an empty library rechecks the path that was deleted", () => {
    expect(deletedOpenDocument("/library/gone.pdf", "/library/gone.pdf", [])).toEqual({
      action: "recheck",
      file_path: "/library/gone.pdf",
    });
  });
});
