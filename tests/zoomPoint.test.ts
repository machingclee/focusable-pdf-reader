import { describe, expect, test } from "bun:test";
import { isInsideArea, reportedPoint, zoomPointFor } from "../src/zoomPoint";

const area = { left: 180, top: 90, width: 1500, height: 900 };

describe("reportedPoint", () => {
  test("a position the event really has is the point", () => {
    expect(reportedPoint(1200, 640)).toEqual({ x: 1200, y: 640 });
  });

  test("no position at all is no point", () => {
    expect(reportedPoint(undefined, undefined)).toBeNull();
    expect(reportedPoint(1200, undefined)).toBeNull();
    expect(reportedPoint(null, null)).toBeNull();
  });

  test("numbers that are not positions are no point", () => {
    expect(reportedPoint(Number.NaN, 640)).toBeNull();
    expect(reportedPoint(1200, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("zeros are how a webview says it has no position", () => {
    // The page area never reaches the screen's top-left corner, so a wheel event
    // reporting `0, 0` is the placeholder, not the corner. Anchoring there would
    // drag the view to the document's first page.
    expect(reportedPoint(0, 0)).toBeNull();
    // One zero on its own is a real edge, and is kept.
    expect(reportedPoint(0, 640)).toEqual({ x: 0, y: 640 });
    expect(reportedPoint(1200, 0)).toEqual({ x: 1200, y: 0 });
  });
});

describe("isInsideArea", () => {
  test("inside is inside, and the edges count", () => {
    expect(isInsideArea(area, { x: 900, y: 500 })).toBe(true);
    expect(isInsideArea(area, { x: area.left, y: area.top })).toBe(true);
    expect(isInsideArea(area, { x: area.left + area.width, y: area.top + area.height })).toBe(true);
  });

  test("past an edge is out", () => {
    expect(isInsideArea(area, { x: area.left - 1, y: 500 })).toBe(false);
    expect(isInsideArea(area, { x: area.left + area.width + 1, y: 500 })).toBe(false);
    expect(isInsideArea(area, { x: 900, y: area.top - 1 })).toBe(false);
    expect(isInsideArea(area, { x: 900, y: area.top + area.height + 1 })).toBe(false);
  });
});

describe("zoomPointFor", () => {
  const pointer = { x: 700, y: 400 };

  test("a wheel's own point is the pointer's, and is used as it stands", () => {
    const wheelPoint = { x: 1400, y: 500 };
    expect(
      zoomPointFor({ kind: "wheel", eventPoint: wheelPoint, pointer, pinch: false, area }),
    ).toEqual(wheelPoint);
  });

  test("a wheel with no point of its own falls back to the pointer", () => {
    expect(
      zoomPointFor({ kind: "wheel", eventPoint: null, pointer, pinch: false, area }),
    ).toEqual(pointer);
  });

  test("a ⌘ + wheel gesture is anchored on the pointer, not its own centre", () => {
    // `⌘` + wheel reaches the viewer as a zoom gesture whose coordinates are the
    // middle of the view. The reader is pointing at the page, so that is what the
    // zoom must hold: reading the gesture's own centre is what made the document
    // scale around the page's middle and slide out from under the cursor.
    const gestureCentre = { x: area.left + area.width / 2, y: area.top + area.height / 2 };
    expect(
      zoomPointFor({ kind: "gesture", eventPoint: gestureCentre, pointer, pinch: false, area }),
    ).toEqual(pointer);
  });

  test("a pinch keeps its own point: that is where the fingers are", () => {
    const fingers = { x: 1400, y: 700 };
    expect(
      zoomPointFor({ kind: "gesture", eventPoint: fingers, pointer, pinch: true, area }),
    ).toEqual(fingers);
    // The wheel form of the same gesture is the one the webview sends for a pinch.
    expect(
      zoomPointFor({ kind: "wheel", eventPoint: fingers, pointer, pinch: true, area }),
    ).toEqual(fingers);
  });

  test("a pinch with no point of its own still follows the pointer", () => {
    expect(
      zoomPointFor({ kind: "gesture", eventPoint: null, pointer, pinch: true, area }),
    ).toEqual(pointer);
  });

  test("a pointer that left the page area does not anchor the zoom", () => {
    // Left over the notes column or the thumbnails, the pointer says nothing about
    // where the page is; the event's own point is the better answer.
    const away = { x: area.left - 200, y: 400 };
    const event = { x: 1000, y: 600 };
    expect(
      zoomPointFor({ kind: "gesture", eventPoint: event, pointer: away, pinch: false, area }),
    ).toEqual(event);
  });

  test("with no pointer, the event's own point is used", () => {
    const event = { x: 1000, y: 600 };
    expect(
      zoomPointFor({ kind: "gesture", eventPoint: event, pointer: null, pinch: false, area }),
    ).toEqual(event);
  });

  test("with neither, the middle of the page area", () => {
    expect(
      zoomPointFor({ kind: "gesture", eventPoint: null, pointer: null, pinch: false, area }),
    ).toEqual({ x: area.left + area.width / 2, y: area.top + area.height / 2 });
  });
});
