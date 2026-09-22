import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");
}

export type ResolvedEntity = {
  kind: "project" | "company" | "contact" | "knowledge";
  id: string;
  name: string;
  confidence: number;
};

export async function resolveExistingEntity(input: {
  organizationId: string;
  name: string;
  kind?: "project" | "company" | "person";
}): Promise<ResolvedEntity | null> {
  assertOrganizationId(input.organizationId);
  const needle = normalizeEntityName(input.name);
  if (!needle) return null;

  if (!input.kind || input.kind === "project") {
    const projects = await prisma.project.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, name: true },
      take: 200,
    });
    const project = projects.find((item) => normalizeEntityName(item.name) === needle);
    if (project) return { kind: "project", id: project.id, name: project.name, confidence: 0.96 };
  }

  if (!input.kind || input.kind === "company") {
    const companies = await prisma.company.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, name: true },
      take: 200,
    });
    const company = companies.find((item) => normalizeEntityName(item.name) === needle);
    if (company) return { kind: "company", id: company.id, name: company.name, confidence: 0.95 };
  }

  if (!input.kind || input.kind === "person") {
    const contacts = await prisma.contact.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, firstName: true, lastName: true },
      take: 200,
    });
    const contact = contacts.find((item) => normalizeEntityName(`${item.firstName} ${item.lastName}`) === needle);
    if (contact) {
      return {
        kind: "contact",
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        confidence: 0.94,
      };
    }
  }

  const items = await prisma.knowledgeItem.findMany({
    where: {
      organizationId: input.organizationId,
      entityName: { not: null },
      type: input.kind === "person" ? { in: ["PERSON", "CONTACT"] } : input.kind === "company" ? "COMPANY" : input.kind === "project" ? "PROJECT" : undefined,
    },
    select: { id: true, entityName: true, title: true },
    take: 400,
  });
  const item = items.find((row) => normalizeEntityName(row.entityName ?? row.title) === needle);
  if (item) {
    return { kind: "knowledge", id: item.id, name: item.entityName ?? item.title, confidence: 0.8 };
  }
  return null;
}
