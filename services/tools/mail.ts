import { isSteerableMailAddress, steerableMailAddresses } from "@/lib/mail/steerable";
import { parseMailAddress } from "@/lib/mail/adressen";
import { fuelleVorlage, importiereVorlagen, vorlagenDir } from "@/lib/mail/vorlagen";
import { createStandingPolicy, revokeStandingPolicy } from "@/services/approvals";
import { erstelleEntwurf, sendeEntwurf, type Entwurf } from "@/services/mail/entwuerfe";
import { antwortBetreff } from "@/services/mail/postfach";
import type { NovaToolDefinition, NovaToolResult } from "@/services/tools/types";

const TEXT_LIMIT = 6000;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function entwurfDaten(entwurf: Entwurf) {
  return {
    entwurf_id: entwurf.id,
    absender: entwurf.absender,
    an: entwurf.an,
    betreff: entwurf.betreff,
    text: entwurf.text,
    ist_antwort: Boolean(entwurf.antwortAuf),
  };
}

function fehler(error: unknown): NovaToolResult {
  return { ok: false, executed: false, error: error instanceof Error ? error.message : String(error) };
}

export const mailLesenTool: NovaToolDefinition = {
  name: "mail_lesen",
  description:
    "Liest die Postfächer. modus=neueste oder ungelesen: Liste der letzten Mails aus den Posteingängen aller Konten (anzahl 1–15) mit Absender, Betreff, Eingang und Textanfang. modus=nachricht: vollständiger Text einer Mail; dafür ref aus einer vorherigen Liste angeben. Jede Mail hat eine ref, die du für mail_antworten brauchst.",
  parameters: {
    type: "object",
    properties: {
      modus: { type: "string", enum: ["neueste", "ungelesen", "nachricht"] },
      anzahl: { type: "integer", description: "Wie viele Mails (1–15). Bei modus=nachricht egal." },
      ref: { type: "string", description: "Nur bei modus=nachricht: ref der Mail. Sonst leer." },
    },
    required: ["modus", "anzahl", "ref"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const modus = str(args.modus);
      if (modus === "nachricht") {
        const mail = await ctx.postfach.lesen(str(args.ref));
        if (!mail) return { ok: false, executed: false, error: "Diese Mail ist im Postfach nicht (mehr) zu finden." };
        return { ok: true, executed: false, data: { ...mail, text: mail.text.slice(0, TEXT_LIMIT) } };
      }
      const anzahl = Math.min(Math.max(Math.round(Number(args.anzahl) || 5), 1), 15);
      const mails = await ctx.postfach.neueste({ anzahl, nurUngelesen: modus === "ungelesen" });
      return { ok: true, executed: false, data: { anzahl: mails.length, mails } };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const mailEntwurfTool: NovaToolDefinition = {
  name: "mail_entwurf",
  description: `Legt einen neuen Mail-Entwurf an (wird nicht gesendet). Absender nur ${steerableMailAddresses().join(" oder ")}. Für Änderungen („mach es kürzer“) einen neuen Entwurf anlegen und die alte entwurf_id in ersetzt angeben.`,
  parameters: {
    type: "object",
    properties: {
      absender: { type: "string" },
      an: { type: "string", description: "Mail-Adresse des Empfängers." },
      betreff: { type: "string" },
      text: { type: "string", description: "Vollständiger Mailtext inkl. Anrede und Gruß." },
      ersetzt: { type: "string", description: "entwurf_id des Entwurfs, den dieser ersetzt. Sonst leer." },
    },
    required: ["absender", "an", "betreff", "text", "ersetzt"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const entwurf = await erstelleEntwurf({
        organizationId: ctx.organizationId,
        absender: str(args.absender),
        an: str(args.an),
        betreff: str(args.betreff),
        text: str(args.text),
        ersetzt: str(args.ersetzt) || undefined,
      });
      return { ok: true, executed: true, data: entwurfDaten(entwurf) };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const mailAntwortenTool: NovaToolDefinition = {
  name: "mail_antworten",
  description: `Legt einen Antwort-Entwurf auf eine Mail an (wird nicht gesendet). ref aus mail_lesen. Empfänger und Betreff kommen aus der Originalmail. absender leer lassen, wenn die Mail an ${steerableMailAddresses().join(" oder ")} ging – dann antwortet dieses Konto; sonst Absender angeben oder den Nutzer fragen. Für Änderungen neuen Antwort-Entwurf mit ersetzt=alte entwurf_id.`,
  parameters: {
    type: "object",
    properties: {
      ref: { type: "string" },
      absender: { type: "string", description: "Leer = Konto, an das die Mail ging (wenn steuerbar)." },
      text: { type: "string", description: "Vollständiger Antworttext inkl. Anrede und Gruß." },
      ersetzt: { type: "string", description: "entwurf_id des Entwurfs, den dieser ersetzt. Sonst leer." },
    },
    required: ["ref", "absender", "text", "ersetzt"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const ref = str(args.ref);
      const original = await ctx.postfach.lesen(ref);
      if (!original) return { ok: false, executed: false, error: "Die Originalmail ist im Postfach nicht zu finden." };
      const an = parseMailAddress(original.von).email;
      if (!an) return { ok: false, executed: false, error: "Absender der Originalmail ist unklar." };
      const absender = str(args.absender) || (isSteerableMailAddress(original.konto) ? original.konto : "");
      if (!absender) {
        return {
          ok: false,
          executed: false,
          error: `Die Mail ging an ${original.konto || "ein anderes Konto"}. Von welchem Konto soll ich antworten: ${steerableMailAddresses().join(" oder ")}?`,
        };
      }
      const entwurf = await erstelleEntwurf({
        organizationId: ctx.organizationId,
        absender,
        an,
        betreff: antwortBetreff(original.betreff),
        text: str(args.text),
        antwortAuf: ref,
        ersetzt: str(args.ersetzt) || undefined,
      });
      return { ok: true, executed: true, data: entwurfDaten(entwurf) };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const mailSendenTool: NovaToolDefinition = {
  name: "mail_senden",
  description:
    "Sendet einen Entwurf über den Mailserver des Absenders. Nur aufrufen, wenn der Nutzer das Senden ausdrücklich verlangt. Ohne Dauerfreigabe kommt status=freigabe_noetig mit freigabe_id zurück: dann den Nutzer einmal fragen (Empfänger + Betreff nennen) und erst nach seinem Ja erneut mit dieser freigabe_id aufrufen. Gesendet ist die Mail nur bei status=gesendet.",
  parameters: {
    type: "object",
    properties: {
      entwurf_id: { type: "string" },
      freigabe_id: { type: "string", description: "Nur nach ausdrücklichem Ja des Nutzers: die freigabe_id aus der Rückfrage. Sonst leer." },
    },
    required: ["entwurf_id", "freigabe_id"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const result = await sendeEntwurf({
        organizationId: ctx.organizationId,
        entwurfId: str(args.entwurf_id),
        freigabeId: str(args.freigabe_id) || undefined,
        postfach: ctx.postfach,
        jobId: ctx.jobId,
      });
      if (result.status === "gesendet") {
        return { ok: true, executed: true, data: { status: result.status, grund: result.grund } };
      }
      if (result.status === "freigabe_noetig") {
        return { ok: true, executed: false, data: { status: result.status, freigabe_id: result.freigabeId, grund: result.grund } };
      }
      return { ok: false, executed: false, data: { status: result.status }, error: result.grund };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const freigabeMailDauerTool: NovaToolDefinition = {
  name: "freigabe_mail_dauer",
  description:
    "Dauerfreigabe für den Mailversand erteilen oder widerrufen. Nur auf ausdrückliche Anweisung des Nutzers (z. B. „Du darfst ab jetzt Mails senden, wenn ich ‚senden‘ sage“). Danach sendet mail_senden ohne Rückfrage, solange das Tageslimit nicht erreicht ist.",
  parameters: {
    type: "object",
    properties: {
      aktion: { type: "string", enum: ["erteilen", "widerrufen"] },
      max_pro_tag: { type: "integer", description: "Tageslimit gesendeter Mails; 0 = kein Limit. Wenn der Nutzer nichts sagt: 20." },
    },
    required: ["aktion", "max_pro_tag"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      if (str(args.aktion) === "widerrufen") {
        const count = await revokeStandingPolicy({ organizationId: ctx.organizationId, actionType: "mail.send" });
        return { ok: true, executed: count > 0, data: { widerrufen: count } };
      }
      const max = Math.max(0, Math.round(Number(args.max_pro_tag) || 0));
      const policy = await createStandingPolicy({
        organizationId: ctx.organizationId,
        name: "Mails senden, wenn Joachim „senden“ sagt",
        actionType: "mail.send",
        limits: max > 0 ? { maxPerDay: max } : {},
      });
      return { ok: true, executed: true, data: { freigabe: policy.name, max_pro_tag: max || "kein Limit" } };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const vorlageListeTool: NovaToolDefinition = {
  name: "vorlage_liste",
  description: "Listet die Mail-Vorlagen des Nutzers (Dateien in ~/Nova/vorlagen/) mit Betreff und Platzhaltern.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  async execute(_args, ctx) {
    try {
      const vorlagen = await importiereVorlagen(ctx.organizationId);
      return {
        ok: true,
        executed: false,
        data: {
          ordner: vorlagenDir(),
          vorlagen: vorlagen.map((vorlage) => ({ name: vorlage.name, betreff: vorlage.betreff, platzhalter: vorlage.platzhalter })),
        },
      };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const vorlageFuellenTool: NovaToolDefinition = {
  name: "vorlage_fuellen",
  description:
    "Füllt eine Vorlage mit Werten für ihre Platzhalter und liefert Betreff und Text. Fehlen Werte, kommen sie in fehlend zurück – dann nachfragen, nicht erfinden. Das Ergebnis danach mit mail_entwurf als Entwurf anlegen.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      werte: {
        type: "array",
        items: {
          type: "object",
          properties: { platzhalter: { type: "string" }, wert: { type: "string" } },
          required: ["platzhalter", "wert"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "werte"],
    additionalProperties: false,
  },
  execute(args) {
    try {
      const werte: Record<string, string> = {};
      for (const item of Array.isArray(args.werte) ? args.werte : []) {
        const entry = item as { platzhalter?: unknown; wert?: unknown };
        const key = str(entry.platzhalter);
        if (key) werte[key] = str(entry.wert);
      }
      const gefuellt = fuelleVorlage(str(args.name), werte);
      return { ok: gefuellt.fehlend.length === 0, executed: false, data: gefuellt };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const MAIL_TOOLS: NovaToolDefinition[] = [
  mailLesenTool,
  mailEntwurfTool,
  mailAntwortenTool,
  mailSendenTool,
  freigabeMailDauerTool,
  vorlageListeTool,
  vorlageFuellenTool,
];
