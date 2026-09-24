export function pickControlFromInspect(tree: unknown, request: string): string {
  const needle = extractNeedle(request);
  if (!needle) return "";
  const titles: string[] = [];
  walk(tree, titles);
  const lower = needle.toLowerCase();
  const exact = titles.find((item) => item.toLowerCase() === lower);
  if (exact) return exact;
  const contains = titles.find((item) => item.toLowerCase().includes(lower) || lower.includes(item.toLowerCase()));
  return contains ?? "";
}

function extractNeedle(request: string): string {
  const quoted = request.match(/["„]([^"”]+)["”]/)?.[1];
  if (quoted?.trim()) return quoted.trim().slice(0, 120);
  const click = request.match(
    /(?:klick(?:e|en)?(?:\s+auf)?|drück(?:e|en)?(?:\s+auf)?|button|menü(?:punkt)?)\s+(.+?)(?:\s+in\s+|\s*$)/i,
  );
  if (click?.[1]) return click[1].replace(/\s+in\s+.+$/i, "").trim().slice(0, 120);
  return "";
}

function walk(node: unknown, titles: string[]) {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const key of ["title", "identifier", "description", "name", "label"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() && value.trim().length < 80) {
      titles.push(value.trim());
    }
  }
  const children = record.children;
  if (Array.isArray(children)) {
    for (const child of children.slice(0, 80)) walk(child, titles);
  }
  if (Array.isArray(node)) {
    for (const child of node.slice(0, 80)) walk(child, titles);
  }
}
