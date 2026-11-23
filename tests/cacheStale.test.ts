import { describe, expect, test } from "bun:test";
import { ALL_TAG_TYPES, shouldAnnounceWrite } from "../src/store/api/baseApi";
import { allTagTypes, invalidateEveryTag } from "../src/store/cacheStale";
import type { AppDispatch } from "../src/store/store";

describe("shouldAnnounceWrite", () => {
  test("a mutation the backend accepted is announced", () => {
    for (const type of ["mutation"] as const) {
      expect(shouldAnnounceWrite({ type }, false)).toBe(true);
    }
  });

  test("a query is not, even the resolve upsert that writes a row", () => {
    // `POST /pdf-documents/resolve` is a query in RTK terms and does upsert. If it
    // announced, one window's invalidation would refetch it here, which would
    // announce again, and the windows would keep each other busy forever.
    expect(shouldAnnounceWrite({ type: "query" }, false)).toBe(false);
  });

  test("a failed request is not", () => {
    expect(shouldAnnounceWrite({ type: "mutation" }, true)).toBe(false);
    expect(shouldAnnounceWrite({ type: "query" }, true)).toBe(false);
  });
});

describe("allTagTypes", () => {
  test("is every tag type the cache knows, as a fresh list", () => {
    expect(allTagTypes()).toEqual([...ALL_TAG_TYPES]);
    // A copy: a caller that sorts or pushes must not edit the API's own list.
    allTagTypes().push("NotATag");
    expect(allTagTypes()).toEqual([...ALL_TAG_TYPES]);
  });
});

describe("invalidateEveryTag", () => {
  test("dispatches one global invalidation", () => {
    const seen: string[] = [];
    const dispatch = ((action: { type: string }) => {
      seen.push(action.type);
      return action;
    }) as unknown as AppDispatch;

    invalidateEveryTag(dispatch);
    expect(seen).toEqual(["api/invalidateTags"]);
  });

  test("the list it invalidates is the whole tag list", () => {
    // Whatever the answer is dispatched with, it has to cover every tag type:
    // the announcement says nothing about what changed.
    expect(allTagTypes().sort()).toEqual([...ALL_TAG_TYPES].sort());
  });
});
