import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { isRealConnectorEnabled } from "@/connectors/registry";
import { runResearchWorkflow } from "@/agents/research/workflow";

const MOCK_SPONSORS = [
  { name: "Nordlicht Industrie GmbH", industry: "Maschinenbau", website: "https://example.invalid/nordlicht", firstName: "Clara", lastName: "Berg", role: "Leiterin Sponsoring" },
  { name: "Rheinwerk Digital AG", industry: "Software", website: "https://example.invalid/rheinwerk", firstName: "Jonas", lastName: "Hartmann", role: "Head of Partnerships" },
  { name: "Alpenblick Versicherungen", industry: "Versicherung", website: "https://example.invalid/alpenblick", firstName: "Mira", lastName: "Keller", role: "Marketing Director" },
  { name: "Hansekraft Energie", industry: "Energie", website: "https://example.invalid/hansekraft", firstName: "Lars", lastName: "Olsen", role: "CSR Lead" },
  { name: "Schwarzwald Nutrition", industry: "Lebensmittel", website: "https://example.invalid/schwarzwald", firstName: "Elena", lastName: "Vogt", role: "Brand Partnerships" },
  { name: "Ostsee Logistics", industry: "Logistik", website: "https://example.invalid/ostsee", firstName: "Tim", lastName: "Krüger", role: "Geschäftsleitung" },
  { name: "Mainhattan Finance", industry: "Finanzdienstleistung", website: "https://example.invalid/mainhattan", firstName: "Sara", lastName: "Nguyen", role: "Communications" },
  { name: "Bayerwald Outdoor", industry: "Sport/Outdoor", website: "https://example.invalid/bayerwald", firstName: "Felix", lastName: "Maier", role: "Sponsoring Manager" },
  { name: "Küstenwerk Media", industry: "Medien", website: "https://example.invalid/kuestenwerk", firstName: "Nina", lastName: "Holm", role: "Kooperationsleitung" },
  { name: "Silberstein Mobility", industry: "Mobilität", website: "https://example.invalid/silberstein", firstName: "Omar", lastName: "Farid", role: "Head of Brand" },
  { name: "Lindenhof Health", industry: "Gesundheit", website: "https://example.invalid/lindenhof", firstName: "Greta", lastName: "Lang", role: "PR & Partnerships" },
  { name: "Nordstern Bau", industry: "Bau", website: "https://example.invalid/nordstern", firstName: "Paul", lastName: "Richter", role: "Unternehmenskommunikation" },
];

async function runMockCatalog(input: Record<string, unknown>, organizationId: string, projectId?: string) {
  const count = Math.min(Number(input.count ?? 10), MOCK_SPONSORS.length);
  const selected = MOCK_SPONSORS.slice(0, count);
  const companies = [];
  const contacts = [];

  for (const item of selected) {
    const existing = await prisma.company.findFirst({
      where: { organizationId, name: item.name },
    });
    const company =
      existing ??
      (await prisma.company.create({
        data: {
          organizationId,
          projectId,
          name: item.name,
          industry: item.industry,
          website: item.website,
          notes: "MOCK: Keine echte Recherche. Fiktives Demounternehmen.",
          isMock: true,
        },
      }));

    const contactExisting = await prisma.contact.findFirst({
      where: {
        organizationId,
        companyId: company.id,
        firstName: item.firstName,
        lastName: item.lastName,
      },
    });
    const contact =
      contactExisting ??
      (await prisma.contact.create({
        data: {
          organizationId,
          companyId: company.id,
          projectId,
          firstName: item.firstName,
          lastName: item.lastName,
          role: item.role,
          email: `${item.firstName.toLowerCase()}.${item.lastName.toLowerCase()}@example.invalid`,
          notes: "MOCK: Kein echter Ansprechpartner. Fiktive Kontaktdaten.",
          isMock: true,
        },
      }));

    companies.push(company);
    contacts.push(contact);
  }

  return {
    ok: true,
    mock: true,
    summary: `${companies.length} Mock-Unternehmen und ${contacts.length} Mock-Ansprechpartner vorbereitet. Keine echte Recherche.`,
    data: {
      companyIds: companies.map((c) => c.id),
      contactIds: contacts.map((c) => c.id),
      mock: true,
      searchConnected: false,
      invented: false,
    },
  };
}

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

    if (input.allowMockCatalog === true && process.env.NOVA_ALLOW_MOCK_CATALOG === "1") {
      return runMockCatalog(input, context.organizationId, projectId);
    }

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
