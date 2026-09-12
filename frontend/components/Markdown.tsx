"use client";

import { Fragment, type ReactNode } from "react";

/**
 * A small Markdown renderer for assistant answers.
 *
 * It covers what language models actually emit - paragraphs, headings, bold,
 * italic, inline code, fenced code blocks, bullet and numbered lists, links -
 * and nothing else. Everything is built from React elements, never from HTML
 * strings, so a model cannot smuggle markup or scripts into the page: whatever
 * it writes is text until this file says otherwise.
 *
 * It is also tolerant of being handed a prefix of the answer, because the
 * typing animation renders one more word at a time. An unclosed code fence is
 * treated as an open block, and an unmatched `**` is shown literally until its
 * partner arrives.
 */

const SAFE_LINK = /^https?:\/\//i;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first so markers inside backticks are left alone.
  const pattern =
    /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) {
      out.push(<code key={key}>{match[1].slice(1, -1)}</code>);
    } else if (match[2]) {
      out.push(<strong key={key}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      out.push(<em key={key}>{match[3].slice(1, -1)}</em>);
    } else if (match[4] && match[5] && SAFE_LINK.test(match[5])) {
      const label = match[4].slice(1, match[4].indexOf("]("));
      out.push(
        <a key={key} href={match[5]} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    } else {
      out.push(match[0]);
    }
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "code"; lang: string; body: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "paragraph"; text: string };

function blocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = line.match(/^\s*```\s*(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence, or end of a still-typing block
      // A fence inside a list item arrives indented to the item. Strip the
      // common indent so the code reads as the author typed it.
      const indent = Math.min(
        ...body.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length),
        Number.POSITIVE_INFINITY,
      );
      const dedented = Number.isFinite(indent) ? body.map((l) => l.slice(indent)) : body;
      out.push({ kind: "code", lang: fence[1], body: dedented.join("\n") });
      continue;
    }

    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) {
      out.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      // A code block in the middle of a numbered list splits it in two. Keeping
      // the author's number means the second half continues at 2, not 1.
      const start = ordered ? Number.parseInt(line.trim(), 10) || 1 : 1;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i])) {
        let item = lines[i].replace(marker, "");
        i += 1;
        // Continuation lines belong to the item above, but a nested code fence
        // or list starts its own block, so stop at anything structural.
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !marker.test(lines[i]) &&
          !bullet.test(lines[i]) &&
          !/^\s*```/.test(lines[i])
        ) {
          item += ` ${lines[i].trim()}`;
          i += 1;
        }
        items.push(item);
      }
      out.push({ kind: "list", ordered, start, items });
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*#{1,4}\s/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push({ kind: "paragraph", text: para.join(" ") });
  }

  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {blocks(text).map((block, n) => {
        const key = `b${n}`;
        switch (block.kind) {
          case "code":
            return (
              <pre key={key} className="md-code" data-lang={block.lang || undefined}>
                <code>{block.body}</code>
              </pre>
            );
          case "heading": {
            const Tag = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
            return <Tag key={key}>{inline(block.text, key)}</Tag>;
          }
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined}>
                {block.items.map((item, m) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a list item has no identity beyond its position, and the whole document re-renders as the answer is typed
                  <li key={`${key}-${m}`}>{inline(item, `${key}-${m}`)}</li>
                ))}
              </Tag>
            );
          }
          default:
            return (
              <p key={key}>
                {inline(block.text, key).map((node, m) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional by nature; see the list case above
                  <Fragment key={`${key}-${m}`}>{node}</Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
