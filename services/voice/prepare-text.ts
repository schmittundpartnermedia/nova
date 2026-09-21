import { redactSecrets } from "@/lib/secrets";
import { NOVA_VOICE_CONFIG } from "@/providers/voice/config";

const CODE_FENCE = /```[\s\S]*?```/g;
const UNCLOSED_FENCE = /```[\s\S]*$/;
const INLINE_CODE = /`([^`]+)`/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>)\]]+/gi;
const JSON_BLOCK = /\{[\s\S]{80,}\}/g;
const TABLE_BLOCK = /(?:^\|.+\|[ \t]*\n){3,}/gm;
const HTML_TAG = /<\/?[^>]+>/g;

function replaceUrls(text: string): string {
  return text.replace(URL_RE, (url) => {
    try {
      const host = new globalThis.URL(url).hostname.replace(/^www\./, "");
      return host ? `Link zu ${host}` : "einen Link";
    } catch {
      return "einen Link";
    }
  });
}

function shortenLongLists(text: string): string {
  const lines = text.split("\n");
  const isItem = (line: string) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isItem(lines[i] ?? "")) {
      out.push(lines[i] ?? "");
      i += 1;
      continue;
    }
    const items: string[] = [];
    while (i < lines.length && isItem(lines[i] ?? "")) {
      items.push((lines[i] ?? "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim());
      i += 1;
    }
    if (items.length > 5) {
      out.push(items.slice(0, 3).map((item, index) => `${index + 1}. ${item}`).join(". "));
      out.push("Weitere Punkte stehen im Text.");
    } else {
      out.push(items.join(". "));
    }
  }
  return out.join("\n");
}

function applyPronunciation(text: string): string {
  let next = text;
  for (const rule of NOVA_VOICE_CONFIG.pronunciation) {
    next = next.replace(rule.from, rule.to);
  }
  return next;
}

function hasUnclosedFence(text: string): boolean {
  const ticks = text.split("```").length - 1;
  return ticks % 2 === 1;
}

export function prepareTextForSpeech(text: string, options?: { finalize?: boolean }): string {
  const finalize = options?.finalize ?? true;
  let next = redactSecrets(text ?? "");

  if (!finalize && hasUnclosedFence(next)) {
    next = next.slice(0, next.lastIndexOf("```")).trim();
  }

  next = next.replace(CODE_FENCE, " Den Code habe ich im Text hinterlegt. ");
  if (finalize && hasUnclosedFence(next)) {
    next = next.replace(UNCLOSED_FENCE, " Den Code habe ich im Text hinterlegt. ");
  }

  next = next.replace(INLINE_CODE, (_, code: string) => (code.length <= 24 ? code : "ein kurzes Codefragment"));
  next = next.replace(MARKDOWN_LINK, "$1");
  next = next.replace(TABLE_BLOCK, " Die Tabelle steht im Text. ");
  next = next.replace(JSON_BLOCK, " Die Daten stehen im Text. ");
  next = replaceUrls(next);
  next = next.replace(HTML_TAG, " ");
  next = next.replace(/^#{1,6}\s+/gm, "");
  next = next.replace(/\*\*(.*?)\*\*/g, "$1");
  next = next.replace(/\*(.*?)\*/g, "$1");
  next = shortenLongLists(next);
  next = applyPronunciation(next);
  next = next.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  next = next.replace(/[ \t]{2,}/g, " ").trim();

  if (next.length > NOVA_VOICE_CONFIG.maxInputChars) {
    next = `${next.slice(0, NOVA_VOICE_CONFIG.maxInputChars - 24).trim()} … Der Rest steht im Text.`;
  }

  return next;
}
