import { gedaechtnisSystemBlock } from "@/lib/gedaechtnis/store";
import { executeTool, listTools } from "@/services/tools/registry";
import type { AIProvider, HeadInputMessage, HeadToolSpec, HeadTurnOutput } from "@/types/ai";

const MAX_TOOL_ROUNDS = 8;

export type HeadLoopResult = {
  reply: string;
  model: string;
  providerId: string;
  toolRounds: number;
  toolsExecuted: Array<{ name: string; executed: boolean }>;
};

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
    "Du hast in dieser Phase nur Gedächtnis-Werkzeuge. Keine Mails, kein Scraper, kein Cursor, keine Bildschirmsteuerung.",
    "Wenn der Nutzer etwas merken soll („Merk dir …“), nutze immer gedaechtnis_schreiben.",
    "Wähle die passende Datei: firma (Unternehmen, Angebot, Zielgruppe/Sponsoren-Suche), kunden, projekte.",
    "Bei Fragen zum gemerkten Wissen antworte aus dem Dauergedächtnis und dem Gesprächsverlauf.",
    "Beziehe dich auf vorherige Antworten im Gespräch, wenn der Nutzer nachfragt („Und warum …?“).",
    "Wenn dir etwas Unklares fehlt, stelle eine kurze Rückfrage – nicht raten.",
    "Erfinde keine externen Aktionen. Behaupte nicht, etwas gesendet oder gesucht zu haben.",
    "",
    memory,
  ].join("\n");
}

export async function runHeadLoop(input: {
  provider: AIProvider;
  model: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userRequest: string;
  onStatus?: (message: string) => void;
}): Promise<HeadLoopResult> {
  if (!input.provider.headTurn) {
    throw new Error("Dieser KI-Anbieter unterstützt keinen Kopf mit Werkzeugen (headTurn).");
  }

  const instructions = buildInstructions();
  const tools = toolSpecs();
  const conversation: HeadInputMessage[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userRequest },
  ];

  let previousResponseId: string | undefined;
  let pendingInput: HeadInputMessage[] = conversation;
  let last: HeadTurnOutput | null = null;
  const toolsExecuted: Array<{ name: string; executed: boolean }> = [];
  let toolRounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    input.onStatus?.(round === 0 ? "Ich denke nach …" : "Ich arbeite mit dem Gedächtnis …");

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
      const result = await executeTool(call.name, call.arguments);
      toolsExecuted.push({ name: call.name, executed: result.executed === true });
      outputs.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(result),
      });
    }

    pendingInput = outputs;
  }

  const reply =
    last?.text?.trim() ||
    (toolsExecuted.some((t) => t.executed)
      ? "Erledigt."
      : "Ich konnte gerade keine Antwort erzeugen.");

  return {
    reply,
    model: last?.model ?? input.model,
    providerId: last?.provider ?? input.provider.id,
    toolRounds,
    toolsExecuted,
  };
}
