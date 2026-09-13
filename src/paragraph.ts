export type TextBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ParagraphBox = {
  /** Page-local top in PDF points (1pt = 1 CSS px at 100% zoom). */
  top: number;
  /** Height in PDF points, already padded and clamped. */
  height: number;
};

type TextLine = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  boxes: TextBox[];
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function lineWidth(line: TextLine): number {
  return Math.max(0, line.right - line.left);
}

function clusterLines(boxes: TextBox[]): TextLine[] {
  const items = boxes.filter((box) => box.width > 0 && box.height > 0);
  items.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: TextLine[] = [];

  for (const box of items) {
    const bottom = box.top + box.height;
    let matched: TextLine | undefined;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line) continue;
      const overlap = Math.min(line.bottom, bottom) - Math.max(line.top, box.top);
      const minH = Math.min(line.bottom - line.top, box.height);
      if (minH > 0 && overlap > minH * 0.4) {
        matched = line;
        break;
      }
      if (line.bottom < box.top - minH) break;
    }
    if (!matched) {
      matched = {
        top: box.top,
        bottom,
        left: box.left,
        right: box.left + box.width,
        boxes: [],
      };
      lines.push(matched);
    }
    matched.boxes.push(box);
    matched.top = Math.min(matched.top, box.top);
    matched.bottom = Math.max(matched.bottom, bottom);
    matched.left = Math.min(matched.left, box.left);
    matched.right = Math.max(matched.right, box.left + box.width);
  }

  lines.sort((a, b) => a.top - b.top);
  return lines;
}

function clusterHorizontally(boxes: TextBox[]): TextBox[][] {
  const sorted = [...boxes].sort((a, b) => a.left - b.left);
  if (sorted.length === 0) return [];
  const medH = median(sorted.map((box) => box.height)) || 12;
  const gapBreak = Math.max(18, medH * 1.8);
  const clusters: TextBox[][] = [];
  let current: TextBox[] = [];
  let right = Number.NEGATIVE_INFINITY;

  for (const box of sorted) {
    if (current.length > 0 && box.left - right > gapBreak) {
      clusters.push(current);
      current = [];
    }
    current.push(box);
    right = Math.max(right, box.left + box.width);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function columnBounds(line: TextLine, x: number): { left: number; right: number } {
  const clusters = clusterHorizontally(line.boxes);
  let best = clusters[0] ?? line.boxes;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cluster of clusters) {
    const left = Math.min(...cluster.map((box) => box.left));
    const right = Math.max(...cluster.map((box) => box.left + box.width));
    const dist = x < left ? left - x : x > right ? x - right : 0;
    if (dist < bestDist) {
      best = cluster;
      bestDist = dist;
    }
  }
  return {
    left: Math.min(...best.map((box) => box.left)),
    right: Math.max(...best.map((box) => box.left + box.width)),
  };
}

function columnAround(lines: TextLine[], seedIndex: number, x: number): { left: number; right: number } {
  const from = Math.max(0, seedIndex - 8);
  const window = lines.slice(from, seedIndex + 9);
  const ranges = window.map((line) => columnBounds(line, x));
  if (ranges.length === 0) return { left: 0, right: 0 };
  return {
    left: median(ranges.map((range) => range.left)),
    right: median(ranges.map((range) => range.right)),
  };
}

function linesInColumn(lines: TextLine[], colLeft: number, colRight: number): TextLine[] {
  const colW = Math.max(1, colRight - colLeft);
  const filtered: TextLine[] = [];
  for (const line of lines) {
    const boxes = line.boxes.filter((box) => {
      const overlap = Math.min(box.left + box.width, colRight) - Math.max(box.left, colLeft);
      return overlap > Math.min(box.width, colW) * 0.2;
    });
    if (boxes.length === 0) continue;
    filtered.push({
      top: Math.min(...boxes.map((box) => box.top)),
      bottom: Math.max(...boxes.map((box) => box.top + box.height)),
      left: Math.min(...boxes.map((box) => box.left)),
      right: Math.max(...boxes.map((box) => box.left + box.width)),
      boxes,
    });
  }
  return filtered;
}

function seedLineIndex(lines: TextLine[], y: number): number | null {
  if (lines.length === 0) return null;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const dist = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  }
  const line = lines[best];
  if (!line) return null;
  const limit = Math.max(line.bottom - line.top, 12) * 2.5;
  if (bestDist > limit) return null;
  return best;
}

