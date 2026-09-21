import type { ReactNode } from "react";

export type HudInline =
  | { type: "text"; value: string }
  | { type: "bold"; children: HudInline[] }
  | { type: "link"; href: string; children: HudInline[] };

export type HudListItem = {
  index?: number;
  title: HudInline[];
  body: HudInline[][];
};

export type HudBlock =
  | { type: "paragraph"; children: HudInline[] }
  | { type: "heading"; children: HudInline[] }
  | { type: "list"; ordered: boolean; items: HudListItem[] };

const ORDERED = /^(?:#{1,3}\s*)?(?:[-*]\s+)?(\d{1,2})[.)]\s+(.*)$/;
const UNORDERED = /^(?:[-*+]|•)\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

function normalizeLine(line: string) {
  const trimmed = line.trim();
  if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4) {
    const inner = trimmed.slice(2, -2).trim();
    if (ORDERED.test(inner) || UNORDERED.test(inner) || HEADING.test(inner)) return inner;
  }
  return trimmed;
}

function safeHref(href: string): string {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("mailto:")) return trimmed;
  return "#";
}

export function parseInline(input: string): HudInline[] {
  const nodes: HudInline[] = [];
  const pattern = /(\*\*[^*]+?\*\*|__[^_]+?__|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    if (match.index > last) {
      nodes.push({ type: "text", value: input.slice(last, match.index) });
    }
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push({ type: "bold", children: [{ type: "text", value: token.slice(2, -2) }] });
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push({
          type: "link",
          href: safeHref(link[2]),
          children: parseInline(link[1]),
        });
      }
    }
    last = match.index + token.length;
  }
  if (last < input.length) nodes.push({ type: "text", value: input.slice(last) });
  return nodes.filter((node) => node.type !== "text" || node.value.length > 0);
}

function splitTitle(nodes: HudInline[]): { title: HudInline[]; body: HudInline[] } {
  if (nodes[0]?.type === "bold") {
    return { title: nodes[0].children, body: trimLead(nodes.slice(1)) };
  }
  return { title: nodes, body: [] };
}

function trimLead(nodes: HudInline[]): HudInline[] {
  if (nodes.length === 0) return nodes;
  const first = nodes[0];
  if (first.type !== "text") return nodes;
  const cleaned = first.value.replace(/^[\s:–—-]+/, "");
  if (!cleaned) return trimLead(nodes.slice(1));
  return [{ type: "text", value: cleaned }, ...nodes.slice(1)];
}

function isOrdered(line: string) {
  return ORDERED.test(line.trim());
}

function isUnordered(line: string) {
  const trimmed = line.trim();
  return UNORDERED.test(trimmed) && !ORDERED.test(trimmed);
}

function parseOrdered(line: string) {
  const match = line.trim().match(ORDERED);
  if (!match) return null;
  return { index: Number(match[1]), rest: match[2] ?? "" };
}

function parseUnordered(line: string) {
  const match = line.trim().match(UNORDERED);
  if (!match) return null;
  return { rest: match[1] ?? "" };
}

export function parseHudMarkdown(text: string): HudBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: HudBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: HudListItem[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join("\n").trim();
    paragraph = [];
    if (!joined) return;
    const heading = joined.match(HEADING);
    if (heading && !joined.includes("\n")) {
      blocks.push({ type: "heading", children: parseInline(heading[2] ?? "") });
      return;
    }
    blocks.push({ type: "paragraph", children: parseInline(joined) });
  };

  const flushList = () => {
    if (!list || list.items.length === 0) return;
    blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  const appendContinuation = (line: string) => {
    if (!list || list.items.length === 0) return false;
    const content = line.trim();
    if (!content) return true;
    const item = list.items[list.items.length - 1];
    const nodes = trimLead(parseInline(content));
    if (nodes.length === 0) return true;
    item.body.push(nodes);
    return true;
  };

  const startItem = (ordered: boolean, index: number | undefined, rest: string) => {
    const { title, body } = splitTitle(parseInline(rest.trim()));
    const next: HudListItem = {
      index,
      title,
      body: body.length && body.some((node) => node.type !== "text" || node.value.trim()) ? [body] : [],
    };
    if (list && list.ordered === ordered) {
      list.items.push(next);
      return;
    }
    flushParagraph();
    flushList();
    list = { ordered, items: [next] };
  };

  const nextMeaningful = (from: number) => {
    for (let index = from + 1; index < lines.length; index += 1) {
      const value = normalizeLine(lines[index]);
      if (value) return value;
    }
    return "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = normalizeLine(line);
    if (!trimmed) {
      const upcoming = nextMeaningful(index);
      if (list && upcoming && (isOrdered(upcoming) || isUnordered(upcoming))) continue;
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(HEADING);
    if (heading && !isOrdered(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", children: parseInline(heading[2] ?? "") });
      continue;
    }
    const ordered = parseOrdered(trimmed);
    if (ordered) {
      startItem(true, ordered.index, ordered.rest);
      continue;
    }
    const unordered = parseUnordered(trimmed);
    if (unordered) {
      startItem(false, undefined, unordered.rest);
      continue;
    }
    if (list && !HEADING.test(trimmed)) {
      appendContinuation(line);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderInline(nodes: HudInline[], keyPrefix: string): ReactNode {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") {
      const parts = node.value.split("\n");
      return parts.map((part, partIndex) => (
        <span key={`${key}-t-${partIndex}`}>
          {partIndex > 0 ? <br /> : null}
          {part}
        </span>
      ));
    }
    if (node.type === "bold") return <strong key={key}>{renderInline(node.children, key)}</strong>;
    return (
      <a key={key} href={node.href} target="_blank" rel="noreferrer">
        {renderInline(node.children, key)}
      </a>
    );
  });
}

function renderParagraph(children: HudInline[], key: string) {
  return <p key={key}>{renderInline(children, key)}</p>;
}

export function HudMarkdown({ text }: { text: string }) {
  const blocks = parseHudMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div className="nova-hud-md">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <p key={`h-${index}`} className="nova-hud-heading">
              {renderInline(block.children, `h-${index}`)}
            </p>
          );
        }
        if (block.type === "paragraph") {
          return renderParagraph(block.children, `p-${index}`);
        }
        return (
          <ol key={`l-${index}`} className={`nova-hud-list ${block.ordered ? "ordered" : "plain"}`}>
            {block.items.map((item, itemIndex) => {
              const number = item.index ?? itemIndex + 1;
              return (
                <li key={`i-${index}-${itemIndex}`} className="nova-hud-item">
                  {block.ordered ? (
                    <span className="nova-hud-num">{String(number).padStart(2, "0")}</span>
                  ) : (
                    <span className="nova-hud-num faint">·</span>
                  )}
                  <div className="nova-hud-item-copy">
                    {item.title.length > 0 ? (
                      <p className="nova-hud-title">{renderInline(item.title, `t-${index}-${itemIndex}`)}</p>
                    ) : null}
                    {item.body.map((paragraph, bodyIndex) =>
                      renderParagraph(paragraph, `b-${index}-${itemIndex}-${bodyIndex}`),
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        );
      })}
    </div>
  );
}
