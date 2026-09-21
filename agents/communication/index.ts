import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { resolveAIProvider } from "@/providers/ai/registry";

const NO_SEND_FOOTER =
  "\n\n---\nDies ist ein NOVA-Entwurf. Es wurde keine E-Mail versendet. Es ist kein Mail-Connector verbunden.";

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
Joachim${NO_SEND_FOOTER}`;
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
    const brief = String(input.brief ?? context.userRequest);
    const { provider, decision } = await resolveAIProvider(context.organizationId, "simple");
    const useRealDraft = provider.id !== "mock";
    const drafts = [];

    async function generateBody(target: string) {
      if (!useRealDraft) {
        return null;
      }
      const generated = await provider.generate({
        model: decision.model,
        temperature: 0.4,
        system:
          "Du schreibst kurze, professionelle deutschsprachige E-Mail-Entwürfe für NOVA. Keine Secrets. Behaupte niemals, die Mail sei gesendet. Keine erfundenen Firmendaten als Fakten ausgeben.",
        prompt: `Briefing: ${brief}\nEmpfänger-Kontext: ${target}\nProjekt: ${projectName}\nSchreibe nur den Mailtext mit Anrede und Gruß, ohne Betreff.`,
      });
      const body = generated.text.trim();
      return body.includes("keine E-Mail versendet") ? body : `${body}${NO_SEND_FOOTER}`;
    }

    if (contactIds.length === 0) {
      const body =
        (await generateBody("möglicher Sponsor / Partner, kein konkreter Kontakt zugeordnet")) ??
        `Guten Tag,

kurz und konkret: Wir prüfen eine mögliche Partnerschaft im Rahmen von ${projectName}.

Freundliche Grüße
Joachim${NO_SEND_FOOTER}`;

      const draft = await prisma.communication.create({
        data: {
          organizationId: context.organizationId,
          projectId: context.projectId,
          channel: "email",
          direction: "outbound",
          subject: `Idee für eine Partnerschaft – ${projectName}`,
          body,
          status: "prepared",
          isMock: !useRealDraft,
        },
      });
      drafts.push(draft);
    }

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

      const body =
        (await generateBody(
          `${contact.firstName} ${contact.lastName}, ${contact.company?.name ?? "Unternehmen"}, Rolle: ${contact.role ?? "unbekannt"}`,
        )) ??
        draftBody({
          firstName: contact.firstName,
          company: contact.company?.name ?? "Ihr Unternehmen",
          projectName,
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
            body,
            status: "prepared",
            isMock: contact.isMock || !useRealDraft,
          },
        }));

      drafts.push(draft);
    }

    return {
      ok: true,
      mock: !useRealDraft,
      summary: `${drafts.length} Anschreiben als Entwurf vorbereitet. Kein Versand. Mail-Connector nicht verbunden.`,
      data: {
        communicationIds: drafts.map((d) => d.id),
        subjects: drafts.map((d) => d.subject),
        bodies: drafts.map((d) => d.body),
        mock: !useRealDraft,
        sent: false,
        status: "prepared",
      },
    };
  },
};
