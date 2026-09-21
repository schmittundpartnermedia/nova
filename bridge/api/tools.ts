import { z } from "zod";
import { saveMemory } from "@/services/memory";
import { searchMemory } from "@/services/retrieval";
import { listActivities } from "@/services/archive";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

const searchSchema = z.object({
  query: z.string().default(""),
  limit: z.number().optional(),
});

export const bridgeToolNames = [
  "memory.search",
  "memory.save",
  "projects.search",
  "projects.get",
  "projects.update",
  "tasks.create",
  "tasks.search",
  "tasks.update",
  "contacts.search",
  "contacts.save",
  "activities.search",
  "documents.search",
  "communications.search",
] as const;

export type BridgeToolName = (typeof bridgeToolNames)[number];

export async function executeBridgeTool(input: {
  organizationId: string;
  tool: string;
  payload: Record<string, unknown>;
}) {
  assertOrganizationId(input.organizationId);
  const { organizationId, tool, payload } = input;

  switch (tool) {
    case "memory.search": {
      const data = searchSchema.parse(payload);
      return searchMemory({ organizationId, query: data.query, limit: data.limit });
    }
    case "memory.save": {
      const title = String(payload.title ?? "");
      const content = String(payload.content ?? "");
      if (!title || !content) throw new Error("title und content sind Pflicht.");
      return saveMemory({
        organizationId,
        type: "fact",
        title,
        content,
        sourceType: "chatgpt",
        sourceReference: typeof payload.sourceReference === "string" ? payload.sourceReference : undefined,
      });
    }
    case "projects.search": {
      const data = searchSchema.parse(payload);
      return prisma.project.findMany({
        where: {
          organizationId,
          ...(data.query ? { name: { contains: data.query } } : {}),
        },
        take: data.limit ?? 20,
      });
    }
    case "projects.get": {
      const id = String(payload.id ?? "");
      return prisma.project.findFirst({ where: { id, organizationId } });
    }
    case "projects.update": {
      const id = String(payload.id ?? "");
      const existing = await prisma.project.findFirst({ where: { id, organizationId } });
      if (!existing) throw new Error("Projekt nicht gefunden.");
      return prisma.project.update({
        where: { id },
        data: {
          name: typeof payload.name === "string" ? payload.name : undefined,
          description: typeof payload.description === "string" ? payload.description : undefined,
          status: typeof payload.status === "string" ? payload.status : undefined,
        },
      });
    }
    case "tasks.create": {
      return prisma.task.create({
        data: {
          organizationId,
          title: String(payload.title ?? "Neue Aufgabe"),
          description: typeof payload.description === "string" ? payload.description : undefined,
          status: "open",
          priority: typeof payload.priority === "string" ? payload.priority : "medium",
        },
      });
    }
    case "tasks.search": {
      const data = searchSchema.parse(payload);
      return prisma.task.findMany({
        where: {
          organizationId,
          ...(data.query
            ? { OR: [{ title: { contains: data.query } }, { description: { contains: data.query } }] }
            : {}),
        },
        take: data.limit ?? 20,
        orderBy: { createdAt: "desc" },
      });
    }
    case "tasks.update": {
      const id = String(payload.id ?? "");
      const existing = await prisma.task.findFirst({ where: { id, organizationId } });
      if (!existing) throw new Error("Aufgabe nicht gefunden.");
      return prisma.task.update({
        where: { id },
        data: {
          title: typeof payload.title === "string" ? payload.title : undefined,
          status: typeof payload.status === "string" ? payload.status : undefined,
          description: typeof payload.description === "string" ? payload.description : undefined,
        },
      });
    }
    case "contacts.search": {
      const data = searchSchema.parse(payload);
      return prisma.contact.findMany({
        where: {
          organizationId,
          ...(data.query
            ? {
                OR: [
                  { firstName: { contains: data.query } },
                  { lastName: { contains: data.query } },
                  { email: { contains: data.query } },
                ],
              }
            : {}),
        },
        take: data.limit ?? 20,
        include: { company: true },
      });
    }
    case "contacts.save": {
      return prisma.contact.create({
        data: {
          organizationId,
          firstName: String(payload.firstName ?? "Unbekannt"),
          lastName: String(payload.lastName ?? ""),
          role: typeof payload.role === "string" ? payload.role : undefined,
          email: typeof payload.email === "string" ? payload.email : undefined,
          notes: "Über External Assistant Bridge gespeichert.",
        },
      });
    }
    case "activities.search": {
      const data = searchSchema.parse(payload);
      return listActivities({ organizationId, query: data.query, limit: data.limit });
    }
    case "documents.search": {
      const data = searchSchema.parse(payload);
      return prisma.document.findMany({
        where: {
          organizationId,
          ...(data.query ? { title: { contains: data.query } } : {}),
        },
        take: data.limit ?? 20,
      });
    }
    case "communications.search": {
      const data = searchSchema.parse(payload);
      return prisma.communication.findMany({
        where: {
          organizationId,
          ...(data.query
            ? { OR: [{ subject: { contains: data.query } }, { body: { contains: data.query } }] }
            : {}),
        },
        take: data.limit ?? 20,
        orderBy: { createdAt: "desc" },
      });
    }
    default:
      throw new Error(`Unbekanntes Bridge-Tool: ${tool}`);
  }
}
