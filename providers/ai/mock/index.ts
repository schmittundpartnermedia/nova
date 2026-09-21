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

export class MockAIProvider implements AIProvider {
  id = "mock";
  name = "MockAIProvider";

  async generate(input: GenerateInput): Promise<GenerateOutput> {
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
      const result = {
        intent: sponsor ? "sponsor_acquisition" : "general",
        goal: sponsor
          ? `${count} potenzielle Sponsoren finden und Ansprache vorbereiten`
          : "Anfrage verstehen und mit verfügbaren Agenten beantworten",
        count,
        agents: sponsor
          ? ["research", "communication", "task", "project"]
          : ["project"],
        needsApproval: sponsor,
        mock: true,
      };
      return result as T;
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
