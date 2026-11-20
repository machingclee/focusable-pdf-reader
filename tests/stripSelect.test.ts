import { describe, expect, test } from "bun:test";
import { MIN_SELECT_PX, stripSelectBand } from "../src/stripSelect";

const base = {
  startY: 300,
  currentY: 300,
  stageHeight: 1000,
  zoom: 1,
  minHeightPt: 10,
  maxHeightPt: 640,
};

describe("stripSelectBand", () => {
  test("dragging down makes the area between the press and the pointer", () => {
    const band = stripSelectBand({ ...base, currentY: 420 });
    expect(band.top).toBe(300);
    expect(band.height).toBe(120);
    expect(band.heightPt).toBe(120);
    expect(band.chosen).toBe(true);
  });

  test("dragging up makes the same area, with the press as the bottom edge", () => {
    // The band has no direction: up and down both describe a slice of the page.
    const down = stripSelectBand({ ...base, currentY: 420 });
    const up = stripSelectBand({ ...base, startY: 420, currentY: 300 });
    expect(up).toEqual({ ...down });
  });

  test("a press that never travelled chose nothing", () => {
    expect(stripSelectBand(base).chosen).toBe(false);
    // A couple of pixels is hand shake, not a strip — and it must not become the
    // minimum height either.
    const shake = stripSelectBand({ ...base, currentY: 300 + MIN_SELECT_PX - 1 });
    expect(shake.chosen).toBe(false);
    expect(stripSelectBand({ ...base, currentY: 300 + MIN_SELECT_PX }).chosen).toBe(true);
  });

  test("the area stops at the strip's maximum and the press edge stays put", () => {
    // 680px of travel cannot be a 680pt strip; the press edge must not jump.
    const band = stripSelectBand({ ...base, currentY: 980 });
    expect(band.height).toBe(640);
    expect(band.top).toBe(300);
    expect(band.heightPt).toBe(640);
  });

  test("an upward drag past the maximum keeps the press edge put too", () => {
    const band = stripSelectBand({ ...base, startY: 900, currentY: 100 });
    expect(band.height).toBe(640);
    expect(band.top).toBe(260);
    expect(band.heightPt).toBe(640);
  });

  test("the area cannot leave the stage", () => {
    // Released above the stage: the top edge is the stage's own, not negative.
    const band = stripSelectBand({ ...base, startY: 20, currentY: -50 });
    expect(band.top).toBe(0);
    expect(band.height).toBe(20);

    // Pressed below the stage: the bottom edge is the stage's bottom.
    const below = stripSelectBand({ ...base, startY: 980, currentY: 1200 });
    expect(below.top).toBe(980);
    expect(below.height).toBe(20);
  });

  test("points are the pixels over the zoom, so the same area covers the same slice", () => {
    // 200 px at 200% zoom is 100 pt of page; at 50% it is 400 pt.
    expect(stripSelectBand({ ...base, currentY: 500, zoom: 2 }).heightPt).toBe(100);
    expect(stripSelectBand({ ...base, currentY: 500, zoom: 0.5 }).heightPt).toBe(400);
    // The marquee itself stays in screen pixels at every zoom.
    expect(stripSelectBand({ ...base, currentY: 500, zoom: 2 }).height).toBe(200);
  });

  test("a tiny area still becomes the strip's minimum height", () => {
    // 12px at 200% is 6pt, under MIN_STRIP: the band keeps its own floor, while
    // the marquee shows what was actually dragged.
    const band = stripSelectBand({ ...base, currentY: 312, zoom: 2 });
    expect(band.height).toBe(12);
    expect(band.heightPt).toBe(10);
    expect(band.chosen).toBe(true);
  });

  test("a stage with no height, or a nonsense zoom, cannot produce NaN", () => {
    // A stage with no height has no travel to measure, so nothing is chosen.
    const flat = stripSelectBand({ ...base, stageHeight: 0, currentY: 200 });
    expect(flat).toEqual({ top: 0, height: 0, heightPt: 10, chosen: false });

    const broken = stripSelectBand({ ...base, currentY: 400, zoom: 0, stageHeight: Number.NaN });
    expect(Number.isFinite(broken.top)).toBe(true);
    expect(Number.isFinite(broken.height)).toBe(true);
    expect(Number.isFinite(broken.heightPt)).toBe(true);
  });
});
