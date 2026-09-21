import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

export const projectAgent: NovaAgent = {
  definition: {
    id: "project",
    name: "Project Agent",
    description: "Projektstatus, Entscheidungen, offene Punkte, Projektkontext.",
    capabilities: ["project-status", "decisions", "open-items", "project-context"],
    requiredTools: [],
    inputSchema: { projectId: "string?" },
    outputSchema: { project: "Project", context: "string" },
    riskLevel: "low",
    implemented: true,
  },
  async run(input, context) {
    assertOrganizationId(context.organizationId);
    const project = input.projectId
      ? await prisma.project.findFirst({
          where: { id: String(input.projectId), organizationId: context.organizationId },
        })
      : await prisma.project.findFirst({
          where: { organizationId: context.organizationId, status: "active" },
        });

    if (!project) {
      return {
        ok: false,
        summary: "Kein Projekt in dieser Organization gefunden.",
        data: {},
      };
    }

    const [companies, tasks] = await Promise.all([
      prisma.company.count({ where: { organizationId: context.organizationId, projectId: project.id } }),
      prisma.task.count({ where: { organizationId: context.organizationId, projectId: project.id, status: "open" } }),
    ]);

    return {
      ok: true,
      summary: `Projektkontext geladen: ${project.name}`,
      data: {
        projectId: project.id,
        projectName: project.name,
        description: project.description,
        relatedCompanies: companies,
        openTasks: tasks,
      },
    };
  },
};
