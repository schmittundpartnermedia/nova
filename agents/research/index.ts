import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { isRealConnectorEnabled } from "@/connectors/registry";
import { runResearchWorkflow } from "@/agents/research/workflow";

export const researchAgent: NovaAgent = {
  definition: {
    id: "research",
    name: "Research Agent",
    description: "Echte Webrecherche mit Search Provider, Quellenbewertung und Fetch. Keine erfundenen Live-Treffer.",
    capabilities: ["web-research", "companies", "people", "contacts", "market", "sources", "current-facts"],
    requiredTools: ["search"],
    inputSchema: { query: "string", count: "number", projectId: "string?" },
    outputSchema: { answer: "string", sourceIds: "string[]", mock: "boolean" },
    riskLevel: "low",
    implemented: true,
  },
  async run(input, context) {
    assertOrganizationId(context.organizationId);
    const projectId = typeof input.projectId === "string" ? input.projectId : context.projectId;
    const query = String(input.query ?? context.userRequest ?? context.goal ?? "").trim();

    const searchConnected = await isRealConnectorEnabled(context.organizationId, "search");
    if (!searchConnected) {
      return {
        ok: true,
        mock: false,
        summary: "Kein echter Search Connector verbunden. Ich kann keine aktuellen Informationen prüfen und erfinde keine Treffer.",
        data: {
          companyIds: [],
          contactIds: [],
          sourceIds: [],
          mock: false,
          searchConnected: false,
          invented: false,
          answer: "Ich kann die aktuelle Information gerade nicht zuverlässig prüfen.",
        },
      };
    }

    const result = await runResearchWorkflow({
      context: { ...context, projectId },
      query,
      allowLocal: input.allowLocal === true,
      persistCompanies: input.persistCompanies !== false,
    });

    const companies = await prisma.company.findMany({
      where: {
        organizationId: context.organizationId,
        sourceId: { in: result.sourceIds.length ? result.sourceIds : ["__none__"] },
      },
      select: { id: true },
    });

    return {
      ok: result.ok,
      mock: false,
      summary: result.ok
        ? result.answer
        : result.answer || "Ich kann die aktuelle Information gerade nicht zuverlässig prüfen.",
      data: {
        companyIds: companies.map((item) => item.id),
        contactIds: [],
        sourceIds: result.sourceIds,
        mock: false,
        searchConnected: result.searchConnected,
        invented: false,
        answer: result.answer,
        asOf: result.asOf ?? null,
        confidence: result.confidence,
        queries: result.queries,
        sources: result.fetched.map((page) => ({
          url: page.canonicalUrl,
          title: page.title,
          domain: page.domain,
          publishedAt: page.publishedAt ?? null,
        })),
        claims: result.claims,
        contradictions: result.contradictions,
        companies: result.companies,
        memoryCandidates: result.memoryCandidates,
        injectionSuspected: result.injectionSuspected,
        usedPlaywright: result.usedPlaywright,
        failureReason: result.failureReason ?? null,
        knowledgeKind: result.knowledgeKind,
      },
    };
  },
};
