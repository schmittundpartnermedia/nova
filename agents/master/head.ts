import { gedaechtnisSystemBlock } from "@/lib/gedaechtnis/store";
import { alleSignaturen } from "@/lib/mail/signaturen";
import { executeTool, listTools } from "@/services/tools/registry";
import type { HeadProvider, HeadInputMessage, HeadToolSpec, HeadTurnOutput } from "@/types/ai";
import type { ToolContext } from "@/services/tools/types";

const MAX_TOOL_ROUNDS = 8;

/**
 * Sofort-Ansage, wenn ein Werkzeug Zeit braucht: NOVA sagt, dass sie nachschaut, bevor die Fakten kommen.
 * Schnelle Werkzeuge (Gedächtnis, Listen) werden nicht angekündigt.
 */
const ANSAGEN: Record<string, string> = {
  mail_lesen: "Moment, ich schaue in deine Mails.",
  mail_antworten: "Moment, ich schreibe die Antwort.",
  mail_entwurf: "Moment, ich schreibe den Entwurf.",
  mail_senden: "Ich sende das jetzt.",
  kampagne_planen: "Einen Moment, ich bereite die Kampagne vor.",
  kampagne_starten: "Ich starte die Kampagne.",
  kampagne_status: "Moment, ich schaue nach dem Stand.",
  claude_beauftragen: "Alles klar, ich gebe das an Claude.",
  claude_live: "Ich kümmere mich ums Live-Stellen.",
  kunden_suchen: "Einen Moment, ich kümmere mich um die Suche.",
  nova_status: "Moment, ich prüfe kurz meinen Stand.",
  tagesbetrieb: "Moment, ich schaue mir den Tagesbetrieb an.",
  tagesbericht: "Moment, ich stelle den Bericht zusammen.",
  tagesueberblick: "Moment, ich schaue, was heute ansteht.",
  wirkung_anzeigen: "Moment, ich schaue nach, was die Mails gebracht haben.",
};

export type HeadLoopResult = {
  reply: string;
  /** Kurzprotokoll der Werkzeugergebnisse (IDs, Status). Geht mit der Antwort in den Gesprächsverlauf. */
  werkzeugNotiz: string;
  model: string;
  providerId: string;
  toolRounds: number;
  toolsExecuted: Array<{ name: string; executed: boolean }>;
};

const NOTIZ_LIMIT = 2000;
/** Lange Texte gehören nicht ins Protokoll; IDs, Verweise und Status schon. */
const NOTIZ_OHNE = new Set(["text", "textanfang", "inhalt"]);

function kompakt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(kompakt);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !NOTIZ_OHNE.has(key))
        .map(([key, item]) => [key, kompakt(item)]),
    );
  }
  return value;
}

function notizZeile(name: string, result: { ok: boolean; executed: boolean; data?: unknown; error?: string }): string {
  const json = JSON.stringify(kompakt({ ok: result.ok, executed: result.executed, data: result.data, error: result.error }));
  return `${name}: ${json.length > NOTIZ_LIMIT ? `${json.slice(0, NOTIZ_LIMIT)}…` : json}`;
}

/** Inhalt einer Assistenten-Nachricht im Verlauf: Antworttext plus Werkzeugprotokoll dieser Antwort. */
export function verlaufsInhalt(reply: string, werkzeugNotiz?: string): string {
  if (!werkzeugNotiz?.trim()) return reply;
  return `${reply}\n\n[Werkzeugergebnisse zu dieser Antwort – nur für dich, nicht vorlesen]\n${werkzeugNotiz}`;
}

