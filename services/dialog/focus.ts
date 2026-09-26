import { prisma } from "@/lib/prisma";

export type DialogFrame = {
  domain: string;
  reply: string;
};

const KEY = "novaFocus";

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readFocus(meta: Record<string, unknown>): { current: DialogFrame | null; stack: DialogFrame[] } {
  const focus = meta[KEY];
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return { current: null, stack: [] };
  const record = focus as { current?: DialogFrame; stack?: DialogFrame[] };
  const current = record.current?.reply ? record.current : null;
  const stack = Array.isArray(record.stack) ? record.stack.filter((item) => item?.reply) : [];
  return { current, stack };
}

export async function loadDialogFocus(conversationId: string): Promise<{ current: DialogFrame | null; previous: DialogFrame | null }> {
  const row = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const { current, stack } = readFocus(parseMeta(row?.metadata ?? null));
  return { current, previous: stack.length ? stack[stack.length - 1] : null };
}

export async function recordDialogFocus(input: { conversationId: string; domain: string; reply: string }) {
  const reply = input.reply.trim();
  if (!reply || input.domain === "social") return;
  const row = await prisma.conversation.findUnique({ where: { id: input.conversationId } });
  if (!row) return;
  const meta = parseMeta(row.metadata);
  const focus = readFocus(meta);
  const stack = focus.stack.slice(-5);
  if (focus.current && focus.current.domain !== input.domain) stack.push(focus.current);
  meta[KEY] = {
    current: { domain: input.domain, reply: reply.slice(0, 4000) },
    stack: stack.slice(-5),
  };
  await prisma.conversation.update({
    where: { id: row.id },
    data: { metadata: JSON.stringify(meta) },
  });
}

export async function popDialogFocus(conversationId: string): Promise<DialogFrame | null> {
  const row = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!row) return null;
  const meta = parseMeta(row.metadata);
  const focus = readFocus(meta);
  const stack = focus.stack.slice();
  const previous = stack.pop() ?? null;
  const current = previous ?? focus.current;
  if (!current) return null;
  meta[KEY] = { current, stack };
  await prisma.conversation.update({
    where: { id: row.id },
    data: { metadata: JSON.stringify(meta) },
  });
  return current;
}
