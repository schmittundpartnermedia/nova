export type ChunkDraft = {
  text: string;
  section?: string;
  page?: number;
  ordinal: number;
};

const TARGET = 900;
const MAX = 1400;

function isHeading(line: string): boolean {
  if (/^#{1,4}\s+\S/.test(line)) return true;
  if (/[.!?]$/.test(line) || line.length > 48) return false;
  return /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9 .:-]{2,48}$/.test(line) && line.split(/\s+/).length <= 6;
}

function isTable(block: string): boolean {
  const lines = block.split("\n");
  const pipes = lines.filter((line) => (line.match(/\|/g) ?? []).length >= 2).length;
  return pipes >= 2 && pipes >= lines.length / 2;
}

export function chunkStructuredText(input: {
  text: string;
  page?: number;
  section?: string;
}): ChunkDraft[] {
  const raw = input.text.replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const pages = raw.split(/\f|\n---\s*page\s+(\d+)\s*---\n/i);
  const blocks: Array<{ text: string; page?: number; section?: string }> = [];
  if (pages.length === 1) {
    blocks.push({ text: raw, page: input.page, section: input.section });
  } else {
    let page = input.page ?? 1;
    for (const part of pages) {
      if (/^\d+$/.test(part)) {
        page = Number(part);
        continue;
      }
      if (part.trim()) blocks.push({ text: part.trim(), page, section: input.section });
    }
  }

  const drafts: ChunkDraft[] = [];
  for (const block of blocks) {
    const paragraphs = block.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    let buffer = "";
    let section = block.section;
    const flush = () => {
      const text = buffer.trim();
      if (text.length >= 12) {
        drafts.push({ text, section, page: block.page, ordinal: drafts.length });
      }
      buffer = "";
    };
    for (const paragraph of paragraphs) {
      const heading = paragraph.split("\n")[0] ?? "";
      if (isHeading(heading) && paragraph.length < 80) {
        flush();
        section = heading.replace(/^#+\s*/, "").trim();
        continue;
      }
      if (isTable(paragraph)) {
        flush();
        drafts.push({ text: paragraph, section, page: block.page, ordinal: drafts.length });
        continue;
      }
      const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (next.length > MAX && buffer) {
        flush();
        buffer = paragraph;
      } else {
        buffer = next;
        if (buffer.length >= TARGET) flush();
      }
    }
    flush();
  }
  return drafts.length ? drafts : [{ text: raw.slice(0, MAX), section: input.section, page: input.page, ordinal: 0 }];
}

export type ConversationTurn = {
  id: string;
  role: string;
  content: string;
  createdAt?: Date;
};

export function chunkConversation(turns: ConversationTurn[]): Array<ChunkDraft & { messageIds: string[] }> {
  const useful = turns.filter((turn) => turn.content.trim().length >= 24 && !/^(ok(ay)?|danke|ja|nein)\.?$/i.test(turn.content.trim()));
  const chunks: Array<ChunkDraft & { messageIds: string[] }> = [];
  let buffer: ConversationTurn[] = [];
  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.map((turn) => `${turn.role}: ${turn.content.trim()}`).join("\n");
    if (text.length >= 24) {
      chunks.push({
        text,
        ordinal: chunks.length,
        section: "conversation",
        messageIds: buffer.map((turn) => turn.id),
      });
    }
    buffer = [];
  };
  for (const turn of useful) {
    buffer.push(turn);
    const text = buffer.map((item) => item.content).join(" ");
    const topicShift = buffer.length >= 2 && !sharesTopic(buffer[0].content, turn.content) && buffer.length >= 4;
    if (text.length >= TARGET || buffer.length >= 6 || topicShift) flush();
  }
  flush();
  return chunks;
}

function sharesTopic(a: string, b: string): boolean {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9äöüß]+/i)
        .filter((token) => token.length > 3),
    );
  const left = tokens(a);
  let shared = 0;
  for (const token of tokens(b)) if (left.has(token)) shared += 1;
  return shared > 0;
}