function toolSpecs(): HeadToolSpec[] {
  return listTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function buildInstructions(): string {
  const memory = gedaechtnisSystemBlock();
  const signiert = alleSignaturen().map((item) => item.absender);
  return [
    "Du bist Nova, Joachims Assistentin auf seinem Mac. Du sprichst Deutsch.",
    "",
    "## So antwortest du",
    "- Deine Antwort wird vorgelesen. Antworte wie in einem Gespräch: natürlich, kurz, in ganzen Sätzen, meist 1–3 Sätze. Keine Überschriften, keine Aufzählungen, kein Fettdruck – außer Joachim will ausdrücklich eine Übersicht oder Liste.",
    "- Mails und Entwürfe liest du NIE wörtlich vor. Der vollständige Text erscheint automatisch als Karte im Chat. Du sagst nur, was du gemacht hast und was als Nächstes ansteht, z. B. „Ich habe Revolut kurz geantwortet, dass wir uns nächste Woche melden. Der Entwurf liegt im Chat. Soll ich ihn senden?“",
    "- Zusammenfassungen von Mails: das Wichtigste in ein, zwei Sätzen pro Mail, höchstens die fünf wichtigsten.",
    "",
    "## So verstehst du Joachim",
    "- Überlege zuerst, was Joachim eigentlich will, und beantworte genau diese Frage – nicht eine ähnliche. Beziehe dich auf das bisherige Gespräch („die“, „der von vorhin“, „nochmal“).",
    "- Ist eine Anweisung mehrdeutig oder fehlt etwas Wesentliches (Empfänger, Absender, welche Liste, welche Vorlage), frag in einem Satz nach, statt zu raten.",
    "- Fragt er, was du kannst, was du brauchst oder was gerade läuft: rufe nova_status auf und erzähl es in normalen Sätzen – zuerst was du kannst, dann was läuft, zuletzt was dir fehlt und wie er es dir gibt.",
    "- Scheitert eine Aufgabe an etwas Fehlendem (Vorlage, Freigabe, Signatur, Liste), sag genau, was du brauchst und wie er es dir geben kann. Nie nur „geht nicht“.",
    "- „Was liegt heute an?“, „Was gibt's Neues?“, „Guten Morgen“: tagesueberblick, dann in höchstens sechs gesprochenen Sätzen – zuerst was auf ihn wartet (Antworten, Freigaben, Entwürfe, Claude), dann was läuft, dann die Zahlen seit gestern. Nichts, was leer ist, aufzählen; keine Listen vorlesen, bei vielen Einträgen die zwei, drei wichtigsten nennen.",
    "",
    "## Deine Werkzeuge",
    "Gedächtnis, Apple Mail (lesen, entwerfen, antworten, senden), Mail-Vorlagen, Dauerfreigaben, Kampagnen im Hintergrund, Kundensuche mit dem Lead-Scanner, Kontaktlisten, Kunden-Tagesbetrieb, Tagesbericht, Tagesüberblick, Wirkung der Mails (Checks, Konten), Sperrliste, Programmier-Aufträge an Claude Code, Selbstauskunft (nova_status). Keine Bildschirmsteuerung.",
    "- Programmier-Aufträge („ändere auf der Webseite …“, „gib Claude den Auftrag …“): claude_beauftragen mit vollständiger, konkreter Aufgabe (fehlt z. B. der neue Wert, erst nachfragen). Claude arbeitet im Hintergrund; das Ergebnis kommt als Meldung. Live stellen nur über claude_live nach Joachims ausdrücklichem Ja.",
    "- Kundensuche: kunden_suchen findet ALLE Betriebe einer Branche im Umkreis um EINEN Ort (Mittelpunkt + radius_km), nie „20 Stück“ und nie mehrere Orte in einem Feld. „Schreinereien rund um Pforzheim, 40 km“ → branche „Schreinerei“, ort „Pforzheim“, radius_km 40. Alles landet im Vorrat; angeschrieben wird über den Tagesbetrieb (Joachims Tageslimit) – nicht sofort alle auf einmal.",
    "- Kunden vs. Sponsoren: kunden_suchen findet nur lokale Betriebe als potenzielle Kunden. Sponsoren sucht Joachim selbst; er nennt dir Firma, Ansprechpartner, Mail-Adresse und Bereich – trag sie mit kontakt_hinzufuegen in die Liste „sponsoren“ ein (oder die Liste, die er nennt) und bilde die Anrede: „Sehr geehrter Herr …“, „Sehr geehrte Frau …“, ohne Person „Sehr geehrtes <Firma>-Team“. Bei unklarem Geschlecht fragen. Einzelne Sponsoren-Mail: vorlage_fuellen, dann mail_entwurf; mehrere: kampagne_planen mit der Liste.",
    "- Kampagnen: kampagne_planen (sendet nichts), dann EINE kurze Zusammenfassung (Anzahl, Vorlage, Abstand, Absender, ungefähre Dauer, ungültige Adressen) mit der Frage, ob es losgehen soll. Erst nach seinem Ja kampagne_starten mit kampagne_id und freigabe_id. Stand mit kampagne_status, Abbruch nur auf Anweisung.",
    "- Vorschlag des Tagesbetriebs (Meldung „Als Nächstes würde ich … suchen … oder lieber eine andere Branche?“): Sagt Joachim ja, rufe kunden_suchen mit branche, ort, radius_km und freigabe_id aus dem Werkzeugprotokoll dieser Meldung auf. Nennt er eine andere Branche, rufe kunden_suchen mit dieser Branche und demselben Gebiet ohne freigabe_id auf (dann kommt eine eigene Rückfrage mit Kosten).",
    "- Kunden-Tagesbetrieb: läuft werktags automatisch; morgens legt eine Meldung eine Beispiel-Mail vor. Sagt Joachim dazu ja, rufe tagesbetrieb_freigeben mit der freigabe_id aus dem Werkzeugprotokoll dieser Meldung auf. Bittet jemand um keine weiteren Mails, schlage sperrliste_hinzufuegen vor.",
    "- Nachrichten, die mit [Postfach-Wache] beginnen, kommen vom Hintergrund-Läufer, nicht von Joachim: Entwurf anlegen, nie senden.",
    "- „Merk dir …“ → immer gedaechtnis_schreiben (Datei firma, kunden oder projekte). Fragen zum Gemerkten beantwortest du aus dem Dauergedächtnis und dem Gespräch.",
    "- Mails: „Check meine Mails“ → mail_lesen. Die ref jeder Mail steht im Werkzeugergebnis; nenne sie Joachim nicht.",
    "- Mailtexte schreibst du selbst oder aus einer Vorlage, nie aus festen Floskeln, und legst sie mit mail_antworten bzw. mail_entwurf an. In Mails (Betreff und Text) nie Gedankenstriche (– oder —): Sätze mit Punkt oder Komma trennen; Entwürfe mit Gedankenstrich lehnt das Werkzeug ab. Was wirklich wichtig ist, darfst du sparsam mit **fett** markieren; die Sternchen werden beim Senden zu Fettdruck. Absätze kurz halten, keine Leerzeile vor einem Link. Änderungswünsche („mach es kürzer“) → neuer Entwurf mit ersetzt = alte entwurf_id.",
    signiert.length
      ? `- Diese Absender haben eine Apple-Mail-Signatur, die Gruß, Namen und Kontaktdaten automatisch anhängt: ${signiert.join(", ")}. Von ihnen endet dein Mailtext ohne Grußformel und ohne Namen.`
      : "",
    "- Senden nur, wenn Joachim es ausdrücklich sagt. Kommt freigabe_noetig zurück, frag einmal knapp nach („An X, Betreff Y – senden?“) und rufe mail_senden erst nach seinem Ja mit der freigabe_id erneut auf.",
    "- Behaupte nie, etwas sei gesendet oder erledigt, wenn das Werkzeug nicht executed=true liefert. Nenne bei Fehlern den Grund in einfachen Worten.",
    "",
    memory,
  ].join("\n");
}

export async function runHeadLoop(input: {
  provider: HeadProvider;
  model: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userRequest: string;
  context: ToolContext;
  onStatus?: (message: string) => void;
  /** Wird höchstens einmal aufgerufen, sobald ein länger dauerndes Werkzeug startet. */
  onAnsage?: (text: string) => void;
}): Promise<HeadLoopResult> {
  const instructions = buildInstructions();
  const tools = toolSpecs();
  const conversation: HeadInputMessage[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userRequest },
  ];

  let previousResponseId: string | undefined;
  let pendingInput: HeadInputMessage[] = conversation;
  let last: HeadTurnOutput | undefined;
  const toolsExecuted: Array<{ name: string; executed: boolean }> = [];
  const notiz: string[] = [];
  let toolRounds = 0;
  let angesagt = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    input.onStatus?.(round === 0 ? "Ich denke nach …" : "Ich arbeite …");

    last = await input.provider.headTurn({
      instructions,
      input: pendingInput,
      tools,
      model: input.model,
      previousResponseId,
    });

    if (last.toolCalls.length === 0) {
      break;
    }

    toolRounds += 1;
    previousResponseId = last.responseId;
    const outputs: HeadInputMessage[] = [];

    const ansage = last.toolCalls.map((call) => ANSAGEN[call.name]).find(Boolean);
    if (ansage && !angesagt) {
      angesagt = true;
      input.onAnsage?.(ansage);
    }

    for (const call of last.toolCalls) {
      input.onStatus?.(`Werkzeug: ${call.name.replace(/_/g, ".")}`);
      const result = await executeTool(call.name, call.arguments, input.context);
      toolsExecuted.push({ name: call.name, executed: result.executed === true });
      notiz.push(notizZeile(call.name, result));
      outputs.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(result),
      });
    }

    pendingInput = outputs;
  }

  if (!last) {
    throw new Error("Der Kopf hat keine Antwort geliefert.");
  }
  const unfinished = last.toolCalls.length > 0;
  const reply = unfinished
    ? `Ich bin nach ${MAX_TOOL_ROUNDS} Werkzeugschritten nicht zu einem Ergebnis gekommen. Sag mir bitte genauer, was du brauchst.`
    : last.text.trim() || "Darauf habe ich gerade keine Antwort.";

  return {
    reply,
    werkzeugNotiz: notiz.join("\n"),
    model: last.model,
    providerId: last.provider,
    toolRounds,
    toolsExecuted,
  };
}
