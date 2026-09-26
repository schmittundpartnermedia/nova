export function nextDraftBody(current: string, request: string): { body: string; changed: boolean } {
  const quoted = request.match(/[„"«]([^“"»]{2,})[“"»]/);
  if (quoted?.[1]?.trim()) return { body: quoted[1].trim(), changed: true };
  const tail = request
    .replace(/^[\s\S]*?\bentwurf\b/i, "")
    .replace(/^[\s,:.-]*(?:bitte|mal|noch|so|zu|auf|dass|daß|schreib(?:e)?|text)*/i, "")
    .trim();
  if (tail.length < 8) return { body: current, changed: false };
  const instruction = tail.replace(/[.!?]+$/g, "").trim();
  const paragraphs = current.split(/\n\s*\n/);
  if (paragraphs.length >= 3) {
    paragraphs[1] = instruction.endsWith(".") ? instruction : `${instruction}.`;
    return { body: paragraphs.join("\n\n").trim(), changed: true };
  }
  return { body: instruction, changed: true };
}