function isParagraphBreak(prev: TextLine, next: TextLine, stats: {
  breakPitch: number;
  indent: number;
  medLeft: number;
  medWidth: number;
}): boolean {
  if (next.top - prev.top > stats.breakPitch) return true;
  if (next.left - stats.medLeft > stats.indent) return true;
  const prevShort = lineWidth(prev) < stats.medWidth * 0.72;
  const nextFull = lineWidth(next) > stats.medWidth * 0.88;
  if (prevShort && nextFull) return true;
  return false;
}

function expandParagraph(lines: TextLine[], seedIndex: number): { start: number; end: number } {
  const heights = lines.map((line) => line.bottom - line.top);
  const medH = median(heights) || 12;
  const pitches: number[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const prev = lines[index - 1];
    const next = lines[index];
    if (!prev || !next) continue;
    pitches.push(next.top - prev.top);
  }
  const wrapPitches = pitches.filter((pitch) => pitch <= medH * 2.2);
  const wrapPitch = wrapPitches.length > 0
    ? median(wrapPitches)
    : pitches.length > 0
      ? Math.min(median(pitches), medH * 1.4)
      : medH * 1.2;
  const breakPitch = Math.max(wrapPitch * 1.35, wrapPitch + medH * 0.35);
  const medLeft = median(lines.map((line) => line.left));
  const medWidth = median(lines.map(lineWidth)) || 1;
  const indent = Math.max(10, medH * 0.7);
  const stats = { breakPitch, indent, medLeft, medWidth };

  let start = seedIndex;
  while (start > 0) {
    const prev = lines[start - 1];
    const current = lines[start];
    if (!prev || !current) break;
    if (isParagraphBreak(prev, current, stats)) break;
    start -= 1;
  }
  let end = seedIndex;
  while (end < lines.length - 1) {
    const current = lines[end];
    const next = lines[end + 1];
    if (!current || !next) break;
    if (isParagraphBreak(current, next, stats)) break;
    end += 1;
  }
  return { start, end };
}

/**
 * Size a reading hole to the paragraph under `(x, y)` (page-local PDF points).
 * Wrapped lines stay together; a larger gap, first-line indent, or short last
 * line is a paragraph break. Multi-column pages stay in the column at `x`.
 */
export function findParagraphAt(
  boxes: TextBox[],
  x: number,
  y: number,
  limits: { minHeight: number; maxHeight: number } = { minHeight: 10, maxHeight: 640 },
): ParagraphBox | null {
  const lines = clusterLines(boxes);
  const seedIndex = seedLineIndex(lines, y);
  if (seedIndex == null) return null;
  const seed = lines[seedIndex];
  if (!seed) return null;

  const column = columnAround(lines, seedIndex, x);
  const padX = Math.max(12, (seed.bottom - seed.top) * 2.4);
  const columnLines = linesInColumn(lines, column.left - padX, column.right + padX);
  const columnSeed = seedLineIndex(columnLines, y);
  if (columnSeed == null) return null;

  const span = expandParagraph(columnLines, columnSeed);
  const first = columnLines[span.start];
  const last = columnLines[span.end];
  if (!first || !last) return null;

  const medH = median(columnLines.map((line) => line.bottom - line.top)) || 12;
  const pad = Math.max(2, medH * 0.18);
  let top = first.top - pad;
  let height = last.bottom + pad - top;

  if (height < limits.minHeight) {
    top -= (limits.minHeight - height) / 2;
    height = limits.minHeight;
  } else if (height > limits.maxHeight) {
    top = Math.min(Math.max(y - limits.maxHeight / 2, top), top + height - limits.maxHeight);
    height = limits.maxHeight;
  }

  return { top, height };
}

/** Visible pdf.js text-layer spans as page-local PDF-point boxes. */
export function paragraphBoxesFromTextLayer(pageEl: HTMLElement, zoom: number): TextBox[] {
  const layer = pageEl.querySelector(".textLayer");
  if (!layer || zoom <= 0) return [];
  const pageRect = pageEl.getBoundingClientRect();
  const boxes: TextBox[] = [];
  for (const node of layer.querySelectorAll("span")) {
    if (!node.textContent?.trim()) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    boxes.push({
      left: (rect.left - pageRect.left) / zoom,
      top: (rect.top - pageRect.top) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    });
  }
  return boxes;
}
