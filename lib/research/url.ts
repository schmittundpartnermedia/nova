const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
]);

const PRIVATE_HOSTS = new Set(["localhost", "metadata.google.internal"]);

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function domainOf(url: string): string {
  const host = hostnameOf(url);
  return host.replace(/^www\./, "");
}

export function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function canonicalizeUrl(url: string): string {
  return stripTrackingParams(url.trim());
}

export function isPrivateIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function isFetchUrlAllowed(url: string, allowLocal = false): { ok: true; url: string } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: "Ungültige URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "Nur http(s)-URLs dürfen abgerufen werden." };
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.username || parsed.password) {
    return { ok: false, message: "URLs mit Zugangsdaten werden nicht abgerufen." };
  }
  const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (local && !allowLocal) {
    return { ok: false, message: "Lokale Adressen sind für Recherche nicht erlaubt." };
  }
  if (!local && (PRIVATE_HOSTS.has(host) || isPrivateIpv4(host))) {
    return { ok: false, message: "Private Netzwerke werden nicht abgerufen." };
  }
  return { ok: true, url: parsed.toString() };
}

export function sameRegistrableDomain(a: string, b: string): boolean {
  const left = domainOf(a);
  const right = domainOf(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}
