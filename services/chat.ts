import { prisma } from "@/lib/prisma";

/**
 * Aufbereitung des Gesprächs für das Chatfenster. Die Schritte kommen aus dem gespeicherten Werkzeugprotokoll
 * einer Antwort (metadata.werkzeuge, Zeilen „werkzeug: {json}“); Karten zeigen den aktuellen Stand aus der DB.
 */

export type ChatSchritt = { werkzeug: string; ok: boolean; ausgefuehrt: boolean; kurz: string };

export type ChatKarte =
  | { typ: "entwurf"; id: string; absender: string; an: string; betreff: string; text: string; status: string }
  | { typ: "kampagne"; id: string; name: string; status: string; gesamt: number; gesendet: number };

export type ChatNachricht = {
  id: string;
  rolle: "user" | "assistant";
  text: string;
  zeit: string;
  meldung: boolean;
  schritte: ChatSchritt[];
  karten: ChatKarte[];
};

const WERKZEUG_NAMEN: Record<string, string> = {
  gedaechtnis_lesen: "Gedächtnis gelesen",
  gedaechtnis_schreiben: "Gedächtnis ergänzt",
  mail_lesen: "Mails gelesen",
  mail_entwurf: "Entwurf angelegt",
  mail_antworten: "Antwortentwurf angelegt",
  mail_senden: "Mail senden",
  freigabe_mail_dauer: "Dauerfreigabe Mail",
  vorlage_liste: "Vorlagen gelesen",
  vorlage_fuellen: "Vorlage gefüllt",
  kampagne_planen: "Kampagne geplant",
  kampagne_starten: "Kampagne gestartet",
  kampagne_status: "Kampagnen-Stand",
  kampagne_abbrechen: "Kampagne abgebrochen",
  kunden_suchen: "Kundensuche",
  freigabe_scanner_dauer: "Dauerfreigabe Scanner",
  kontakt_hinzufuegen: "Kontakt eingetragen",
  kontaktliste_anzeigen: "Kontaktliste gelesen",
};

type ProtokollZeile = { werkzeug: string; ok: boolean; executed: boolean; data: Record<string, unknown>; error?: string };

export function parseWerkzeugNotiz(notiz: string): ProtokollZeile[] {
  const zeilen: ProtokollZeile[] = [];
  for (const line of notiz.split("\n")) {
    const match = line.match(/^([a-z_]+): (.*)$/);
    if (!match) continue;
    let parsed: { ok?: boolean; executed?: boolean; data?: unknown; error?: string } = {};
    try {
      parsed = JSON.parse(match[2]!) as typeof parsed;
    } catch {
      parsed = { ok: true };
    }
    zeilen.push({
      werkzeug: match[1]!,
      ok: parsed.ok !== false,
      executed: parsed.executed === true,
      data: parsed.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : {},
      error: parsed.error,
    });
  }
  return zeilen;
}

function kurzText(zeile: ProtokollZeile): string {
  if (!zeile.ok) return zeile.error ?? "fehlgeschlagen";
  const d = zeile.data;
  if (typeof d.status === "string") return d.status.replace(/_/g, " ");
  if (typeof d.anzahl === "number") return `${d.anzahl}`;
  if (typeof d.an === "string") return `an ${d.an}`;
  if (typeof d.datei === "string") return `${d.datei}.md`;
  if (typeof d.liste === "string") return d.liste;
  return zeile.executed ? "erledigt" : "gelesen";
}

export async function chatAnsicht(
  organizationId: string,
  rows: Array<{ id: string; role: string; content: string; createdAt: Date; metadata: string | null }>,
): Promise<ChatNachricht[]> {
  const nachrichten: ChatNachricht[] = [];
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const metadata = (() => {
      try {
        return JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    const protokoll = typeof metadata.werkzeuge === "string" ? parseWerkzeugNotiz(metadata.werkzeuge) : [];
    const karten: ChatKarte[] = [];
    const gesehen = new Set<string>();
    for (const zeile of protokoll) {
      const entwurfId = typeof zeile.data.entwurf_id === "string" ? zeile.data.entwurf_id : null;
      if (entwurfId && !gesehen.has(entwurfId)) {
        gesehen.add(entwurfId);
        const entwurf = await prisma.communication.findFirst({ where: { id: entwurfId, organizationId } });
        if (entwurf) {
          karten.push({
            typ: "entwurf",
            id: entwurf.id,
            absender: entwurf.fromAddress ?? "",
            an: entwurf.toAddress ?? "",
            betreff: entwurf.subject,
            text: entwurf.body,
            status: entwurf.status,
          });
        }
      }
      const kampagneId = typeof zeile.data.kampagne_id === "string" ? zeile.data.kampagne_id : null;
      if (kampagneId && !gesehen.has(kampagneId)) {
        gesehen.add(kampagneId);
        const kampagne = await prisma.campaign.findFirst({ where: { id: kampagneId, organizationId } });
        if (kampagne) {
          const [gesamt, gesendet] = await Promise.all([
            prisma.communication.count({ where: { campaignId: kampagne.id, direction: "outbound" } }),
            prisma.communication.count({ where: { campaignId: kampagne.id, direction: "outbound", status: "sent" } }),
          ]);
          karten.push({ typ: "kampagne", id: kampagne.id, name: kampagne.name, status: kampagne.status, gesamt, gesendet });
        }
      }
    }
    // Ersetzte Entwürfe nur zeigen, wenn die Nachricht sonst keine Karte hätte.
    const aktuell = karten.filter((karte) => karte.typ !== "entwurf" || karte.status !== "superseded");
    nachrichten.push({
      id: row.id,
      rolle: row.role,
      text: row.content,
      zeit: row.createdAt.toISOString(),
      meldung: metadata.channel === "nova-meldung",
      schritte: protokoll.map((zeile) => ({
        werkzeug: WERKZEUG_NAMEN[zeile.werkzeug] ?? zeile.werkzeug,
        ok: zeile.ok,
        ausgefuehrt: zeile.executed,
        kurz: kurzText(zeile),
      })),
      karten: aktuell.length ? aktuell : karten,
    });
  }
  return nachrichten;
}
