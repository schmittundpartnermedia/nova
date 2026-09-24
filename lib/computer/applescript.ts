const MAX_CHARS = 4000;

const FORBIDDEN: Array<{ re: RegExp; reason: string }> = [
  { re: /do\s+shell\s+script/i, reason: "do shell script ist nicht erlaubt." },
  { re: /do\s+javascript/i, reason: "do javascript ist nicht erlaubt." },
  { re: /\brun\s+script\b/i, reason: "run script ist nicht erlaubt." },
  { re: /\bload\s+script\b/i, reason: "load script ist nicht erlaubt." },
  { re: /osascript/i, reason: "osascript darf nicht verschachtelt werden." },
  { re: /quoted\s+form\s+of/i, reason: "Shell-Quoting über AppleScript ist nicht erlaubt." },
  { re: /\/bin\/|\/usr\/bin\/|\/usr\/sbin\//i, reason: "Systempfade in AppleScript sind nicht erlaubt." },
];

const ALLOWED_APPS = new Set([
  "finder",
  "mail",
  "calendar",
  "safari",
  "notes",
  "textedit",
  "system settings",
  "system preferences",
  "system events",
  "music",
  "photos",
  "preview",
]);

export type CompiledAppleScript =
  | { ok: true; source: string; app: string }
  | { ok: false; reason: string };

export function extractAppleScript(request: string): string {
  const fenced = request.match(/```(?:applescript|osascript)?\s*([\s\S]+?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const labeled = request.match(/(?:applescript|osascript)\s*[:\n]\s*([\s\S]+)/i);
  if (labeled?.[1] && /tell\s+application/i.test(labeled[1])) return labeled[1].trim();
  const tell = request.match(/(tell\s+application[\s\S]+)/i);
  if (tell?.[1]) return tell[1].trim();
  return "";
}

export function compileAppleScript(source: string): CompiledAppleScript {
  const text = source.trim();
  if (!text) {
    return { ok: false, reason: "Ohne ein gültiges tell application … führe ich kein AppleScript aus." };
  }
  if (text.length > MAX_CHARS) {
    return { ok: false, reason: "Das Skript ist zu lang." };
  }
  for (const item of FORBIDDEN) {
    if (item.re.test(text)) return { ok: false, reason: item.reason };
  }
  if (!/^tell\s+application\s+/i.test(text)) {
    return { ok: false, reason: "Nur tell application … ist erlaubt." };
  }
  const apps = [...text.matchAll(/tell\s+application\s+"([^"]+)"/gi)].map((match) => match[1]!.toLowerCase());
  if (!apps.length) {
    return { ok: false, reason: "Die App im Skript muss in Anführungszeichen stehen." };
  }
  for (const app of apps) {
    if (!ALLOWED_APPS.has(app)) {
      return { ok: false, reason: `AppleScript für ${app} ist nicht freigegeben.` };
    }
  }
  return { ok: true, source: text, app: apps[0]! };
}
