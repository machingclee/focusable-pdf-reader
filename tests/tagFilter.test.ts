import { describe, expect, test } from "bun:test";
import { matchesTagFilter } from "../src/tagFilter";

describe("tag search", () => {
  test("an empty query matches every tag", () => {
    expect(matchesTagFilter("Rust", "")).toBe(true);
    expect(matchesTagFilter("Rust", "   ")).toBe(true);
  });

  test("parts must appear in order but not next to each other", () => {
    expect(matchesTagFilter("Event Storming", "event storm")).toBe(true);
    expect(matchesTagFilter("Event Storming", "storm event")).toBe(false);
    expect(matchesTagFilter("Machine Learning", "machine")).toBe(true);
  });

  test("casing and punctuation are not part of the match", () => {
    expect(matchesTagFilter("C++ / Rust", "c++")).toBe(true);
    expect(matchesTagFilter("C++ / Rust", "c++ rust")).toBe(true);
    expect(matchesTagFilter("C++ / Rust", "rust c++")).toBe(false);
  });
});
