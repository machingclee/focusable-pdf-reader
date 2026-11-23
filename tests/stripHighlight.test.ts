import { describe, expect, test } from "bun:test";
import {
  brushPreviewBox,
  brushStep,
  clampBrush,
  currentBrush,
  HIGHLIGHT_FILL,
  fillMergedHighlights,
  highlightBox,
  highlightSessionId,
  highlightSessionKey,
  markAtPoint,
  paintHighlightsOnPage,
  horizontalMark,
  layoutPoint,
  parseHighlights,
  pointOnBand,
  releaseHighlightSession,
  serializeHighlights,
  setHighlightSession,
  subscribeHighlightSession,
} from "../src/stripHighlight";

const band = { top: 100, page_width: 200 };

describe("parseHighlights", () => {
  test("reads a list of strokes and drops a row that is not one", () => {
    const raw = JSON.stringify([
      { x0: 10, x1: 40, y: 12, size: 8 },
      { x0: 1, x1: 2, y: 3 },
      null,
      { x0: 0, x1: 5, y: 6, size: 0 },
    ]);
    expect(parseHighlights(raw)).toEqual([{ x0: 10, x1: 40, y: 12, size: 8 }]);
  });

  test("an empty or broken column is no marks", () => {
    expect(parseHighlights("[]")).toEqual([]);
    expect(parseHighlights("")).toEqual([]);
    expect(parseHighlights(undefined)).toEqual([]);
    expect(parseHighlights("{")).toEqual([]);
  });
});

describe("serializeHighlights", () => {
  test("rounds to hundredths of a point", () => {
    expect(serializeHighlights([{ x0: 1.234, x1: 8.001, y: 3.456, size: 14.444 }])).toBe(
      JSON.stringify([{ x0: 1.23, x1: 8, y: 3.46, size: 14.44 }]),
    );
  });
});

describe("highlightBox", () => {
  test("places the stroke on the band, with y as its top edge", () => {
    // 100 CSS px across a 200 pt page is half a pixel per point.
    expect(highlightBox({ x0: 10, x1: 50, y: 110, size: 8 }, band, 100)).toEqual({
      left: 5,
      top: 5,
      width: 20,
      height: 4,
    });
  });

  test("a stroke drawn right to left still starts at the left edge", () => {
    const box = highlightBox({ x0: 50, x1: 10, y: 110, size: 8 }, band, 100);
    expect(box).toMatchObject({ left: 5, width: 20 });
  });
});

describe("horizontalMark", () => {
  test("the release sets the end and leaves the line where the drag started", () => {
    expect(horizontalMark({ x: 10, y: 40 }, 80, 14)).toEqual({ x0: 10, x1: 80, y: 40, size: 14 });
  });

  test("a drag that did not travel is not a mark", () => {
    expect(horizontalMark({ x: 10, y: 40 }, 10.4, 14)).toBeNull();
  });
});

describe("brushPreviewBox", () => {
  test("before the drag the pointer is the top-left of a thin stub", () => {
    const box = brushPreviewBox(40, 20, null, 6, 100, 1);
    expect(box.left).toBe(40);
    expect(box.top).toBe(20);
    expect(box.height).toBe(6);
    expect(box.width).toBeGreaterThan(0);
  });

  test("during the drag the swatch keeps that top edge and follows x", () => {
    const box = brushPreviewBox(80, 200, { x: 10, y: 110 }, 8, 100, 0.5);
    expect(box).toEqual({ left: 5, top: 5, width: 75, height: 4 });
  });

  test("the cursor is the brush in points, so it thickens with the page", () => {
    expect(brushPreviewBox(40, 20, null, 6, 100, 1).height).toBe(6);
    expect(brushPreviewBox(40, 20, null, 6, 100, 2).height).toBe(12);
  });
});

describe("markAtPoint", () => {
  const marks = [
    { x0: 10, x1: 40, y: 20, size: 8 },
    { x0: 30, x1: 70, y: 20, size: 8 },
  ];

  test("a point inside a stroke is on it", () => {
    expect(markAtPoint(marks, { x: 15, y: 24 })).toBe(0);
  });

  test("where two strokes overlap the newer one is the one on top", () => {
    expect(markAtPoint(marks, { x: 35, y: 24 })).toBe(1);
  });

  test("bare paper is no mark", () => {
    expect(markAtPoint(marks, { x: 5, y: 24 })).toBeNull();
    expect(markAtPoint(marks, { x: 35, y: 60 })).toBeNull();
    expect(markAtPoint([], { x: 15, y: 24 })).toBeNull();
  });

  test("slack widens the box, so a press just beside the yellow still lands", () => {
    expect(markAtPoint(marks, { x: 75, y: 24 })).toBeNull();
    expect(markAtPoint(marks, { x: 75, y: 24 }, 6)).toBe(1);
    expect(markAtPoint(marks, { x: 35, y: 15 })).toBeNull();
    expect(markAtPoint(marks, { x: 35, y: 15 }, 6)).toBe(1);
  });

  test("a stroke drawn right to left still answers at both ends", () => {
    expect(markAtPoint([{ x0: 60, x1: 30, y: 10, size: 6 }], { x: 31, y: 12 })).toBe(0);
    expect(markAtPoint([{ x0: 60, x1: 30, y: 10, size: 6 }], { x: 59, y: 12 })).toBe(0);
  });
});

