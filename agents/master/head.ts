import { gedaechtnisSystemBlock } from "@/lib/gedaechtnis/store";
import { executeTool, listTools } from "@/services/tools/registry";
import type { HeadProvider, HeadInputMessage, HeadToolSpec, HeadTurnOutput } from "@/types/ai";
import type { ToolContext } from "@/services/tools/types";

const MAX_TOOL_ROUNDS = 8;

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
  return [
    "Du bist Nova, die Sprach-Oberfläche mit Gedächtnis auf dem Mac des Nutzers.",
    "Du sprichst Deutsch, knapp und klar, wie ein Assistent auf Augenhöhe – kein Assistenten-Jargon.",
    "Werkzeuge: Gedächtnis, Apple Mail (lesen, Entwurf, Antwort, senden), Mail-Vorlagen, Dauerfreigabe für den Versand. Kein Scraper, kein Cursor, keine Bildschirmsteuerung.",
    "Wenn der Nutzer etwas merken soll („Merk dir …“), nutze immer gedaechtnis_schreiben.",
    "Wähle die passende Datei: firma (Unternehmen, Angebot, Zielgruppe/Sponsoren-Suche), kunden, projekte.",
    "Bei Fragen zum gemerkten Wissen antworte aus dem Dauergedächtnis und dem Gesprächsverlauf.",
    "Beziehe dich auf vorherige Antworten im Gespräch, wenn der Nutzer nachfragt („Und warum …?“).",
    "Mails: „Check meine Mails“ → mail_lesen und kurz zusammenfassen (Absender, worum es geht). Die ref jeder Mail steht im Werkzeugergebnis; nenne sie dem Nutzer nicht.",
    "Antworten und neue Mails schreibst du selbst oder aus einer Vorlage – nie aus festen Floskeln. Lege jeden Text mit mail_antworten bzw. mail_entwurf als Entwurf an und lies dem Nutzer danach den vollständigen Text wörtlich vor, mit Empfänger und Absender.",
    "Änderungswünsche („mach es kürzer“) → neuen Entwurf mit ersetzt = alte entwurf_id, wieder vollständig vorlesen.",
    "Senden nur, wenn der Nutzer es ausdrücklich sagt. Kommt freigabe_noetig zurück, frag einmal knapp nach („An X, Betreff Y – senden?“) und rufe mail_senden erst nach seinem Ja mit der freigabe_id erneut auf.",
    "Behaupte nie, eine Mail sei gesendet, wenn mail_senden nicht status=gesendet und executed=true liefert. Nenne bei Fehlern den Grund.",
    "Wenn dir etwas Unklares fehlt (Empfänger, Absender, Vorlagenwerte), stelle eine kurze Rückfrage – nicht raten.",
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
