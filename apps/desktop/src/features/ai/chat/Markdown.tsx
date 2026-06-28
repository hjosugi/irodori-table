import { Fragment, type ReactNode } from "react";

/**
 * A tiny, dependency-free Markdown renderer for assistant prose. It deliberately
 * supports only the safe inline/block subset a chat reply uses — headings, bullet
 * and numbered lists, blockquotes, bold/italic, inline code, and links — and
 * never uses `dangerouslySetInnerHTML`, so there is no XSS surface. Fenced code
 * blocks are handled by the caller (rendered as runnable SQL cards), so they are
 * not parsed here.
 */
export function Markdown({ text }: { text: string }) {
  return <>{renderBlocks(text)}</>;
}

type ListBlock = { ordered: boolean; items: string[] };

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: ListBlock | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(
        <p key={key++} className="md-p">
          {renderInline(paragraph.join(" "))}
        </p>,
      );
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item, i) => (
        <li key={i}>{renderInline(item)}</li>
      ));
      blocks.push(
        list.ordered ? (
          <ol key={key++} className="md-list">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="md-list">
            {items}
          </ul>
        ),
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const Tag = (`h${Math.min(level + 2, 6)}`) as "h3" | "h4" | "h5" | "h6";
      blocks.push(
        <Tag key={key++} className="md-h">
          {renderInline(heading[2])}
        </Tag>,
      );
      continue;
    }
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote key={key++} className="md-quote">
          {renderInline(quote[1])}
        </blockquote>,
      );
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Inline tokens: inline code, bold, italic (asterisk or underscore), links. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on inline code first so formatting inside code is preserved verbatim.
  const parts = text.split(/(`[^`]+`)/g);
  let key = 0;
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      nodes.push(
        <code key={key++} className="md-code">
          {part.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<Fragment key={key++}>{renderEmphasis(part)}</Fragment>);
    }
  }
  return nodes;
}

function renderEmphasis(text: string): ReactNode[] {
  // Links, then bold, then italic — each pass wraps the matched span.
  const tokenizer =
    /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokenizer.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a key={key++} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = tokenizer.lastIndex;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}
