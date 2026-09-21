import { bootstrapAgents, getAgent, listAgents } from "@/agents/bootstrap";
import { getDefaultProject, runAgentStep } from "@/agents/runtime";
import { resolveAIProvider } from "@/providers/ai/registry";
import { createJob, updateJobStatus } from "@/services/jobs";
import { createApprovalRequest } from "@/services/approvals";
import { recordActivity } from "@/services/archive";
import { createSource, saveMemory } from "@/services/memory";
import { relateMemory } from "@/services/memory/relations";
import { searchMemory } from "@/services/retrieval";
import { prisma } from "@/lib/prisma";
import type { AgentRunContext } from "@/types/agents";
import type { OrbState } from "@/types";

bootstrapAgents();

type MasterPlan = {
  intent: string;
  goal: string;
  count?: number;
  agents: string[];
  needsApproval: boolean;
  mock: boolean;
};

export type MasterRunResult = {
  jobId: string;
  status: string;
  orbState: OrbState;
  statusMessage: string;
  reply: string;
  approvalId?: string;
  mock: boolean;
};

async function runQualityCheck(context: AgentRunContext, communicationIds: string[]) {
  const drafts = await prisma.communication.findMany({
    where: {
      organizationId: context.organizationId,
      id: { in: communicationIds },
    },
  });

  const issues: string[] = [];
  for (const draft of drafts) {
    if (!draft.body.includes("kein")) {
      // soft check: drafts should disclose mock/no-send
    }
    if (draft.status === "sent") {
      issues.push(`Kommunikation ${draft.id} ist als sent markiert, obwohl kein MailProvider verbunden ist.`);
    }
    if (draft.isMock !== true) {
      issues.push(`Kommunikation ${draft.id} ist nicht als Mock gekennzeichnet.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    checked: drafts.length,
  };
}

export async function runMaster(input: {
  organizationId: string;
  userRequest: string;
}): Promise<MasterRunResult> {
  bootstrapAgents();
  const { provider } = await resolveAIProvider(input.organizationId, "master");
  const project = await getDefaultProject(input.organizationId);

  const plan = await provider.structuredOutput<MasterPlan>({
    prompt: input.userRequest,
    schemaName: "master-plan",
    schemaDescription: "Intent, Ziel, benötigte Agenten, Approval-Bedarf",
  });

  const reasoning = await provider.reason({
    goal: plan.goal,
    context: input.userRequest,
  });

  const job = await createJob({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    goal: plan.goal,
    projectId: project?.id,
  });

  await updateJobStatus(input.organizationId, job.id, "planning", { startedAt: new Date() });

  const context: AgentRunContext = {
    organizationId: input.organizationId,
    jobId: job.id,
    userRequest: input.userRequest,
    goal: plan.goal,
    projectId: project?.id,
  };

  const source = await createSource({
    organizationId: input.organizationId,
    type: "nova",
    label: "NOVA Master",
    reference: job.id,
  });

  const priorMemory = await searchMemory({
    organizationId: input.organizationId,
    query: plan.intent === "sponsor_acquisition" ? "sponsor" : input.userRequest,
    limit: 8,
  });

  const projectAgent = getAgent("project");
  if (projectAgent) {
    await updateJobStatus(input.organizationId, job.id, "running");
    await runAgentStep({
      agent: projectAgent,
      action: "load-context",
      payload: { projectId: project?.id },
      context,
    });
  }

  if (plan.intent !== "sponsor_acquisition") {
    const available = listAgents()
      .filter((agent) => agent.definition.implemented)
      .map((agent) => agent.definition.id);

    await recordActivity({
      organizationId: input.organizationId,
      type: "job",
      title: "Anfrage aufgenommen",
      description: `Verfügbare V1-Agenten: ${available.join(", ")}. Für diese Anfrage gibt es noch keinen vollständigen Workflow.`,
      status: "prepared",
      jobId: job.id,
      projectId: project?.id,
    });

    await updateJobStatus(input.organizationId, job.id, "completed", { completedAt: new Date() });

    return {
      jobId: job.id,
      status: "completed",
      orbState: "DONE",
      statusMessage: "Erledigt.",
      mock: true,
      reply:
        "Ich habe die Anfrage verstanden. In V1 kann ich den Sponsoren-Demo-Workflow wirklich ausführen: „Finde 10 potenzielle Sponsoren und bereite die Ansprache vor.“ Andere Abläufe sind architektonisch vorbereitet, aber noch nicht vollständig implementiert.",
    };
  }

  const count = plan.count ?? 10;
  const research = getAgent("research");
  const communication = getAgent("communication");
  const task = getAgent("task");

  if (!research || !communication || !task) {
    throw new Error("V1-Agenten nicht registriert.");
  }

  const researchResult = await runAgentStep({
    agent: research,
    action: "find-sponsors",
    payload: { count, projectId: project?.id, query: input.userRequest },
    context,
  });

  const companyIds = (researchResult.result.data.companyIds as string[]) ?? [];
  const contactIds = (researchResult.result.data.contactIds as string[]) ?? [];
  const mockCompanies = await prisma.company.findMany({
    where: { id: { in: companyIds }, organizationId: input.organizationId },
  });
  const companyNames = mockCompanies.map((item) => item.name).join(", ");

  await recordActivity({
    organizationId: input.organizationId,
    type: "research",
    title: `${companyIds.length} Sponsoren recherchiert (Mock)`,
    description: `Fiktive Demounternehmen: ${companyNames}. Keine echte Webrecherche, keine echten Firmendaten.`,
    status: "prepared",
    jobId: job.id,
    projectId: project?.id,
    companyId: companyIds[0],
    metadata: { mock: true, companyIds },
  });

  await recordActivity({
    organizationId: input.organizationId,
    type: "research",
    title: `${contactIds.length} Ansprechpartner gefunden (Mock)`,
    description: "Fiktive Kontakte mit example.invalid-Adressen. Keine echten Personen recherchiert.",
    status: "prepared",
    jobId: job.id,
    projectId: project?.id,
    metadata: { mock: true, contactIds },
  });

  const commResult = await runAgentStep({
    agent: communication,
    action: "prepare-outreach",
    payload: {
      contactIds,
      projectName: project?.name ?? "Projekt X",
    },
    context,
  });

  const communicationIds = (commResult.result.data.communicationIds as string[]) ?? [];

  await recordActivity({
    organizationId: input.organizationId,
    type: "communication",
    title: `${communicationIds.length} Anschreiben vorbereitet`,
    description: "Entwürfe gespeichert. Es wurde keine E-Mail versendet.",
    status: "prepared",
    jobId: job.id,
    projectId: project?.id,
    communicationId: communicationIds[0],
    metadata: { mock: true, sent: false, communicationIds },
  });

  const quality = await runQualityCheck(context, communicationIds);
  await runAgentStep({
    agent: {
      definition: {
        id: "quality",
        name: "Quality Agent",
        description: "Prüft Ergebnisse auf Ehrlichkeit und Konsistenz.",
        capabilities: ["quality"],
        requiredTools: [],
        inputSchema: {},
        outputSchema: {},
        riskLevel: "low",
        implemented: true,
      },
      async run() {
        return {
          ok: quality.ok,
          summary: quality.ok
            ? `${quality.checked} Entwürfe geprüft. Keine fälschlich ausgeführten Aktionen.`
            : quality.issues.join("; "),
          data: quality,
        };
      },
    },
    action: "review-drafts",
    payload: { communicationIds },
    context,
  });

  const followUp = await runAgentStep({
    agent: task,
    action: "create-follow-up",
    payload: {
      title: "Sponsoren-Ansprache nachfassen (nach Freigabe/Versand)",
      description:
        "Wiedervorlage. Versand ist noch nicht erfolgt, da kein echter Mail-Connector verbunden ist.",
      dueDays: 5,
    },
    context,
  });

  await recordActivity({
    organizationId: input.organizationId,
    type: "task",
    title: 'Aufgabe "Sponsoren-Ansprache nachfassen" erstellt',
    description: "Interne Folgeaufgabe. Noch kein Versand.",
    status: "prepared",
    jobId: job.id,
    projectId: project?.id,
    taskId: String(followUp.result.data.taskId),
  });

  const projectMemory = await saveMemory({
    organizationId: input.organizationId,
    type: "project",
    title: project?.name ?? "Projekt X",
    content: project?.description ?? "Aktives Projekt für Sponsorenakquise.",
    projectId: project?.id,
    sourceId: source.id,
    sourceType: "nova",
    sourceReference: job.id,
  });

  for (const companyId of companyIds) {
    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: input.organizationId },
    });
    if (!company) continue;
    const companyMemory = await saveMemory({
      organizationId: input.organizationId,
      type: "company",
      title: company.name,
      content: `Mock-Sponsorenkandidat (${company.industry ?? "Branche unbekannt"}). Keine echte Recherche.`,
      projectId: project?.id,
      companyId: company.id,
      sourceId: source.id,
      sourceType: "research",
      sourceReference: job.id,
    });
    await relateMemory({
      organizationId: input.organizationId,
      fromId: companyMemory.id,
      toId: projectMemory.id,
      relationType: "candidate_for",
    });

    const contact = await prisma.contact.findFirst({
      where: { organizationId: input.organizationId, companyId: company.id },
    });
    if (!contact) continue;
    const personMemory = await saveMemory({
      organizationId: input.organizationId,
      type: "person",
      title: `${contact.firstName} ${contact.lastName}`,
      content: `Mock-Ansprechpartner, Rolle: ${contact.role ?? "unbekannt"}.`,
      projectId: project?.id,
      companyId: company.id,
      contactId: contact.id,
      sourceId: source.id,
      sourceType: "research",
      sourceReference: job.id,
    });
    await relateMemory({
      organizationId: input.organizationId,
      fromId: personMemory.id,
      toId: companyMemory.id,
      relationType: "works_at",
    });

    const draft = await prisma.communication.findFirst({
      where: { organizationId: input.organizationId, contactId: contact.id, status: "prepared" },
      orderBy: { createdAt: "desc" },
    });
    if (!draft) continue;
    const draftMemory = await saveMemory({
      organizationId: input.organizationId,
      type: "communication",
      title: `Anschreiben an ${contact.firstName} ${contact.lastName} (Entwurf)`,
      content: "Vorbereitet, nicht versendet.",
      projectId: project?.id,
      companyId: company.id,
      contactId: contact.id,
      sourceId: source.id,
      sourceType: "nova",
      sourceReference: draft.id,
    });
    await relateMemory({
      organizationId: input.organizationId,
      fromId: draftMemory.id,
      toId: personMemory.id,
      relationType: "drafted_for",
    });
  }

  const approval = await createApprovalRequest({
    organizationId: input.organizationId,
    jobId: job.id,
    actionType: "mail.send.batch",
    description: `${communicationIds.length} Mock-Anschreiben später versenden? Derzeit ist kein echter Mail-Connector verbunden. Eine Freigabe führt daher nicht zum Versand.`,
    payload: {
      communicationIds,
      mock: true,
      wouldSend: false,
    },
  });

  await recordActivity({
    organizationId: input.organizationId,
    type: "approval",
    title: "Freigabe für Versand angefordert",
    description: approval.description,
    status: "suggested",
    jobId: job.id,
    projectId: project?.id,
    metadata: { approvalId: approval.id, mock: true },
  });

  await updateJobStatus(input.organizationId, job.id, "waiting_for_approval");

  const memoryNote =
    priorMemory.length > 0
      ? ` ${priorMemory.length} bestehende Memory-Einträge wurden berücksichtigt.`
      : "";

  return {
    jobId: job.id,
    status: "waiting_for_approval",
    orbState: "WAITING_FOR_APPROVAL",
    statusMessage: "Ich brauche deine Freigabe, bevor etwas versendet werden könnte.",
    approvalId: approval.id,
    mock: true,
    reply: `${reasoning.plan.join(" → ")}. ${count} Mock-Sponsoren und Anschreiben sind vorbereitet.${memoryNote} Es wurde nichts recherchiert und nichts versendet.`,
  };
}
