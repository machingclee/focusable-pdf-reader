import { describe, expect, test } from "bun:test";
import {
  forgetPointerSpot,
  installPointerSpot,
  pointerSpot,
  rememberPointerSpot,
} from "../src/pointerSpot";

describe("pointerSpot", () => {
  test("no pointer seen yet is no position", () => {
    forgetPointerSpot();
    expect(pointerSpot()).toBeNull();
  });

  test("the last move is the one H measures", () => {
    rememberPointerSpot(120, 240);
    expect(pointerSpot()).toEqual({ x: 120, y: 240 });
    rememberPointerSpot(300, 480);
    expect(pointerSpot()).toEqual({ x: 300, y: 480 });
  });

  test("a pointer that left the document is no position again", () => {
    rememberPointerSpot(120, 240);
    forgetPointerSpot();
    expect(pointerSpot()).toBeNull();
  });
});

describe("installPointerSpot", () => {
  test("without a window it listens to nothing and still stops cleanly", () => {
    expect(typeof window).toBe("undefined");
    const stop = installPointerSpot();
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });
});
