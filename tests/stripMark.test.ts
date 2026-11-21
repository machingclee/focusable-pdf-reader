import { describe, expect, test } from "bun:test";
import { restartClassAnimation } from "../src/stripMark";

/**
 * A stand-in for the card element: it records what was done to it, in order, so the
 * one thing that matters — the layout read sitting between the remove and the add —
 * can be asserted rather than assumed.
 */
function fakeNode(classes: string[] = []) {
  const calls: string[] = [];
  let widthReads = 0;
  const node = {
    classList: {
      remove(token: string) {
        calls.push(`remove:${token}`);
        const at = classes.indexOf(token);
        if (at !== -1) classes.splice(at, 1);
      },
      add(token: string) {
        calls.push(`add:${token}`);
        if (!classes.includes(token)) classes.push(token);
      },
    },
    get offsetWidth() {
      calls.push("read:offsetWidth");
      widthReads += 1;
      return 320;
    },
  };
  return { node, calls, classes, widthReads: () => widthReads };
}

describe("restartClassAnimation", () => {
  test("the layout read happens between the remove and the add", () => {
    const { node, calls, classes } = fakeNode(["animate-mark"]);

    restartClassAnimation(node, "animate-mark");

    expect(calls).toEqual(["remove:animate-mark", "read:offsetWidth", "add:animate-mark"]);
    // It is still on the card afterwards: the mark is the state, this only restarts it.
    expect(classes).toEqual(["animate-mark"]);
  });

  test("the read is for its side effect: the width is thrown away", () => {
    const { node, widthReads } = fakeNode([]);

    restartClassAnimation(node, "animate-mark");

    expect(widthReads()).toBe(1);
  });

  test("a card that was not marked ends up marked", () => {
    const { node, classes } = fakeNode([]);

    restartClassAnimation(node, "animate-mark");

    expect(classes).toEqual(["animate-mark"]);
  });

  test("only the named class is touched", () => {
    const { node, classes } = fakeNode(["notes-card", "is-selected", "animate-mark"]);

    restartClassAnimation(node, "animate-mark");

    expect(classes).toEqual(["notes-card", "is-selected", "animate-mark"]);
  });
});
