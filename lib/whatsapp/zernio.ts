/**
 * WhatsApp über Zernio (offizielle WhatsApp-Business-Schnittstelle von Meta, https://zernio.com/api).
 * Joachims Business-Nummer ist bei Zernio verbunden (Coexistence: die App läuft weiter).
 * Schlüssel: ZERNIO_API_KEY in NOVAs .env – trägt Joachim selbst ein. Konto: ZERNIO_WHATSAPP_ACCOUNT_ID oder das
 * einzige verbundene WhatsApp-Konto.
 *
 * Kosten trägt Meta (Rechnung an Joachims WhatsApp-Business-Konto): Werbe-Vorlage Deutschland 0,1365 $ je
 * zugestellter Nachricht, Antworten im 24-Stunden-Fenster die ersten 1000 im Monat frei (Zernio-Preisliste, ab 01.10.2026).
 */

export const ZERNIO_BASIS = (process.env.ZERNIO_API_URL?.trim() || "https://zernio.com/api").replace(/\/$/, "");
/** Meta-Preis je zugestellter Werbe-Vorlage nach Deutschland (USD, Stand 01.10.2026). */
export const PREIS_WERBUNG_USD = 0.1365;

export type ZernioKonto = { id: string; name: string | null; nummer: string | null };
export type ZernioVorlage = { name: string; sprache: string; status: string; kategorie: string | null; text: string | null; ablehnungsgrund: string | null };
export type ZernioKontakt = { id: string; name: string | null; telefon: string };
export type ZernioGespraech = { id: string; telefon: string; name: string | null; aktualisiert: string; ungelesen: number };
export type ZernioNachricht = { id: string; richtung: "ein" | "aus"; text: string; zeit: string; status: string | null; perApp: boolean };

/** Fehler der Schnittstelle mit Zernio-Code (z. B. recipient_opted_out, TEMPLATE_REQUIRED). */
export class ZernioFehler extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export type WhatsappDienst = {
  konto(): Promise<ZernioKonto>;
  vorlagen(): Promise<ZernioVorlage[]>;
  vorlageEinreichen(input: { name: string; sprache: string; kategorie: "MARKETING" | "UTILITY"; text: string; beispiel: string[] }): Promise<{ status: string }>;
  kontakte(): Promise<ZernioKontakt[]>;
  sendeVorlage(input: { telefon: string; vorlage: string; sprache: string; werte: string[] }): Promise<{ nachrichtId: string; gespraechId: string }>;
  /** Gespräche, neueste zuerst (höchstens `limit`). */
  gespraeche(limit: number): Promise<ZernioGespraech[]>;
  nachrichten(gespraechId: string, limit: number): Promise<ZernioNachricht[]>;
  sendeText(input: { gespraechId: string; text: string }): Promise<{ nachrichtId: string }>;
};

function schluessel(): string {
  const k = process.env.ZERNIO_API_KEY?.trim();
  if (!k) throw new Error("ZERNIO_API_KEY fehlt in NOVAs .env – Joachim trägt den Zernio-Schlüssel selbst ein.");
  return k;
}

async function rufe<T>(methode: "GET" | "POST", pfad: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ZERNIO_BASIS}${pfad}`, {
    method: methode,
    headers: { authorization: `Bearer ${schluessel()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // keine JSON-Antwort
  }
  if (!res.ok) {
    const err = (json.error ?? json) as Record<string, unknown>;
    const code = typeof err.code === "string" ? err.code : typeof json.code === "string" ? (json.code as string) : null;
    const msg = typeof err.message === "string" ? err.message : typeof json.message === "string" ? (json.message as string) : text.slice(0, 300);
    throw new ZernioFehler(`Zernio ${res.status}${code ? ` ${code}` : ""}: ${msg}`, res.status, code);
  }
  return json as T;
}

/** Nur Ziffern; führendes + und 00 entfernt. */
export function normTelefon(roh: string): string {
  return roh.replace(/[^\d]/g, "").replace(/^00/, "");
}

let kontoCache: ZernioKonto | null = null;

async function kontoId(): Promise<string> {
  return (await zernioDienst.konto()).id;
}

