import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

export const taskAgent: NovaAgent = {
  definition: {
    id: "task",
    name: "Task Agent",
    description: "Aufgaben, Prioritäten, Deadlines, Wiedervorlagen, Folgeaufgaben.",
    capabilities: ["tasks", "deadlines", "follow-ups", "priorities"],
    requiredTools: [],
    inputSchema: { title: "string", dueDays: "number", companyId: "string?", contactId: "string?" },
    outputSchema: { task: "Task" },
    riskLevel: "low",
    implemented: true,
  },
  async run(input, context) {
    assertOrganizationId(context.organizationId);
    const dueAt = new Date();
    if (typeof input.dueAt === "string" && !Number.isNaN(Date.parse(input.dueAt))) {
      dueAt.setTime(Date.parse(String(input.dueAt)));
    } else {
      const dueDays = Number(input.dueDays ?? 5);
      dueAt.setDate(dueAt.getDate() + dueDays);
    }

    const title = String(input.title ?? "Follow-up");
    const isTicket = Boolean(input.ticket) || /^ticket:/i.test(title);
    const task = await prisma.task.create({
      data: {
        organizationId: context.organizationId,
        projectId: context.projectId,
        companyId: typeof input.companyId === "string" ? input.companyId : undefined,
        contactId: typeof input.contactId === "string" ? input.contactId : undefined,
        title: isTicket && !/^ticket:/i.test(title) ? `Ticket: ${title}` : title,
        description: String(input.description ?? (isTicket ? "Lokales Ticket in NOVA, kein externes CRM." : "Wiedervorlage nach vorbereiteter Ansprache.")),
        status: "open",
        priority: String(input.priority ?? (isTicket ? "high" : "medium")),
        dueAt,
        followUpAt: dueAt,
      },
    });

    return {
      ok: true,
      summary: isTicket
        ? `Ticket angelegt: ${task.title}`
        : `Aufgabe erstellt: ${task.title}${task.dueAt ? ` (fällig ${task.dueAt.toISOString().slice(0, 10)})` : ""}`,
      data: { taskId: task.id, title: task.title, dueAt: task.dueAt },
    };
  },
};
