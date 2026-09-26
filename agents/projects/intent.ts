export type ProjectIntent =
  | { kind: "none" }
  | { kind: "list" }
  | { kind: "create"; name: string }
  | { kind: "status"; name?: string };

export function detectProjectIntent(userRequest: string): ProjectIntent {
  const text = userRequest.trim();
  if (!/\bprojekte?\b/i.test(text)) return { kind: "none" };
  const create = text.match(/\b(?:leg(?:e)?|erstell(?:e)?|anleg(?:e)?|neues)\b(?:\s+\w+){0,4}\s+projekt\s+(.+)/i);
  if (create?.[1]) {
    const name = create[1].replace(/[.!?]+$/g, "").replace(/\s+an$/i, "").trim();
    if (name) return { kind: "create", name };
  }
  if (/\b(?:liste|zeig|welche|übersicht|uebersicht|habe ich|gibt es|meine|wie viele|anzahl)\b/i.test(text)) {
    return { kind: "list" };
  }
  if (/\bstatus\b/i.test(text)) {
    const named = text.match(/\bprojekt\s+(.+)/i);
    const name = named?.[1]?.replace(/\bstatus\b/i, "").replace(/[.!?]+$/g, "").trim();
    return { kind: "status", name: name || undefined };
  }
  return { kind: "none" };
}
