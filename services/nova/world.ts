import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

export async function loadNovaWorld(organizationId: string) {
  assertOrganizationId(organizationId);
  const [projects, contacts, companies, tasks, knowledge, research] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, name: true, status: true },
    }),
    prisma.contact.findMany({
      where: { organizationId, isMock: false },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, firstName: true, lastName: true, role: true },
    }),
    prisma.company.findMany({
      where: { organizationId, isMock: false },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, name: true, industry: true },
    }),
    prisma.task.findMany({
      where: { organizationId, status: "open" },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, title: true, status: true, dueAt: true },
    }),
    prisma.knowledgeItem.findMany({
      where: { organizationId },
      orderBy: { extractedAt: "desc" },
      take: 12,
      select: { id: true, title: true, content: true, source: { select: { name: true } } },
    }),
    prisma.artifact.findMany({
      where: { organizationId, type: "RESEARCH_REPORT" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, status: true },
    }),
  ]);
  return {
    projects,
    contacts: contacts.map((item) => ({
      id: item.id,
      name: `${item.firstName} ${item.lastName}`.trim(),
      role: item.role,
    })),
    companies,
    tasks: tasks.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      dueAt: item.dueAt?.toISOString() ?? null,
    })),
    knowledge: knowledge.map((item) => ({
      id: item.id,
      title: item.title || item.content.slice(0, 80),
      source: item.source?.name ?? "",
    })),
    research,
  };
}
