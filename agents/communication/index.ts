import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

function draftBody(input: {
  firstName: string;
  company: string;
  projectName: string;
}) {
  return `Guten Tag ${input.firstName},

im Rahmen von ${input.projectName} prüfen wir passende Partnerschaften. ${input.company} wirkt für uns relevant.

Ich würde das gern kurz und konkret vorstellen – ohne langen Pitch.

Wäre ein kurzes Gespräch in den nächsten zwei Wochen denkbar?

Freundliche Grüße
Joachim

---
Dies ist ein NOVA-Entwurf. Es wurde keine E-Mail versendet. Die Firmendaten stammen aus einem Mock-Datensatz.`;
}

export const communicationAgent: NovaAgent = {
  definition: {
    id: "communication",
    name: "Communication Agent",
    description: "E-Mails, Anschreiben, Follow-ups, Vorlagen, Personalisierung.",
    capabilities: ["email-draft", "follow-up", "templates", "personalization"],
    requiredTools: ["mail"],
    inputSchema: { contactIds: "string[]", projectName: "string" },
    outputSchema: { drafts: "Communication[]", mock: "boolean" },
    riskLevel: "high",
    implemented: true,
  },
  async run(input, context) {
    assertOrganizationId(context.organizationId);
    const contactIds = Array.isArray(input.contactIds) ? (input.contactIds as string[]) : [];
    const projectName = String(input.projectName ?? "Projekt X");
    const drafts = [];

    for (const contactId of contactIds) {
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, organizationId: context.organizationId },
        include: { company: true },
      });
      if (!contact) continue;

      const existing = await prisma.communication.findFirst({
        where: {
          organizationId: context.organizationId,
          contactId: contact.id,
          status: "prepared",
          subject: { contains: "Partnerschaft" },
        },
      });

      const draft =
        existing ??
        (await prisma.communication.create({
          data: {
            organizationId: context.organizationId,
            projectId: contact.projectId,
            companyId: contact.companyId,
            contactId: contact.id,
            channel: "email",
            direction: "outbound",
            subject: `Idee für eine Partnerschaft – ${projectName}`,
            body: draftBody({
              firstName: contact.firstName,
              company: contact.company?.name ?? "Ihr Unternehmen",
              projectName,
            }),
            status: "prepared",
            isMock: true,
          },
        }));

      drafts.push(draft);
    }

    return {
      ok: true,
      mock: true,
      summary: `${drafts.length} Anschreiben als Entwurf vorbereitet. Kein Versand.`,
      data: {
        communicationIds: drafts.map((d) => d.id),
        mock: true,
        sent: false,
      },
    };
  },
};
