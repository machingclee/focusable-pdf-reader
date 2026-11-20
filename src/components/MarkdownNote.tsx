/**
 * A note's markdown, rendered compactly for a card.
 *
 * The cards used to show the remark flattened to plain text (`noteSummary`), which
 * meant a note written with bullets, a table or bold emphasis read as one run of
 * prose with the markers stripped. This renders the same markdown the editor sees,
 * so what was written is what the card shows.
 *
 * It is deliberately a narrower pipeline than the popup's previewer: GFM and math,
 * no `rehype-highlight` and no `rehype-raw`. Highlighting pulls highlight.js and
 * its language grammar into whatever bundle this component lands in — and cards
 * live in the app shell, so that would make every launch carry it for a code
 * colour that is unreadable at card size anyway. Raw HTML is left unparsed for the
 * same "don't pay for the rare case" reason, and because a note is user text.
 *
 * Kept behind `memo` on the markdown string: a list re-renders on every toast or
 * refresh tick, and re-parsing every note each time is wasted work.
 *
 * Imported lazily by the card list, so the PDF viewer's own bundle does not carry
 * the parser: it arrives the first time a note card renders.
 */
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
// KaTeX's stylesheet, which the math in a card needs as much as the popup does.
import "katex/dist/katex.min.css";

const MarkdownNote = memo(function MarkdownNote({ markdown }: { markdown: string }) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);

  return (
    <div className="notes-card-markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownNote;
