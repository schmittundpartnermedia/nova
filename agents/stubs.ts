import type { NovaAgent } from "@/types/agents";
import { runKnowledgeAgent, searchOrganizationKnowledge } from "@/agents/knowledge";
import { getAgent } from "@/agents/registry";

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

export const documentAgent: NovaAgent = {
  definition: {
    id: "document",
    name: "Document Agent",
    description: "Dokumente finden, lesen und aus dem NOVA-Wissen beantworten.",
    capabilities: ["documents", "files", "knowledge"],
    requiredTools: [],
    inputSchema: { userRequest: "string" },
    outputSchema: { executed: "boolean" },
    riskLevel: "medium",
    implemented: true,
  },
  async run(input, context) {
    const request = String(input.userRequest ?? context.userRequest ?? "");
    const result = await runKnowledgeAgent({
      organizationId: context.organizationId,
      userRequest: request,
      jobId: context.jobId,
      projectId: context.projectId,
      query: request,
      paths: Array.isArray(input.paths) ? (input.paths as string[]) : undefined,
    });
    if (!result.ok && /kein zulässiger pfad|pfad fehlt/i.test(result.reply ?? result.summary ?? "")) {
      const hits = await searchOrganizationKnowledge(context.organizationId, request, context.projectId);
      if (hits.length) {
        const lines = hits
          .slice(0, 8)
          .map((hit) => `- ${hit.title || hit.sourceName || "Dokument"}: ${hit.content.slice(0, 160)}`);
        return {
          ok: true,
          summary: `Gefundene Dokumente:\n${lines.join("\n")}`,
          data: { executed: true, action: "search", count: hits.length, reply: `Im NOVA-Wissen finde ich dazu:\n${lines.join("\n")}` },
        };
      }
      return {
        ok: true,
        summary: "Keine Dokumente gefunden. Lade Dateien über Hochladen oder nenne einen Pfad.",
        data: {
          executed: true,
          action: "empty",
          reply:
            "Dokumente liegen in NOVA unter Wissen. Lade Dateien über Hochladen hoch, oder sag mir einen lokalen Pfad zum Importieren.",
        },
      };
    }
    return {
      ok: result.ok,
      summary: result.summary,
      data: {
        executed: result.ok,
        action: "knowledge",
        reply: result.reply,
        importId: result.importId ?? null,
        cancelled: Boolean(result.cancelled),
      },
    };
  },
};

export const meetingAgent: NovaAgent = {
  definition: {
    id: "meeting",
    name: "Meeting Agent",
    description: "Meetings und Termine im NOVA-Kalender vorbereiten und listen.",
    capabilities: ["meetings", "memos", "decisions", "calendar"],
    requiredTools: ["calendar"],
    inputSchema: { userRequest: "string" },
    outputSchema: { executed: "boolean" },
    riskLevel: "medium",
    implemented: true,
  },
  async run(input, context) {
    const request = String(input.userRequest ?? context.userRequest ?? "");
    const calendar = getAgent("calendar");
    if (!calendar) {
      return {
        ok: false,
        summary: "Meetings laufen über den NOVA-Kalender, der gerade nicht verfügbar ist.",
        data: { executed: false },
      };
    }
    const normalized = /\b(meetings?|besprechung(?:en)?|memo)\b/i.test(request)
      ? request.replace(/\b(meetings?|besprechung(?:en)?)\b/gi, "Termine")
      : /\b(termine?|kalender)\b/i.test(request)
        ? request
        : `Zeige Termine ${request}`;
    const result = await calendar.run({ ...input, userRequest: normalized }, context);
    const summary = String(result.summary ?? "");
    return {
      ok: result.ok,
      summary: summary.includes("NOVA-Kalender")
        ? summary
        : `${summary}\n\nMeetings sind in NOVA die Termine im lokalen Kalender — nicht Apple/Google.`,
      data: { executed: result.ok, action: "calendar", ...(result.data ?? {}) },
    };
  },
};

export const qualityAgent = stub(
  "quality",
  "Quality Agent",
  "Wichtige Ergebnisse prüfen, Inkonsistenzen erkennen, Qualitätskontrolle.",
  ["quality", "review", "consistency"],
  "low",
);
