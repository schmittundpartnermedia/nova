import { bootstrapAgents, getAgent, listAgents } from "@/agents/bootstrap";
import { getDefaultProject, runAgentStep } from "@/agents/runtime";
import { resolveAIProvider } from "@/providers/ai/registry";
import { createJob, updateJobStatus } from "@/services/jobs";
import { createApprovalRequest } from "@/services/approvals";
import { recordActivity } from "@/services/archive";
import { createSource, upsertDurableMemory } from "@/services/memory";
import { loadRelevantBusinessContext } from "@/services/retrieval";
import { prisma } from "@/lib/prisma";
import { looksLikeSecret, redactSecrets } from "@/lib/secrets";
import type { AgentRunContext, AgentRunResult } from "@/types/agents";
import type { GenerateInput, ProviderMode } from "@/types/ai";
import type { MemoryType, OrbState } from "@/types";

bootstrapAgents();

const MEMORY_TYPES: MemoryType[] = [
  "person",
  "company",
  "project",
  "decision",
  "preference",
  "summary",
  "fact",
  "conversation_insight",
  "research",
  "communication",
  "task",
];

type MemoryItem = {
  type: string;
  title: string;
  content: string;
};

type MasterPlan = {
  intent?: string;
  goal?: string;
  count?: number;
  agents?: string[];
  needsApproval?: boolean;
  remember?: boolean;
  searchRequired?: boolean;
  externalAction?: string;
  mock?: boolean;
  replyHint?: string;
  communicationBrief?: string | null;
  taskDraft?: { title?: string; description?: string; dueDays?: number; dueAt?: string } | null;
  projectDraft?: { create?: boolean; name?: string; description?: string; list?: boolean } | null;
  memoryItems?: MemoryItem[];
};

export type MasterEvent =
  | { type: "status"; orbState: OrbState; statusMessage: string }
  | { type: "provider"; providerMode: ProviderMode; providerId: string; model: string; fallback: boolean }
  | { type: "delta"; delta: string };

export type MasterRunResult = {
  jobId: string;
  status: string;
  orbState: OrbState;
  statusMessage: string;
  reply: string;
  approvalId?: string;
  mock: boolean;
  providerMode: ProviderMode;
  providerId: string;
  model: string;
};

async function emit(onEvent: ((event: MasterEvent) => void) | undefined, event: MasterEvent) {
  onEvent?.(event);
}

async function collectStream(input: {
  provider: { stream: (value: GenerateInput) => AsyncIterable<{ delta: string; done: boolean }> };
  generateInput: GenerateInput;
  onDelta?: (delta: string) => void;
}): Promise<string> {
  let text = "";
  for await (const chunk of input.provider.stream(input.generateInput)) {
    if (chunk.delta) {
      text += chunk.delta;
      input.onDelta?.(chunk.delta);
    }
  }
  return text.trim();
}

function implementedAgentIds(): string[] {
  return listAgents()
    .filter((agent) => agent.definition.implemented)
    .map((agent) => agent.definition.id);
}

function providerModeOf(input: { providerId: string; fallback: boolean; requestedProviderId: string }): ProviderMode {
  if (input.fallback) return "fallback";
  if (input.providerId === "openai") return "openai";
  if (input.providerId === "mock") return "mock";
  return "error";
}

function asMemoryType(value: string): MemoryType {
  return MEMORY_TYPES.includes(value as MemoryType) ? (value as MemoryType) : "fact";
}

async function persistDurableMemory(input: {
  organizationId: string;
  items: MemoryItem[];
  projectId?: string;
  sourceId: string;
  jobId: string;
  conversationMessageId?: string;
}) {
  const saved = [];
  for (const item of input.items) {
    const title = item.title?.trim();
    const content = item.content?.trim();
    if (!title || !content) continue;
    if (looksLikeSecret(title) || looksLikeSecret(content)) continue;
    const entry = await upsertDurableMemory({
      organizationId: input.organizationId,
      type: asMemoryType(item.type),
      title: redactSecrets(title),
      content: redactSecrets(content),
      projectId: input.projectId,
      sourceId: input.sourceId,
      sourceType: input.conversationMessageId ? "conversation_message" : "nova",
      sourceReference: input.conversationMessageId ?? input.jobId,
      conversationMessageId: input.conversationMessageId,
    });
    if (entry) saved.push(entry);
  }
  return saved;
}

