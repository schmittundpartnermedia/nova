const ABBREVIATIONS = /\b(?:z\.B|bzw|usw|etc|Dr|Nr|ca|inkl|vgl|d\.h|u\.a|Mio|Abs|Art)\.$/i;
const SENTENCE_END = /[.!?…]["»”']?(?:\s+|$)/g;
const SOFT_SPLIT = /(?:;|:)\s+|,(?:\s+(?:und|oder|aber|dann|danach|sowie)\s+)/i;

const MIN_SENTENCE_CHARS = 8;
const TARGET_CHUNK_CHARS = 280;
const MAX_CHUNK_CHARS = 420;

function canEndSentence(prefix: string): boolean {
  const tail = prefix.trim();
  if (ABBREVIATIONS.test(tail)) return false;
  if (/\d\.$/.test(tail)) return false;
  return true;
}

function splitOversized(value: string): string[] {
  if (value.length <= MAX_CHUNK_CHARS) return [value];
  const parts: string[] = [];
  let rest = value;
  while (rest.length > MAX_CHUNK_CHARS) {
    const window = rest.slice(0, MAX_CHUNK_CHARS);
    const softMatch = window.match(SOFT_SPLIT);
    const softAt = softMatch?.index ?? -1;
    let cut = -1;
    if (softAt > TARGET_CHUNK_CHARS * 0.4) {
      cut = softAt + (softMatch?.[0].length ?? 1);
    } else {
      cut = window.lastIndexOf(" ");
    }
    if (cut < 24) cut = MAX_CHUNK_CHARS;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

export function splitSpeechChunks(text: string, options?: { finalize?: boolean }): string[] {
  const source = text.trim();
  if (!source) return [];

  const finalize = options?.finalize ?? true;
  const chunks: string[] = [];
  let cursor = 0;
  let pending = "";

  SENTENCE_END.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(source))) {
    const end = match.index + match[0].length;
    const piece = source.slice(cursor, end).trim();
    cursor = end;
    if (!piece) continue;
    if (!canEndSentence(source.slice(0, match.index + 1))) {
      pending = `${pending} ${piece}`.trim();
      continue;
    }
    const next = `${pending} ${piece}`.trim();
    pending = "";
    if (next.length < MIN_SENTENCE_CHARS) {
      pending = next;
      continue;
    }
    chunks.push(...splitOversized(next));
  }

  const rest = source.slice(cursor).trim();
  if (rest) pending = `${pending} ${rest}`.trim();

  if (finalize) {
    if (pending) chunks.push(...splitOversized(pending));
    return chunks;
  }

  if (pending.length >= TARGET_CHUNK_CHARS) {
    const parts = splitOversized(pending);
    chunks.push(...parts.slice(0, -1));
  }

  return chunks;
}

export function nextUnspokenChunks(input: {
  preparedText: string;
  spokenChars: number;
  finalize: boolean;
}): { chunks: string[]; spokenChars: number } {
  if (input.spokenChars >= input.preparedText.length) {
    return { chunks: [], spokenChars: input.preparedText.length };
  }

  const leftover = input.preparedText.slice(input.spokenChars);
  const chunks = splitSpeechChunks(leftover, { finalize: input.finalize });
  if (!chunks.length) {
    return { chunks: [], spokenChars: input.spokenChars };
  }

  let pos = 0;
  const ready: string[] = [];
  for (const chunk of chunks) {
    while (pos < leftover.length && /\s/.test(leftover[pos] ?? "")) pos += 1;
    const index = leftover.indexOf(chunk, pos);
    if (index < 0) break;
    pos = index + chunk.length;
    ready.push(chunk);
  }

  return {
    chunks: ready,
    spokenChars: input.spokenChars + pos,
  };
}
