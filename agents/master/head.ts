import { gedaechtnisSystemBlock, ensureGedaechtnis } from "@/lib/gedaechtnis/store";
import { ensureVorlagenDir } from "@/lib/mail/vorlagen-files";
import { executeTool, listTools } from "@/services/tools/registry";
import type { AIProvider, HeadInputMessage, HeadToolSpec, HeadTurnOutput } from "@/types/ai";
import type { ToolContext } from "@/services/tools/types";

const MAX_TOOL_ROUNDS = 10;

export type HeadLoopResult = {
  reply: string;
  model: string;
  providerId: string;
  toolRounds: number;
  toolsExecuted: Array<{ name: string; executed: boolean }>;
  approvalId?: string;
  actionType?: string;
};

function toolSpecs(): HeadToolSpec[] {
  return listTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function buildInstructions(): string {
  ensureGedaechtnis();
  ensureVorlagenDir();
  const memory = gedaechtnisSystemBlock();
  return [
    "Du bist Nova, die Sprach-Oberfläche mit Gedächtnis auf dem Mac des Nutzers.",
    "Du sprichst Deutsch, knapp und klar, wie ein Assistent auf Augenhöhe – kein Assistenten-Jargon.",
    "Werkzeuge: Gedächtnis, Mail (lesen/entwurf/antworten/senden), Vorlagen, Dauerfreigabe Mail.",
    "Kein Scraper, kein Cursor, keine Bildschirmsteuerung in dieser Phase.",
    "",
    "Gedächtnis: Bei „Merk dir …“ immer gedaechtnis_schreiben. Datei firma|kunden|projekte.",
    "Mail lesen: „Check meine Mails“ → mail_lesen (modus neueste oder ungelesen).",
    "Antworten: mail_antworten oder mail_entwurf mit dem Auftrag; lies den Entwurf dem Nutzer vor (Antworttext).",
    "Kürzer/ändern: erneut mail_entwurf mit dem Änderungswunsch.",
    "Senden: nur wenn der Nutzer klar „senden“ sagt → mail_senden mit bestaetigt=true. Sonst nicht senden.",
    "Dauerfreigabe: Wenn der Nutzer sagt, du darfst ab jetzt Mails senden sobald er „senden“ sagt → freigabe_mail_dauer.",
    "Vorlagen: vorlage_liste / vorlage_fuellen; Texte kommen aus Vorlage oder vom Kopf, nicht aus fest verdrahteten Floskeln.",
    "Behaupte nie, eine Mail sei gesendet, wenn mail_senden nicht executed:true zurückgibt.",
    "Bei Unklarheit kurze Rückfrage – nicht raten.",
    "",
    memory,
  ].join("\n");
}

export async function runHeadLoop(input: {
  provider: AIProvider;
  model: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userRequest: string;
  context: ToolContext;
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
  let approvalId: string | undefined;
  let actionType: string | undefined;

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
      const data = result.data as { approvalId?: string; waitingApproval?: boolean } | undefined;
      if (data?.approvalId && data.waitingApproval) {
        approvalId = data.approvalId;
        actionType = "mail.send";
      }
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
    approvalId,
    actionType,
  };
}
