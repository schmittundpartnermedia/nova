import type { NovaAgent } from "@/types/agents";

function stub(id: string, name: string, description: string, capabilities: string[], riskLevel: "low" | "medium" | "high"): NovaAgent {
  return {
    definition: {
      id,
      name,
      description,
      capabilities,
      requiredTools: [],
      inputSchema: {},
      outputSchema: {},
      riskLevel,
      implemented: false,
    },
    async run() {
      return {
        ok: false,
        summary: `${name} ist in V1 nur als Registry-Eintrag vorbereitet.`,
        data: { implemented: false },
      };
    },
  };
}

export const documentAgent = stub(
  "document",
  "Document Agent",
  "Dokumente finden, lesen, erstellen, organisieren.",
  ["documents", "files"],
  "medium",
);

export const meetingAgent = stub(
  "meeting",
  "Meeting Agent",
  "Meetingvorbereitung, Memos, Entscheidungen, Aufgaben aus Meetings.",
  ["meetings", "memos", "decisions"],
  "medium",
);

export const qualityAgent = stub(
  "quality",
  "Quality Agent",
  "Wichtige Ergebnisse prüfen, Inkonsistenzen erkennen, Qualitätskontrolle.",
  ["quality", "review", "consistency"],
  "low",
);
