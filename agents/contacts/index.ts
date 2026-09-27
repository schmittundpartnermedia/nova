import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { detectContactIntent, guessPersonName } from "@/agents/contacts/intent";

export const contactAgent: NovaAgent = {
  definition: {
    id: "contact",
    name: "Contact Agent",
    description: "Kontakte im NOVA-Adressbuch anlegen und finden. Kein externes CRM.",
    capabilities: ["contacts", "relationships", "history"],
    requiredTools: [],
    inputSchema: { userRequest: "string" },
    outputSchema: { contacts: "Contact[]" },
    riskLevel: "low",
    implemented: true,
  },
  async run(input, context) {
    assertOrganizationId(context.organizationId);
    const request = String(input.userRequest ?? context.userRequest);
    const kind = detectContactIntent(request) || "search";
    const name = guessPersonName(request);

    if (kind === "create") {
      const contact = await prisma.contact.create({
        data: {
          organizationId: context.organizationId,
          firstName: name.firstName,
          lastName: name.lastName,
          email: name.email || null,
          notes: request.slice(0, 400),
          isMock: false,
        },
      });
      const who = `${contact.firstName} ${contact.lastName}`.trim();
      const mail = contact.email ? ` (${contact.email})` : "";
      return {
        ok: true,
        summary: `Kontakt gespeichert: ${who}${mail}`.trim(),
        data: { executed: true, action: "create", contactId: contact.id },
      };
    }

    const query = `${name.firstName} ${name.lastName}`.trim();
    const contacts = await prisma.contact.findMany({
      where: {
        organizationId: context.organizationId,
        isMock: false,
        ...(kind === "list"
          ? {}
          : {
              OR: [
                { firstName: { contains: name.firstName } },
                { lastName: { contains: name.lastName || name.firstName } },
                { notes: { contains: query } },
                ...(query.includes("@") ? [{ email: { contains: query } }] : []),
              ],
            }),
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
    });
    const lines = contacts.map((item) => {
      const who = `${item.firstName} ${item.lastName}`.trim();
      const extra = [item.role, item.email].filter(Boolean).join(" · ");
      return `- ${who}${extra ? ` (${extra})` : ""}`;
    });
    return {
      ok: true,
      summary: contacts.length
        ? `Im NOVA-Adressbuch:\n${lines.join("\n")}`
        : `Keinen Kontakt zu „${query}“ gefunden. Sag „Speicher Kontakt Vorname Nachname“, dann lege ich ihn lokal an.`,
      data: { executed: true, action: kind, count: contacts.length },
    };
  },
};
