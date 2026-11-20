import { describe, expect, test } from "bun:test";
import { formatSavedAt, noteSummary } from "../src/notesText";

describe("noteSummary", () => {
  test("drops markdown syntax and keeps the words", () => {
    expect(noteSummary("## Reading note\n\nThe *strip* sits over the `intro`.")).toBe(
      "Reading note The strip sits over the intro.",
    );
  });

  test("drops list markers, task boxes and quotes", () => {
    expect(noteSummary("- [ ] revisit\n- [x] skim\n> quoted")).toBe("revisit skim quoted");
  });

  test("keeps link text, drops images and table pipes", () => {
    expect(noteSummary("![shot](a.png) see [the spec](x.md)\n| a | b |\n| --- | --- |")).toBe(
      "see the spec a b",
    );
  });

  test("skips fences and display-math delimiters", () => {
    expect(noteSummary("```ts\nconst a = 1;\n```\n$$\nx = 1\n$$")).toBe("const a = 1; x = 1");
  });

  test("collapses whitespace and truncates with an ellipsis", () => {
    expect(noteSummary("one   two\n\nthree")).toBe("one two three");
    const long = "word ".repeat(80);
    const summary = noteSummary(long, 20);
    expect(summary.length).toBeLessThanOrEqual(21);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("returns an empty label for an empty note", () => {
    expect(noteSummary("")).toBe("");
    expect(noteSummary("\n\n```\ncode\n```\n")).toBe("code");
  });
});

describe("formatSavedAt", () => {
  // Fixed reference: Friday 2026-11-20, 15:00 local.
  const now = new Date(2026, 10, 20, 15, 0, 0).getTime();
  const at = (year: number, month: number, day: number, hour = 9, minute = 5) =>
    new Date(year, month - 1, day, hour, minute, 0).getTime();

  test("shows the time of day for today", () => {
    expect(formatSavedAt(at(2026, 11, 20, 9, 5), now)).toStartWith("Today ");
  });

  test("says yesterday for the previous day", () => {
    expect(formatSavedAt(at(2026, 11, 19, 22, 0), now)).toStartWith("Yesterday ");
  });

  test("uses the weekday inside the last week", () => {
    expect(formatSavedAt(at(2026, 11, 17), now)).toBe(
      new Date(2026, 10, 17).toLocaleDateString(undefined, { weekday: "long" }),
    );
  });

  test("falls back to the date, with the year once it is another year", () => {
    const older = at(2026, 9, 2);
    expect(formatSavedAt(older, now)).toBe(
      new Date(2026, 8, 2).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    const lastYear = at(2025, 12, 31);
    expect(formatSavedAt(lastYear, now)).toContain("2025");
  });
});