export async function runMaster(input: {
  organizationId: string;
  userRequest: string;
  conversationId?: string;
  sourceMessageId?: string;
  onEvent?: (event: MasterEvent) => void;
}): Promise<MasterRunResult> {
  bootstrapAgents();
  await emit(input.onEvent, { type: "status", orbState: "THINKING", statusMessage: "Ich denke nach …" });

  const { provider, decision } = await resolveAIProvider(input.organizationId, "master");
  const mode = providerModeOf(decision);
  await emit(input.onEvent, {
    type: "provider",
    providerMode: mode,
    providerId: provider.id,
    model: decision.model,
    fallback: decision.fallback,
  });

  if (decision.requestedProviderId === "openai" && (decision.fallback || provider.id !== "openai")) {
    return {
      jobId: "",
      status: "failed",
      orbState: "ERROR",
      statusMessage: "Der KI-Anbieter ist gerade nicht erreichbar.",
      reply:
        "OpenAI ist gerade nicht erreichbar. Ich gebe deshalb keine Mock-Antwort als echte Antwort aus. Bitte später erneut versuchen.",
      mock: true,
      providerMode: "error",
      providerId: provider.id,
      model: decision.model,
    };
  }

  const project = await getDefaultProject(input.organizationId);
  const contextPack = await loadRelevantBusinessContext({
    organizationId: input.organizationId,
    query: input.userRequest,
    conversationId: input.conversationId,
  });

  const available = implementedAgentIds();
  const plan = await provider.structuredOutput<MasterPlan>({
    model: decision.model,
    schemaName: "master-plan",
    schemaDescription:
      'JSON mit intent, goal, agents (Teilmenge von research|communication|task|project), needsApproval, remember, searchRequired, externalAction (none|mail.send|calendar|other), replyHint, communicationBrief, taskDraft, projectDraft {create,name,description,list}, memoryItems [{type,title,content}], mock=false wenn echter Provider.',
    prompt: `Du bist NOVA, persönlicher Business-Assistent der Organization ${contextPack.organizationName}.
Entscheide anhand von Intent und Kontext, nicht anhand einzelner Keywords, ob du direkt antwortest oder interne Agenten nutzt.

Verfügbare implementierte Agenten: ${available.join(", ")}

Regeln:
- Direkt antworten, wenn vorhandenes Memory/Projektwissen reicht.
- research nur bei Bedarf an externer Recherche.
- communication für Mail-/Anschreiben-Entwürfe, niemals Versand.
- task für Aufgaben/Deadlines.
- project für Projektübersicht, Status oder neues Projekt.
- remember=true nur bei langlebigen Fakten (Entscheidungen, Projekte, Firmen, Kontakte, Aufgaben, Präferenzen, Deadlines, Zusagen). Kein Smalltalk speichern.
- Erfinde keine Fakten, Firmen oder Kontakte.
- searchRequired=true wenn aktuelle Webrecherche nötig wäre.

Kontext dieser Organization (Retrieval, nicht die ganze Datenbank):
${contextPack.promptBlock}

Benutzeranfrage:
${input.userRequest}`,
  });

  const goal = plan.goal?.trim() || input.userRequest;
  const requestedAgents = (plan.agents ?? []).filter((id) => available.includes(id));
  const allowMockCatalog = provider.id === "mock" && plan.mock === true;

  const job = await createJob({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    goal,
    projectId: project?.id,
  });

  try {
  await updateJobStatus(input.organizationId, job.id, "planning", { startedAt: new Date() });

  const context: AgentRunContext = {
    organizationId: input.organizationId,
    jobId: job.id,
    userRequest: input.userRequest,
    goal,
    projectId: project?.id,
    aiModel: decision.model,
  };

  const source = await createSource({
    organizationId: input.organizationId,
    type: input.sourceMessageId ? "conversation_message" : "nova",
    label: "NOVA Master",
    reference: input.sourceMessageId ?? job.id,
  });

  await emit(input.onEvent, { type: "status", orbState: "WORKING", statusMessage: "Ich arbeite …" });
  await updateJobStatus(input.organizationId, job.id, "running");

  const agentNotes: string[] = [];
  const communicationIds: string[] = [];
  const contactIds: string[] = [];
  let researchBlocked = false;

  const shouldRun = (id: string) => requestedAgents.includes(id);

  if (shouldRun("project") || plan.projectDraft?.list || plan.projectDraft?.create) {
    const projectAgent = getAgent("project");
    if (projectAgent) {
      const result = await runAgentStep({
        agent: projectAgent,
        action: plan.projectDraft?.create ? "create" : plan.projectDraft?.list ? "list" : "load-context",
        payload: {
          projectId: project?.id,
          list: plan.projectDraft?.list === true || !plan.projectDraft?.create,
          create: plan.projectDraft?.create === true,
          name: plan.projectDraft?.name,
          description: plan.projectDraft?.description,
        },
        context,
      });
      agentNotes.push(`Project Agent: ${result.result.summary}`);
      await recordActivity({
        organizationId: input.organizationId,
        type: "project_activity",
        title: result.result.summary,
        description: "Projektkontext intern geladen oder aktualisiert.",
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
      });
    }
  }

  if (shouldRun("research") || plan.searchRequired) {
    const research = getAgent("research");
    if (research) {
      const result = await runAgentStep({
        agent: research,
        action: "research",
        payload: {
          count: plan.count ?? 10,
          projectId: project?.id,
          query: input.userRequest,
          allowMockCatalog,
        },
        context,
      });
      agentNotes.push(`Research Agent: ${result.result.summary}`);
      const ids = (result.result.data.contactIds as string[]) ?? [];
      contactIds.push(...ids);
      if (result.result.data.searchConnected === false && result.result.data.mock !== true) {
        researchBlocked = true;
      }
      await recordActivity({
        organizationId: input.organizationId,
        type: "research",
        title: result.result.mock ? "Recherche vorbereitet (Mock)" : "Recherche nicht ausgeführt",
        description: result.result.summary,
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
        metadata: {
          mock: Boolean(result.result.mock),
          searchConnected: result.result.data.searchConnected === true,
          invented: false,
        },
      });
    }
  }

  if (shouldRun("communication")) {
    const communication = getAgent("communication");
    if (communication) {
      const result = await runAgentStep({
        agent: communication,
        action: "prepare-outreach",
        payload: {
          contactIds,
          projectName: project?.name ?? "Projekt X",
          brief: plan.communicationBrief ?? input.userRequest,
        },
        context,
      });
      agentNotes.push(`Communication Agent: ${result.result.summary}`);
      communicationIds.push(...((result.result.data.communicationIds as string[]) ?? []));
      await recordActivity({
        organizationId: input.organizationId,
        type: "communication",
        title: `${communicationIds.length} Anschreiben vorbereitet`,
        description: "Entwurf gespeichert. Es wurde keine E-Mail versendet. Mail-Connector nicht verbunden.",
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
        communicationId: communicationIds[0],
        metadata: { sent: false, communicationIds, status: "prepared" },
      });
    }
  }

  if (shouldRun("task") || plan.taskDraft?.title) {
    const task = getAgent("task");
    if (task) {
      const result = await runAgentStep({
        agent: task,
        action: "create-task",
        payload: {
          title: plan.taskDraft?.title ?? "Aufgabe",
          description: plan.taskDraft?.description ?? input.userRequest,
          dueDays: plan.taskDraft?.dueDays ?? 1,
          dueAt: plan.taskDraft?.dueAt,
        },
        context,
      });
      agentNotes.push(`Task Agent: ${result.result.summary}`);
      await recordActivity({
        organizationId: input.organizationId,
        type: "task",
        title: result.result.summary,
        description: String(plan.taskDraft?.description ?? "Interne Aufgabe. Keine externe Aktion."),
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
        taskId: String(result.result.data.taskId ?? ""),
      });
    }
  }

  let memoryItems = (plan.memoryItems ?? []).filter((item) => item.title && item.content);
  if (memoryItems.length === 0) {
    const extracted = await provider.structuredOutput<{ persist?: boolean; items?: MemoryItem[] }>({
      model: decision.model,
      schemaName: "durable-memory",
      schemaDescription:
        'JSON {persist:boolean, items:[{type,title,content}]}. persist=true nur bei langlebigen Business-Fakten (Entscheidungen, Projekte, Firmen, Kontakte, Aufgaben, Präferenzen, Deadlines, Zusagen). Kein Smalltalk, keine Secrets, nichts erfinden.',
      prompt: `Anfrage: ${input.userRequest}\nKontext:\n${contextPack.promptBlock}\nWelche langlebigen Fakten sollen im Business Memory gespeichert werden?`,
    });
    if (extracted.persist && Array.isArray(extracted.items)) {
      memoryItems = extracted.items.filter((item) => item.title && item.content);
    }
  }
  if (memoryItems.length > 0) {
    const saved = await persistDurableMemory({
      organizationId: input.organizationId,
      items: memoryItems,
      projectId: project?.id,
      sourceId: source.id,
      jobId: job.id,
      conversationMessageId: input.sourceMessageId,
    });
    if (saved.length > 0) {
      agentNotes.push(`Memory: ${saved.length} langlebige Einträge gespeichert.`);
      await recordActivity({
        organizationId: input.organizationId,
        type: saved.some((item) => item.type === "decision") ? "decision" : "memory",
        title: "Business Memory aktualisiert",
        description: saved.map((item) => item.title).join(", "),
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
        metadata: {
          memoryIds: saved.map((item) => item.id),
          sourceType: input.sourceMessageId ? "conversation_message" : "nova",
          sourceMessageId: input.sourceMessageId ?? null,
        },
      });
    }
  }

  let approvalId: string | undefined;
  let orbState: OrbState = "DONE";
  let statusMessage = "Erledigt.";
  const wantsExternal = plan.needsApproval === true || plan.externalAction === "mail.send";

  if (wantsExternal && communicationIds.length > 0) {
    const approval = await createApprovalRequest({
      organizationId: input.organizationId,
      jobId: job.id,
      actionType: "mail.send.batch",
      description:
        `${communicationIds.length} Entwurf(e) liegen vor. Versand würde Freigabe brauchen. Derzeit ist kein Mail-Connector verbunden. Auch nach Freigabe wird nichts versendet.`,
      payload: {
        communicationIds,
        mock: provider.id === "mock",
        wouldSend: false,
        status: "prepared",
      },
    });
    approvalId = approval.id;
    orbState = "WAITING_FOR_APPROVAL";
    statusMessage = "Entwurf vorbereitet. Für einen Versand wäre Freigabe nötig – Connector noch nicht verbunden.";
    await recordActivity({
      organizationId: input.organizationId,
      type: "approval",
      title: "Freigabe vorbereitet – Versand nicht möglich",
      description: approval.description,
      status: "suggested",
      jobId: job.id,
      projectId: project?.id,
      metadata: { approvalId: approval.id, executed: false },
    });
    await updateJobStatus(input.organizationId, job.id, "waiting_for_approval");
  }

  const drafts = communicationIds.length
    ? await prisma.communication.findMany({
        where: { organizationId: input.organizationId, id: { in: communicationIds } },
      })
    : [];

  const reply = await collectStream({
    provider,
    generateInput: {
      model: decision.model,
      temperature: 0.4,
      system: `Du bist NOVA, der persönliche KI-Business-Assistent von ${contextPack.organizationName}.
Du bist nicht rankPilot und nicht SURI.
Antworte auf Deutsch, klar und knapp.
Erfinde keine Fakten. Wenn Memory nichts enthält, sage das ehrlich.
Behaupte niemals, E-Mails seien gesendet, Recherche sei live erfolgt oder Connectoren seien verbunden, wenn das nicht der Fall ist.
Conversation Archive ist die vollständige Kommunikation. Business Memory ist extrahiertes Wissen mit Quelle.
Wenn du auf gespeichertes Wissen antwortest, bleibt die Quelle (Gesprächsnachricht) nachvollziehbar.
${researchBlocked ? "Es ist kein echter Search Connector verbunden. Nenne keine erfundenen aktuellen Unternehmen als Rechercheergebnis." : ""}
${provider.id === "mock" ? "Du bist im Mock-Modus. Kennzeichne das, täusche keine echte Modellantwort vor." : ""}`,
      prompt: `Benutzer: ${input.userRequest}

Kontext:
${contextPack.promptBlock}

Plan: intent=${plan.intent ?? "direct_answer"}; hint=${plan.replyHint ?? ""}

Interne Agentenergebnisse:
${agentNotes.length ? agentNotes.join("\n") : "Keine Spezialagenten nötig, direkt antworten."}

${
  drafts.length
    ? `Mail-Entwürfe (nicht gesendet):\n${drafts.map((draft) => `Betreff: ${draft.subject}\n${draft.body}`).join("\n\n")}`
    : ""
}

Formuliere die Nutzerantwort. Wenn ein Entwurf erzeugt wurde, zeige ihn. Wenn Recherche unmöglich war, sage klar, dass kein Search Connector verbunden ist.`,
    },
    onDelta: (delta) => {
      void emit(input.onEvent, { type: "delta", delta });
    },
  });

  if (!wantsExternal || communicationIds.length === 0) {
    await updateJobStatus(input.organizationId, job.id, "completed", { completedAt: new Date() });
  }

  return {
    jobId: job.id,
    status: orbState === "WAITING_FOR_APPROVAL" ? "waiting_for_approval" : "completed",
    orbState,
    statusMessage,
    reply,
    approvalId,
    mock: provider.id === "mock",
    providerMode: mode,
    providerId: provider.id,
    model: decision.model,
  };
  } catch (error) {
    await updateJobStatus(input.organizationId, job.id, "failed", { completedAt: new Date() });
    throw error;
  }
}

export async function runQualityCheck(context: AgentRunContext, communicationIds: string[]): Promise<AgentRunResult> {
  const drafts = await prisma.communication.findMany({
    where: {
      organizationId: context.organizationId,
      id: { in: communicationIds },
    },
  });
  const issues: string[] = [];
  for (const draft of drafts) {
    if (draft.status === "sent" || draft.status === "executed") {
      issues.push(`Kommunikation ${draft.id} darf ohne Connector nicht als gesendet gelten.`);
    }
  }
  return {
    ok: issues.length === 0,
    summary: issues.length === 0
      ? `${drafts.length} Entwürfe geprüft. Keine fälschlich ausgeführten Aktionen.`
      : issues.join("; "),
    data: { issues, checked: drafts.length },
  };
}