describe("layoutPoint", () => {
  test("a click on a swelled page is put back into the unscaled page", () => {
    const point = layoutPoint(110, 30, { left: 10, top: 10, width: 105, height: 52.5 }, 100, 50);
    expect(point.x).toBeCloseTo((100 / 105) * 100);
    expect(point.y).toBeCloseTo((20 / 52.5) * 50);
  });
});

describe("pointOnBand", () => {
  test("layout pixels become page points under the band", () => {
    expect(pointOnBand(5, 3, 100, 0.5)).toEqual({ x: 10, y: 106 });
  });
});

describe("highlightSessionKey", () => {
  test("with no preview armed, brackets and Escape are left alone", () => {
    releaseHighlightSession(1);
    expect(highlightSessionKey(key("]"))).toBe(false);
    expect(highlightSessionKey(key("Escape"))).toBe(false);
  });

  test("[ and ] move the brush, and Escape is the preview's", () => {
    const brushes: number[] = [];
    let escaped = 0;
    setHighlightSession({
      id: 7,
      onBrush: (size) => brushes.push(size),
      onEscape: () => {
        escaped += 1;
      },
      onClose: () => undefined,
    });

    const start = currentBrush();
    expect(highlightSessionKey(key("]"))).toBe(true);
    expect(highlightSessionKey({ ...key("["), shiftKey: true, code: "BracketLeft" })).toBe(true);
    expect(highlightSessionKey(key("Escape"))).toBe(true);
    expect(brushes[0]).toBe(clampBrush(start + brushStep(key("]"))));
    expect(brushes[1]).toBe(clampBrush(brushes[0]! - brushStep({ ...key("["), shiftKey: true })));
    expect(escaped).toBe(1);
    expect(currentBrush()).toBe(brushes[1]);

    releaseHighlightSession(7);
  });

  test("the armed id is the only pen, and it clears when that pen is put down", () => {
    const seen: Array<number | null> = [];
    const stop = subscribeHighlightSession(() => seen.push(highlightSessionId()));
    expect(highlightSessionId()).toBeNull();
    setHighlightSession({ id: 4, onBrush: () => undefined, onEscape: () => undefined, onClose: () => undefined });
    expect(highlightSessionId()).toBe(4);
    setHighlightSession({ id: -4, onBrush: () => undefined, onEscape: () => undefined, onClose: () => undefined });
    expect(highlightSessionId()).toBe(-4);
    releaseHighlightSession(-4);
    expect(highlightSessionId()).toBeNull();
    expect(seen).toEqual([4, -4, null]);
    stop();
  });

  test("arming a second preview closes the first", () => {
    let closed = 0;
    setHighlightSession({ id: 1, onBrush: () => undefined, onEscape: () => undefined, onClose: () => { closed += 1; } });
    setHighlightSession({ id: 2, onBrush: () => undefined, onEscape: () => undefined, onClose: () => undefined });
    expect(closed).toBe(1);
    releaseHighlightSession(1);
    expect(highlightSessionKey(key("]"))).toBe(true);
    releaseHighlightSession(2);
    expect(highlightSessionKey(key("]"))).toBe(false);
  });
});

describe("merged highlights", () => {
  test("every stroke is the same opaque yellow, so a crossing is not a second coat", () => {
    const painted: string[] = [];
    const context = {
      fillStyle: "",
      fillRect(x: number, y: number, width: number, height: number) {
        painted.push(`${this.fillStyle} ${x},${y} ${width}x${height}`);
      },
    };
    fillMergedHighlights(context as CanvasRenderingContext2D, [
      { left: 0, top: 0, width: 20, height: 4 },
      { left: 10, top: 0, width: 20, height: 4 },
    ]);
    expect(painted).toEqual([`${HIGHLIGHT_FILL} 0,0 20x4`, `${HIGHLIGHT_FILL} 10,0 20x4`]);
  });

  test("the page receives that yellow once, in canvas pixels", () => {
    const log: string[] = [];
    const layer = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: "",
        fillRect() {
          log.push("fill");
        },
      }),
    };
    const page = {
      width: 100,
      height: 40,
      getContext: () => ({
        globalAlpha: 1,
        globalCompositeOperation: "multiply",
        save() {
          log.push("save");
        },
        restore() {
          log.push("restore");
        },
        setTransform() {
          log.push("identity");
        },
        drawImage() {
          log.push(`draw ${this.globalAlpha} ${this.globalCompositeOperation}`);
        },
      }),
    };
    const previous = globalThis.document;
    globalThis.document = { createElement: () => layer } as unknown as Document;
    try {
      paintHighlightsOnPage(
        page as unknown as HTMLCanvasElement,
        [{ x0: 10, x1: 50, y: 110, size: 8 }],
        band,
      );
    } finally {
      globalThis.document = previous;
    }
    expect(log).toEqual(["fill", "save", "identity", "draw 1 multiply", "restore"]);
  });
});

function key(name: string) {
  const bracket = name === "[" || name === "]";
  return {
    key: name,
    code: name === "]" ? "BracketRight" : name === "[" ? "BracketLeft" : name,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...(bracket ? {} : {}),
  };
}
