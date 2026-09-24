import path from "node:path";
import { isHardBlockedPath } from "@/lib/computer/hard-blocks";
import { looksLikeSecret, shouldRedactFilePath } from "@/lib/computer/redaction";
import { resolveWorkspacePath } from "@/lib/computer/paths";

export type BrowserLocatorSpec = {
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  testId?: string;
  placeholder?: string;
  alt?: string;
  title?: string;
  selector?: string;
  exact?: boolean;
};

const IRREVERSIBLE_PATTERN =
  /\b(?:submit|absenden|senden|versenden|send(?:ing)?(?:\s+(?:now|message|email|mail))?|kaufen|bestellen|bestellung|place\s+order|buy\s+now|pay(?:ment|en)?|zahlung|checkout|purchase|kündigen|kuendigen|cancel\s+subscription|delete\s+account|change\s+password|passwort\s+ändern|vertrag|unterschreiben|publish|post\s+now|tweet|überweisen|ueberweisen|account.?security)\b/i;

const SUBMIT_ACTIONS = new Set(["submit", "purchase", "pay", "post", "send"]);

export function looksLikeHumanGate(text: string): "captcha" | "login" | null {
  const value = text.toLowerCase();
  if (
    /recaptcha|hcaptcha|h-captcha|cf-turnstile|ich bin kein roboter|i'?m not a robot|verify you are human|cloudflare.*checking|attention required|challenge-platform/.test(
      value,
    )
  ) {
    return "captcha";
  }
  if (
    /\b(?:anmelden|sign in|log in|login)\b/.test(value) &&
    /\b(?:passwort|password|e-?mail|username|benutzername)\b/.test(value)
  ) {
    return "login";
  }
  return null;
}

export function looksLikeIrreversibleBrowserSideEffect(text: string): boolean {
  return IRREVERSIBLE_PATTERN.test(text);
}

export function isIrreversibleBrowserAction(action: string, target?: string): boolean {
  if (SUBMIT_ACTIONS.has(action)) return true;
  if (action !== "click") return false;
  return looksLikeIrreversibleBrowserSideEffect(target ?? "");
}

export function locatorTargetText(input: { selector?: string; locator?: BrowserLocatorSpec; url?: string; filePath?: string }): string {
  const locator = input.locator;
  const parts = [
    input.url,
    input.selector,
    locator?.role,
    locator?.name,
    locator?.label,
    locator?.text,
    locator?.testId,
    locator?.placeholder,
    locator?.title,
    input.filePath,
  ].filter((item): item is string => Boolean(item));
  return parts.join(" ");
}

export function parseSelectorDsl(selector: string): BrowserLocatorSpec {
  const trimmed = selector.trim();
  const roleMatch = trimmed.match(
    /^role=([a-zA-Z0-9-]+)(?:\[name=(?:"([^"]+)"|'([^']+)'|([^\]]+))\])?$/i,
  );
  if (roleMatch) {
    return { role: roleMatch[1], name: roleMatch[2] || roleMatch[3] || roleMatch[4] };
  }
  const keyed = trimmed.match(/^(label|text|testid|test-id|placeholder|alt|title|css|xpath)=(.+)$/i);
  if (keyed) {
    const key = keyed[1].toLowerCase();
    const value = keyed[2].replace(/^["']|["']$/g, "").trim();
    if (key === "testid" || key === "test-id") return { testId: value };
    if (key === "css") return { selector: value };
    if (key === "xpath") return { selector: `xpath=${value}` };
    if (key === "label") return { label: value };
    if (key === "text") return { text: value };
    if (key === "placeholder") return { placeholder: value };
    if (key === "alt") return { alt: value };
    if (key === "title") return { title: value };
  }
  return { selector: trimmed };
}

export function resolveLocatorSpec(input: { selector?: string; locator?: BrowserLocatorSpec }): BrowserLocatorSpec | null {
  if (input.locator && locatorHasAnchor(input.locator)) return input.locator;
  if (input.selector?.trim()) return parseSelectorDsl(input.selector);
  return null;
}

export function locatorHasAnchor(locator: BrowserLocatorSpec): boolean {
  return Boolean(
    locator.role ||
      locator.name ||
      locator.label ||
      locator.text ||
      locator.testId ||
      locator.placeholder ||
      locator.alt ||
      locator.title ||
      locator.selector,
  );
}

export function assertAllowedBrowserUrl(url: string): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, message: "URL fehlt." };
  if (/^(javascript|data|vbscript|chrome|chrome-extension|about):/i.test(trimmed) && trimmed !== "about:blank") {
    return { ok: false, message: "Diese URL-Scheme ist nicht erlaubt." };
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed === "about:blank") {
    return { ok: true, url: trimmed };
  }
  if (trimmed.startsWith("file:")) {
    const filePath = fileUrlToPath(trimmed);
    const resolved = resolveWorkspacePath({ requested: filePath });
    if (resolved.blocked || !resolved.withinAllowed) {
      return { ok: false, message: "file:-URLs sind nur innerhalb des NOVA-Workspace erlaubt." };
    }
    return { ok: true, url: trimmed };
  }
  return { ok: false, message: "Nur http(s)- oder Workspace-file-URLs sind erlaubt." };
}

export function assertUploadAllowed(filePath: string): { ok: true; resolved: string } | { ok: false; message: string } {
  const resolved = resolveWorkspacePath({ requested: filePath, mustExist: true });
  if (resolved.blocked || isHardBlockedPath(resolved.resolved) || shouldRedactFilePath(resolved.resolved)) {
    return { ok: false, message: "Diese Datei darf nicht hochgeladen werden (Secret oder geschützter Pfad)." };
  }
  if (!resolved.withinAllowed) {
    return { ok: false, message: "Upload nur aus einem erlaubten NOVA-Arbeitsverzeichnis." };
  }
  if (!resolved.exists) {
    return { ok: false, message: `Datei existiert nicht: ${resolved.resolved}` };
  }
  const base = path.basename(resolved.resolved);
  if (/^\.env(?:\.|$)|id_rsa|id_ed25519|\.pem$|credentials|\.netrc|authorized_keys/i.test(base)) {
    return { ok: false, message: "Secrets und Schlüsseldateien werden nicht hochgeladen." };
  }
  return { ok: true, resolved: resolved.resolved };
}

export function typingLooksLikeSecretExfil(text: string): boolean {
  return looksLikeSecret(text) && /BEGIN [A-Z ]*PRIVATE KEY|sk-ant-|OPENAI_API_KEY|ghp_|github_pat_/i.test(text);
}

export function elementLooksLikeSubmit(info: {
  tag?: string;
  type?: string;
  text?: string;
  name?: string;
  role?: string;
  href?: string;
}): boolean {
  if (info.type === "submit" || info.type === "image") return true;
  if (info.tag === "form") return true;
  return looksLikeIrreversibleBrowserSideEffect(
    [info.type, info.text, info.name, info.role, info.href].filter(Boolean).join(" "),
  );
}

function fileUrlToPath(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url.replace(/^file:\/\//, "");
  }
}
