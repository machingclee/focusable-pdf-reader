import type { PageTextIndex, SearchBox } from "./pdf";

export type { PageTextIndex, SearchBox };

export type SearchHit = {
  pageIndex: number;
  boxes: SearchBox[];
};

function compact(text: string): { compact: string; indexAt: number[] } {
  let compactText = "";
  const indexAt: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!char || /[\s-]/.test(char)) continue;
    compactText += char.toLocaleLowerCase();
    indexAt.push(index);
  }
  return { compact: compactText, indexAt };
}

function boxesForRange(page: PageTextIndex, start: number, end: number): SearchBox[] {
  const boxes: SearchBox[] = [];
  for (const run of page.runs) {
    const overlapStart = Math.max(run.start, start);
    const overlapEnd = Math.min(run.end, end);
    if (overlapEnd <= overlapStart) continue;
    const runLen = Math.max(1, run.end - run.start);
    const frac0 = (overlapStart - run.start) / runLen;
    const frac1 = (overlapEnd - run.start) / runLen;
    boxes.push({
      left: run.left + run.width * frac0,
      top: run.top,
      width: Math.max(4, run.width * (frac1 - frac0)),
      height: Math.max(10, run.height),
    });
  }
  return boxes;
}

export function findHits(pages: PageTextIndex[], query: string): SearchHit[] {
  const needle = compact(query.trim()).compact;
  if (!needle) return [];

  const hits: SearchHit[] = [];
  for (const page of pages) {
    const { compact: hay, indexAt } = compact(page.fullText);
    let from = 0;
    while (from <= hay.length - needle.length) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      const origStart = indexAt[at] ?? 0;
      const origEnd = (indexAt[at + needle.length - 1] ?? origStart) + 1;
      const boxes = boxesForRange(page, origStart, origEnd);
      hits.push({
        pageIndex: page.pageIndex,
        boxes: boxes.length > 0
          ? boxes
          : [{ left: 8, top: 8, width: 48, height: 16 }],
      });
      from = at + Math.max(1, needle.length);
    }
  }
  return hits;
}
