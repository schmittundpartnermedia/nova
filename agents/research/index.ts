import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

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

export const researchAgent: NovaAgent = {
  definition: {
    id: "research",
    name: "Research Agent",
    description: "Webrecherche, Firmen, Personen, Ansprechpartner, Marktinformationen.",
    capabilities: ["web-research", "companies", "people", "contacts", "market", "sources"],
    requiredTools: ["search"],
    inputSchema: { query: "string", count: "number", projectId: "string?" },
    outputSchema: { companies: "Company[]", contacts: "Contact[]", mock: "boolean" },
    riskLevel: "low",
    implemented: true,
  },
  async run(input, context) {
    assertOrganizationId(context.organizationId);
    const count = Math.min(Number(input.count ?? 10), MOCK_SPONSORS.length);
    const selected = MOCK_SPONSORS.slice(0, count);
    const projectId = typeof input.projectId === "string" ? input.projectId : context.projectId;

    const companies = [];
    const contacts = [];

    for (const item of selected) {
      const existing = await prisma.company.findFirst({
        where: {
          organizationId: context.organizationId,
          name: item.name,
        },
      });

      const company =
        existing ??
        (await prisma.company.create({
          data: {
            organizationId: context.organizationId,
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
          organizationId: context.organizationId,
          companyId: company.id,
          firstName: item.firstName,
          lastName: item.lastName,
        },
      });

      const contact =
        contactExisting ??
        (await prisma.contact.create({
          data: {
            organizationId: context.organizationId,
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
      },
    };
  },
};
