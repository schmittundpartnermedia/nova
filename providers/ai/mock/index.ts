import type {
  AIProvider,
  GenerateInput,
  GenerateOutput,
  HealthCheckResult,
  ReasonInput,
  ReasonOutput,
  StreamChunk,
  StructuredInput,
  ToolCallInput,
  ToolCallOutput,
} from "@/types/ai";
import { detectDialogMove } from "@/lib/dialog/intent";

function detectSponsorIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    (lower.includes("sponsor") || lower.includes("sponsoren")) &&
    (lower.includes("finde") || lower.includes("such") || lower.includes("recherch") || lower.includes("bereit"))
  );
}

function extractCount(text: string, fallback = 10): number {
  const match = text.match(/(\d+)\s+(potenzielle\s+)?sponsor/i);
  if (match) return Math.min(50, Number(match[1]));
  return fallback;
}

function extractUserTurn(prompt: string): string {
  const match = prompt.match(/Benutzer:\s*([^\n]+)/);
  return (match?.[1] ?? prompt).trim();
}

function socialReply(act: string): string {
  if (act === "wish") return "Danke, dir auch.";
  if (act === "thanks") return "Gern.";
  if (act === "greeting") return "Hey, ich bin da.";
  if (act === "farewell") return "Bis bald.";
  return "Alles klar.";
}

function conversationalKnowledge(prompt: string, user: string): string | null {
  if (!/Knowledge \(kompakt, mit Quellen\):/.test(prompt)) return null;
  if (!/\?|\b(was|wer|wo|wann|wie|welche|warum|preis|angebot|deadline|unterlagen|pdf|entscheid)\b/i.test(user)) {
    return null;
  }
  const block = prompt.split("Knowledge (kompakt, mit Quellen):")[1]?.split(/\n\n[A-ZÄÖÜ]/)[0] ?? "";
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  if (!lines.length) return null;
  const preferred = lines.filter((line) => /\[(PRICE|DECISION|PERSON|DEADLINE|METRIC|PRODUCT|CONTACT)\]/.test(line));
  const chosen = (preferred.length ? [...preferred, ...lines.filter((line) => !preferred.includes(line))] : lines)
    .slice(0, 6)
    .map((line) => line.replace(/^- \[[^\]]+\]\s*/, ""));
  return `Das steht in den Unterlagen: ${chosen.join(" ")}`;
}

export class MockAIProvider implements AIProvider {
  id = "mock";
  name = "MockAIProvider";

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const user = extractUserTurn(input.prompt);
    const dialog = detectDialogMove(user);
    if (dialog.kind === "social") {
      return {
        text: socialReply(dialog.act),
        provider: this.id,
        model: "mock-master",
      };
    }

    const knowledge = conversationalKnowledge(input.prompt, user);
    if (knowledge) {
      return {
        text: knowledge,
        provider: this.id,
        model: "mock-master",
      };
    }

    if (detectSponsorIntent(input.prompt)) {
      const count = extractCount(input.prompt);
      return {
        text: `Verstanden. Ich plane eine Mock-Sponsorenakquise für ${count} Kandidaten und bereite Anschreiben vor. Es findet keine echte Recherche und kein Versand statt.`,
        provider: this.id,
        model: "mock-master",
      };
    }

    return {
      text: "Ich habe die Anfrage aufgenommen. In V1 kann ich den Sponsoren-Demo-Workflow ausführen. Andere Aufgaben plane ich, führe sie aber noch nicht vollständig aus.",
      provider: this.id,
      model: "mock-master",
    };
  }

  async reason(input: ReasonInput): Promise<ReasonOutput> {
    if (detectSponsorIntent(input.goal) || detectSponsorIntent(input.context)) {
      return {
        reasoning:
          "Ziel ist Sponsorenakquise. Memory und Projektkontext laden, dann Research, Communication, Task und Approval kombinieren. Ergebnisse als Mock kennzeichnen.",
        plan: [
          "Projekt- und Memory-Kontext laden",
          "Kandidaten recherchieren (Mock)",
          "Ansprechpartner zuordnen (Mock)",
          "Anschreiben personalisieren (Entwurf)",
          "Qualität prüfen",
          "Freigabe für späteren Versand anfordern",
          "Memory, Relationen und Archiv aktualisieren",
        ],
        provider: this.id,
      };
    }

    return {
      reasoning: "Allgemeine Anfrage. Master wählt verfügbare Agenten dynamisch anhand der Registry.",
      plan: ["Intent verstehen", "Kontext laden", "Passende Agenten wählen", "Ergebnis zusammenfassen"],
      provider: this.id,
    };
  }

  async structuredOutput<T>(input: StructuredInput): Promise<T> {
    if (input.schemaName === "master-plan") {
      const sponsor = detectSponsorIntent(input.prompt);
      const count = extractCount(input.prompt);
      const lower = input.prompt.toLowerCase();
      const remember = lower.includes("merk dir") || lower.includes("merke dir");
      const mail = lower.includes("mail") || lower.includes("anschreiben");
      const task = lower.includes("aufgabe");
      const calendar = lower.includes("termin") || lower.includes("kalender");
      const watch = lower.includes("was steht an") || lower.includes("überfällig") || lower.includes("woran muss ich");
      const agents: string[] = [];
      if (sponsor) agents.push("research", "communication", "task", "project");
      else {
        if (mail) agents.push("communication");
        if (task) agents.push("task");
        if (calendar) agents.push("calendar");
        if (watch) agents.push("watch");
        if (lower.includes("projekt")) agents.push("project");
      }
      const result = {
        intent: sponsor
          ? "sponsor_acquisition"
          : remember
            ? "remember"
            : mail
              ? "communication"
              : calendar
                ? "calendar"
                : watch
                  ? "watch"
                  : task
                    ? "task"
                    : "direct_answer",
        goal: sponsor
          ? `${count} potenzielle Sponsoren finden und Ansprache vorbereiten`
          : "Anfrage verstehen und mit verfügbaren Agenten beantworten",
        count,
        agents,
        needsApproval: sponsor || mail,
        remember,
        searchRequired: sponsor || lower.includes("finde aktuelle"),
        externalAction: sponsor || mail ? "mail.send" : calendar ? "calendar" : "none",
        mock: true,
        memoryItems: remember
          ? [{ type: "fact", title: "Merkhilfe", content: input.prompt }]
          : [],
      };
      return result as T;
    }

    if (input.schemaName === "durable-memory") {
      return { persist: false, items: [] } as T;
    }

    if (input.schemaName === "conversation-continuity") {
      return {
        digest: "Fortlaufendes Gespräch mit Joachim. Ton auf Augenhöhe.",
        relation: "Knapp, menschlich, ohne Assistenten-Jargon.",
        openThreads: "",
        insights: [],
      } as T;
    }

    return { mock: true } as T;
  }

  async toolCall(_input: ToolCallInput): Promise<ToolCallOutput> {
    return { text: "MockAIProvider führt keine echten Tool-Calls aus." };
  }

  async *stream(input: GenerateInput): AsyncIterable<StreamChunk> {
    const output = await this.generate(input);
    yield { delta: output.text, done: true };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      ok: true,
      provider: this.id,
      message: "MockAIProvider ist aktiv. Kein externer KI-Anbieter verbunden.",
    };
  }
}
