import {
  aendereKontakt,
  antwortEntwurf,
  brecheWhatsappKampagneAb,
  holeKontakte,
  kontaktSuchen,
  kontaktUebersicht,
  offeneAntworten,
  planeWhatsappKampagne,
  reicheVorlageEin,
  sendeAntwort,
  starteWhatsappKampagne,
  whatsappKampagnen,
  whatsappKampagnenStand,
  whatsappStatus,
  whatsappVerlauf,
} from "@/services/whatsapp";
import type { NovaToolDefinition, NovaToolResult } from "@/services/tools/types";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fehler(error: unknown): NovaToolResult {
  return { ok: false, executed: false, error: error instanceof Error ? error.message : String(error) };
}

const leer = { type: "object" as const, properties: {}, required: [] as string[], additionalProperties: false as const };

export const WHATSAPP_TOOLS: NovaToolDefinition[] = [
  {
    name: "whatsapp_status",
    description:
      "WhatsApp (Joachims Business-Nummer über Zernio): verbunden?, Vorlagen mit Meta-Status (APPROVED/PENDING/REJECTED), Kontakte (mit/ohne Vornamen, gesperrt), Kampagnen, offene Antworten.",
    parameters: leer,
    async execute(_args, ctx) {
      try {
        return { ok: true, executed: false, data: await whatsappStatus(ctx.organizationId) };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_vorlage_einreichen",
    description:
      "Reicht eine WhatsApp-Vorlage aus ~/Nova/vorlagen/whatsapp/ bei Meta zur Prüfung ein (kostet nichts, sendet nichts). Nur wenn Joachim es ausdrücklich will.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    async execute(args) {
      try {
        return { ok: true, executed: true, data: await reicheVorlageEin(str(args.name)) };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_kontakte_holen",
    description: "Holt alle WhatsApp-Kontakte von Zernio in NOVA und schlägt Vornamen vor (von Joachim gesetzte bleiben). Ergebnis: Zahlen und Beispiele ohne oder mit unsicherem Vornamen.",
    parameters: leer,
    async execute(_args, ctx) {
      try {
        return { ok: true, executed: true, data: await holeKontakte(ctx.organizationId) };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_kontakte",
    description: "WhatsApp-Kontakte ansehen: suche leer = Übersicht (Zahlen, Beispiele unsicher/ohne Vornamen); sonst Suche nach Name oder Nummer.",
    parameters: { type: "object", properties: { suche: { type: "string" } }, required: ["suche"], additionalProperties: false },
    async execute(args, ctx) {
      try {
        const s = str(args.suche);
        return { ok: true, executed: false, data: s ? { treffer: await kontaktSuchen(ctx.organizationId, s) } : await kontaktUebersicht(ctx.organizationId) };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_kontakt_aendern",
    description: "Vornamen eines WhatsApp-Kontakts setzen oder ihn sperren/entsperren. vorname leer lassen = nicht ändern; sperren: 'ja', 'nein' oder '' (nicht ändern).",
    parameters: {
      type: "object",
      properties: { telefon: { type: "string" }, vorname: { type: "string" }, sperren: { type: "string", enum: ["ja", "nein", ""] }, grund: { type: "string" } },
      required: ["telefon", "vorname", "sperren", "grund"],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      try {
        const data = await aendereKontakt(ctx.organizationId, str(args.telefon), {
          ...(str(args.vorname) ? { vorname: str(args.vorname) } : {}),
          ...(args.sperren === "ja" ? { sperren: true, grund: str(args.grund) } : args.sperren === "nein" ? { sperren: false } : {}),
        });
        return { ok: true, executed: true, data };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_kampagne_planen",
    description:
      "Plant eine WhatsApp-Rundnachricht mit einer bei Meta freigegebenen Vorlage an noch nicht angeschriebene Kontakte mit Vornamen. Sendet nichts, legt eine Freigabe an. Danach EINE Zusammenfassung (Anzahl, pro Tag, Dauer, Meta-Kosten, wer nicht dabei ist, Beispiel) und fragen „los?“.",
    parameters: {
      type: "object",
      properties: {
        vorlage: { type: "string" },
        anzahl: { type: "integer", description: "Wie viele Kontakte (erste Welle z. B. 50 bis 100)." },
        pro_tag: { type: "integer", description: "Höchstens so viele pro Tag (1 bis 250, Meta-Grenze am Anfang)." },
        abstand_sekunden: { type: "integer", description: "Abstand zwischen zwei Nachrichten (10 bis 3600, Standard 60)." },
        auch_unsichere: { type: "boolean", description: "Auch Kontakte mit unsicherem Vornamen (nur wenn Joachim die Liste geprüft hat)." },
      },
      required: ["vorlage", "anzahl", "pro_tag", "abstand_sekunden", "auch_unsichere"],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      try {
        const data = await planeWhatsappKampagne({
          organizationId: ctx.organizationId,
          vorlage: str(args.vorlage),
          anzahl: Number(args.anzahl),
          proTag: Number(args.pro_tag),
          abstandSekunden: Number(args.abstand_sekunden) || 60,
          auchUnsichere: args.auch_unsichere === true,
        });
        return { ok: true, executed: true, data: { ...data, status: "wartet_auf_freigabe" } };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_kampagne_starten",
    description: "Startet eine geplante WhatsApp-Kampagne – nur nach Joachims ausdrücklichem Ja zur Zusammenfassung, mit kampagne_id und freigabe_id.",
    parameters: { type: "object", properties: { kampagne_id: { type: "string" }, freigabe_id: { type: "string" } }, required: ["kampagne_id", "freigabe_id"], additionalProperties: false },
    async execute(args, ctx) {
      try {
        return { ok: true, executed: true, data: await starteWhatsappKampagne({ organizationId: ctx.organizationId, kampagneId: str(args.kampagne_id), freigabeId: str(args.freigabe_id) }) };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_kampagne_status",
    description: "Stand einer WhatsApp-Kampagne (gesendet, geplant, fehlgeschlagen, geantwortet, nächste). kampagne_id leer = die letzten.",
    parameters: { type: "object", properties: { kampagne_id: { type: "string" } }, required: ["kampagne_id"], additionalProperties: false },
    async execute(args, ctx) {
      try {
        const id = str(args.kampagne_id);
        return { ok: true, executed: false, data: id ? await whatsappKampagnenStand(ctx.organizationId, id) : { kampagnen: await whatsappKampagnen(ctx.organizationId) } };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_kampagne_abbrechen",
    description: "Bricht eine WhatsApp-Kampagne ab; nicht gesendete Nachrichten gehen nicht mehr raus. Nur auf Anweisung.",
    parameters: { type: "object", properties: { kampagne_id: { type: "string" } }, required: ["kampagne_id"], additionalProperties: false },
    async execute(args, ctx) {
      try {
        return { ok: true, executed: true, data: await brecheWhatsappKampagneAb(ctx.organizationId, str(args.kampagne_id)) };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_antworten",
    description: "Offene WhatsApp-Antworten von Angeschriebenen (noch nicht beantwortet), mit vorhandenem Entwurf. telefon gesetzt = Verlauf mit dieser Person.",
    parameters: { type: "object", properties: { telefon: { type: "string" } }, required: ["telefon"], additionalProperties: false },
    async execute(args, ctx) {
      try {
        const t = str(args.telefon);
        return { ok: true, executed: false, data: t ? { verlauf: await whatsappVerlauf(ctx.organizationId, t) } : { offen: await offeneAntworten(ctx.organizationId) } };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_antwort_entwurf",
    description: "Legt einen WhatsApp-Antwortentwurf an (ersetzt einen älteren an dieselbe Person) und eine Freigabe. Sendet nichts. Joachims Ton: duzen, herzlich, kurz, keine Gedankenstriche.",
    parameters: { type: "object", properties: { telefon: { type: "string" }, text: { type: "string" } }, required: ["telefon", "text"], additionalProperties: false },
    async execute(args, ctx) {
      try {
        return { ok: true, executed: true, data: await antwortEntwurf(ctx.organizationId, str(args.telefon), str(args.text)) };
      } catch (e) {
        return fehler(e);
      }
    },
  },
  {
    name: "whatsapp_antwort_senden",
    description: "Sendet einen WhatsApp-Antwortentwurf – nur nach Joachims ausdrücklichem Ja („senden“), mit entwurf_id und freigabe_id. Geht nur innerhalb von 24 Stunden nach der letzten Nachricht der Person.",
    parameters: { type: "object", properties: { entwurf_id: { type: "string" }, freigabe_id: { type: "string" } }, required: ["entwurf_id", "freigabe_id"], additionalProperties: false },
    async execute(args, ctx) {
      try {
        return { ok: true, executed: true, data: await sendeAntwort(ctx.organizationId, str(args.entwurf_id), str(args.freigabe_id)) };
      } catch (e) {
        return fehler(e);
      }
    },
  },
];