export const zernioDienst: WhatsappDienst = {
  async konto() {
    if (kontoCache) return kontoCache;
    const fest = process.env.ZERNIO_WHATSAPP_ACCOUNT_ID?.trim();
    const d = await rufe<{ accounts: Array<Record<string, unknown>> }>("GET", "/v1/accounts?platform=whatsapp");
    const alle = (d.accounts ?? []).map((a) => ({
      id: String(a._id ?? a.id ?? ""),
      name: (a.displayName ?? a.username ?? null) as string | null,
      nummer: (a.username ?? a.phoneNumber ?? null) as string | null,
    }));
    const konto = fest ? alle.find((a) => a.id === fest) : alle.length === 1 ? alle[0] : undefined;
    if (!konto) {
      throw new Error(
        alle.length === 0
          ? "Bei Zernio ist kein WhatsApp-Konto verbunden."
          : `Bei Zernio sind ${alle.length} WhatsApp-Konten verbunden – ZERNIO_WHATSAPP_ACCOUNT_ID in der .env festlegen.`,
      );
    }
    kontoCache = konto;
    return konto;
  },

  async vorlagen() {
    const d = await rufe<{ templates?: Array<Record<string, unknown>> }>("GET", `/v1/whatsapp/templates?accountId=${encodeURIComponent(await kontoId())}`);
    return (d.templates ?? []).map((t) => {
      const body = (Array.isArray(t.components) ? (t.components as Array<Record<string, unknown>>) : []).find((c) => String(c.type).toLowerCase() === "body");
      return {
        name: String(t.name ?? ""),
        sprache: String(t.language ?? ""),
        status: String(t.status ?? ""),
        kategorie: (t.category as string) ?? null,
        text: body && typeof body.text === "string" ? body.text : null,
        ablehnungsgrund: (t.rejected_reason as string) ?? null,
      };
    });
  },

  async vorlageEinreichen(input) {
    const d = await rufe<{ template?: { status?: string } }>("POST", "/v1/whatsapp/templates", {
      accountId: await kontoId(),
      name: input.name,
      category: input.kategorie,
      language: input.sprache,
      parameter_format: "POSITIONAL",
      components: [{ type: "body", text: input.text, example: { body_text: [input.beispiel] } }],
    });
    return { status: d.template?.status ?? "PENDING" };
  },

  async kontakte() {
    const out: ZernioKontakt[] = [];
    for (let skip = 0; skip < 20_000; skip += 200) {
      const d = await rufe<{ contacts?: Array<Record<string, unknown>>; pagination?: { hasMore?: boolean } }>(
        "GET",
        `/v1/contacts?platform=whatsapp&limit=200&skip=${skip}`,
      );
      for (const c of d.contacts ?? []) {
        const telefon = normTelefon(String(c.platformIdentifier ?? c.displayIdentifier ?? ""));
        if (telefon.length >= 8) out.push({ id: String(c.id ?? ""), name: (c.name as string) || null, telefon });
      }
      if (!d.pagination?.hasMore) break;
    }
    return out;
  },

  async sendeVorlage(input) {
    const d = await rufe<{ data?: { messageId?: string; conversationId?: string } }>("POST", "/v1/inbox/conversations", {
      accountId: await kontoId(),
      participantId: input.telefon,
      templateName: input.vorlage,
      templateLanguage: input.sprache,
      templateParams: input.werte,
    });
    if (!d.data?.messageId) throw new Error("Zernio hat keine Nachrichten-ID zurückgegeben.");
    return { nachrichtId: d.data.messageId, gespraechId: d.data.conversationId ?? "" };
  },

  async gespraeche(limit) {
    const d = await rufe<{ data?: Array<Record<string, unknown>> }>(
      "GET",
      `/v1/inbox/conversations?platform=whatsapp&accountId=${encodeURIComponent(await kontoId())}&sortOrder=desc&limit=${limit}`,
    );
    return (d.data ?? [])
      .filter((g) => !g.isGroup)
      .map((g) => ({
        id: String(g.id ?? ""),
        telefon: normTelefon(String(g.participantId ?? "")),
        name: (g.participantName as string) || null,
        aktualisiert: String(g.updatedTime ?? ""),
        ungelesen: typeof g.unreadCount === "number" ? g.unreadCount : 0,
      }));
  },

  async nachrichten(gespraechId, limit) {
    const d = await rufe<{ messages?: Array<Record<string, unknown>> }>(
      "GET",
      `/v1/inbox/conversations/${encodeURIComponent(gespraechId)}/messages?accountId=${encodeURIComponent(await kontoId())}&sortOrder=desc&limit=${limit}`,
    );
    return (d.messages ?? []).map((m) => ({
      id: String(m.id ?? ""),
      richtung: m.direction === "incoming" ? ("ein" as const) : ("aus" as const),
      text: String(m.message ?? ""),
      zeit: String(m.createdAt ?? ""),
      status: (m.deliveryStatus as string) ?? null,
      perApp: m.sentVia === "human",
    }));
  },

  async sendeText(input) {
    const d = await rufe<{ data?: { messageId?: string } }>("POST", `/v1/inbox/conversations/${encodeURIComponent(input.gespraechId)}/messages`, {
      accountId: await kontoId(),
      message: input.text,
    });
    if (!d.data?.messageId) throw new Error("Zernio hat keine Nachrichten-ID zurückgegeben.");
    return { nachrichtId: d.data.messageId };
  },
};

const globalRef = globalThis as unknown as { __novaWhatsapp?: WhatsappDienst };

export function whatsappDienst(): WhatsappDienst {
  return globalRef.__novaWhatsapp ?? zernioDienst;
}

/** Tests setzen einen Dienst im Speicher ein; nie das echte Zernio. */
export function setzeWhatsappDienst(dienst: WhatsappDienst | null): void {
  globalRef.__novaWhatsapp = dienst ?? undefined;
}
