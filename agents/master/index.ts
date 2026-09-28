import { bootstrapAgents, getAgent, listAgents } from "@/agents/bootstrap";
import { detectComputerIntent } from "@/agents/computer/intent";
import { detectCodingIntent } from "@/agents/coding/intent";
import { runCodingAgent } from "@/agents/coding";
import { detectKnowledgeIntent } from "@/agents/knowledge/intent";
import { detectChatGPTImportIntent } from "@/lib/chatgpt/intent";
import { runKnowledgeAgent } from "@/agents/knowledge";
import { detectDialogMove, dialogInstruction, type DialogMove } from "@/lib/dialog/intent";
import { classifyConversationMove } from "@/lib/dialog/followup";
import { detectUserTone, toneInstruction } from "@/lib/dialog/tone";
import { refreshConversationContinuity } from "@/services/conversation/continuity";
import { needsLiveResearch } from "@/lib/research/intent";
import { needsFlagshipModel, needsSpecialistWork } from "@/agents/master/intent";
import { detectCalendarIntent } from "@/agents/calendar/intent";
import { detectWatchIntent } from "@/agents/watch/intent";
import { detectContactIntent } from "@/agents/contacts/intent";
import { detectTicketIntent, guessTicketTitle } from "@/agents/tickets/intent";
import { fileArtifact } from "@/services/artifacts";
import { handleReviewUtterance } from "@/services/review/handle";
import { detectMailIntent } from "@/lib/mail/intent";
import { detectDevelopmentIntent } from "@/lib/development/intent";
import { approvalSupersedesReview } from "@/lib/dialog/situation";
import { classifyReviewUtterance } from "@/lib/review/intent";
import { actOnSituation, decideTurn, loadOpenSituation } from "@/services/dialog/situation";
import { loadDialogFocus, popDialogFocus, recordDialogFocus } from "@/services/dialog/focus";
import { detectProjectIntent } from "@/agents/projects/intent";
import { commissionDevelopment } from "@/services/development/commission";
import { explainDevelopment } from "@/services/development/status";
import { createApprovalRequest, standingApprovalAllows, consumeStandingApproval } from "@/services/approvals";
import { isRealConnectorEnabled } from "@/connectors/registry";
import { getDefaultProject, runAgentStep } from "@/agents/runtime";
import { resolveAIProvider } from "@/providers/ai/registry";
import { createJob, updateJobStatus } from "@/services/jobs";
import { recordActivity } from "@/services/archive";
import { createSource, upsertDurableMemory } from "@/services/memory";
import { extractSpokenMemory } from "@/lib/memory/policy";
import { loadRelevantBusinessContext } from "@/services/retrieval";
import { requestKnowledgeCancel } from "@/services/knowledge/jobs";
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
  sourceId?: string;
  sourceUrl?: string;
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
  actionType?: string;
  humanRequired?: string | null;
  mock: boolean;
  providerMode: ProviderMode;
  providerId: string;
  model: string;
  needsFile?: "chatgpt-export";
  replyStored?: boolean;
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
      sourceId: item.sourceId ?? input.sourceId,
      sourceType: item.sourceId ? "research" : input.conversationMessageId ? "conversation_message" : "nova",
      sourceReference: input.conversationMessageId ?? input.jobId,
      sourceUrl: item.sourceUrl,
      conversationMessageId: input.conversationMessageId,
    });
    if (entry) saved.push(entry);
  }
  return saved;
}

function rememberConversation(input: {
  organizationId: string;
  conversationId?: string;
  userRequest: string;
  reply: string;
  domain?: string;
}) {
  const conversationId = input.conversationId;
  if (!conversationId || !input.reply.trim()) return;
  void (async () => {
    if (input.domain) {
      await recordDialogFocus({
        conversationId,
        domain: input.domain,
        reply: input.reply,
      });
    }
    await refreshConversationContinuity({
      organizationId: input.organizationId,
      conversationId,
      userRequest: input.userRequest,
      reply: input.reply,
    });
    const spoken = extractSpokenMemory(input.userRequest);
    if (spoken) {
      await upsertDurableMemory({
        organizationId: input.organizationId,
        type: spoken.type,
        title: spoken.title,
        content: spoken.content,
        sourceType: "conversation_message",
        sourceReference: conversationId,
      });
    }
  })().catch(() => undefined);
}

async function onceExternal<T>(input: {
  organizationId: string;
  workItemId?: string;
  idempotencyKey: string;
  effectType: string;
  run: () => Promise<T>;
}): Promise<{ value?: T; uncertain: boolean }> {
  if (!input.workItemId) return { value: await input.run(), uncertain: false };
  const { loadEffectResult, withExternalEffect } = await import("@/services/worker/queue");
  const effect = await withExternalEffect({
    organizationId: input.organizationId,
    workItemId: input.workItemId,
    idempotencyKey: input.idempotencyKey,
    effectType: input.effectType,
    run: input.run,
  });
  if (effect.decision === "needs_verification") return { uncertain: true };
  if (effect.decision === "already_committed") {
    const stored = await loadEffectResult<T>(input.organizationId, input.idempotencyKey);
    return stored ? { value: stored, uncertain: false } : { uncertain: true };
  }
  return { value: effect.value, uncertain: false };
}

function novaReplySystem(input: {
  organizationName: string;
  mock: boolean;
  dialog: DialogMove;
  tone?: string;
  researchAnswer?: string;
  researchBlocked?: boolean;
  researchFailed?: boolean;
}) {
  return `Du bist NOVA, das Gegenüber von ${input.organizationName}. Nicht rankPilot, nicht SURI.
Du führst ein Gespräch auf Augenhöhe. Du bist kein Lexikon, kein Formular und kein Ticket-System.

Dialog zuerst:
- Wünsche, Dank, Begrüßung, Smalltalk erwiderst du menschlich. Erkläre keine Wörter, wenn jemand mit dir spricht.
- „Schönen Feierabend“ → „Danke, dir auch.“ Nicht, was Feierabend bedeutet.
- Du triffst die Absicht, nicht die Wörter: Ironie, Sarkasmus, Spaß, Ärger, Müdigkeit, Eile.
- Gesprächskontinuität und offene Fäden im Kontext gelten über Tage. Du musst nicht so tun, als wärst du neu.

Wissen im Gespräch:
- Knowledge und Memory sind stiller Kontext. Wenn etwas zur Frage passt, nutze es.
- Nenne die Quelle natürlich im Satz: Dateiname, Seite, Gespräch. Keine Aktenzeile, kein Agenten-Jargon.
- Erfinde keine Dateien und keine Fakten. Wenn nichts passt, sag das ehrlich.
- Bei einem sozialen Zug Knowledge nicht vorlesen, außer zusätzlich gefragt wird.

Stil: Deutsch, lebendig, klar. So lang wie nötig. Keine Prozessberichte.
Kein Präfix wie „NOVA:“. Nach Wunsch oder Dank keine Servicefrage („Wie kann ich helfen?“), außer jemand hat etwas aufgetragen.
Behaupte niemals, E-Mails seien gesendet, wenn das nicht der Fall ist.
Conversation Archive ist die vollständige Kommunikation. Business Memory ist extrahiertes Wissen mit Quelle.
Aktuelle Fakten nur aus der Recherche mit Quellen.
${dialogInstruction(input.dialog)}
${input.tone ?? ""}
${input.researchAnswer ? "Eine echte Webrecherche ist erfolgt. Verwende deren Ergebnis." : ""}
${input.researchBlocked ? "Es ist kein echter Search Connector verbunden. Sage klar, dass aktuelle Informationen gerade nicht zuverlässig prüfbar sind. Erfinde keine Treffer." : ""}
${input.researchFailed ? "Die Webrecherche konnte die aktuelle Information nicht zuverlässig prüfen. Sage genau das. Erfinde keine Ergebnisse." : ""}
${input.mock ? "Du bist im Mock-Modus. Kennzeichne das, täusche keine echte Modellantwort vor." : ""}`;
}

async function runDirectReply(input: {
  userRequest: string;
  dialog: DialogMove;
  onEvent?: (event: MasterEvent) => void;
  provider: { id: string; stream: (value: GenerateInput) => AsyncIterable<{ delta: string; done: boolean }> };
  decision: { model: string };
  mode: ProviderMode;
  contextPack: { organizationName: string; promptBlock: string };
}): Promise<MasterRunResult> {
  const tone = detectUserTone(input.userRequest);
  const reply = await collectStream({
    provider: input.provider,
    generateInput: {
      model: input.decision.model,
      temperature: input.dialog.kind === "social" ? 0.75 : 0.6,
      system: novaReplySystem({
        organizationName: input.contextPack.organizationName,
        mock: input.provider.id === "mock",
        dialog: input.dialog,
        tone: toneInstruction(tone),
      }),
      prompt: `Benutzer: ${input.userRequest}

Kontext:
${input.contextPack.promptBlock}

${dialogInstruction(input.dialog)}
Formuliere die Nutzerantwort direkt. Keine Agenten, kein Plan, kein Prozessbericht.`,
    },
    onDelta: (delta) => {
      void emit(input.onEvent, { type: "delta", delta });
    },
  });

  return {
    jobId: "",
    status: "completed",
    orbState: "DONE",
    statusMessage: "Erledigt.",
    reply,
    mock: input.provider.id === "mock",
    providerMode: input.mode,
    providerId: input.provider.id,
    model: input.decision.model,
  };
}

function utteranceOpensWork(text: string): boolean {
  if (detectMailIntent(text).kind !== "none") return true;
  if (detectCalendarIntent(text)) return true;
  if (detectContactIntent(text)) return true;
  if (detectTicketIntent(text)) return true;
  if (detectProjectIntent(text).kind !== "none") return true;
  if (detectKnowledgeIntent(text).kind !== "none" && detectKnowledgeIntent(text).kind !== "cancel") return true;
  if (detectChatGPTImportIntent(text).kind !== "none") return true;
  if (detectDevelopmentIntent(text).kind !== "none") return true;
  if (detectCodingIntent(text).kind !== "none") return true;
  const computer = detectComputerIntent(text);
  if (computer.kind !== "none" && computer.kind !== "cancel") return true;
  if (detectWatchIntent(text)) return true;
  if (/\bdauerfreigabe\b/i.test(text)) return true;
  if (/\barchiv\b/i.test(text) && /\b(such|find|zeig|öffne|oeffne|durchsuch)\w*\b/i.test(text)) return true;
  if (needsLiveResearch(text)) return true;
  return false;
}

async function answerBoundToFrame(
  input: {
    organizationId: string;
    userRequest: string;
    conversationId?: string;
    onEvent?: (event: MasterEvent) => void;
  },
  frame: { domain: string; reply: string },
  kind: "return" | "continue",
): Promise<MasterRunResult> {
  const instruction =
    kind === "return"
      ? "Der Benutzer kehrt zu diesem früheren Vorgang zurück. Nimm genau diesen Vorgang wieder auf. Den dazwischenliegenden Vorgang nicht vermischen."
      : "Der Benutzer bezieht sich auf genau diese letzte Antwort. Beantworte die Rückfrage daraus. Ältere Chats, andere Mails und andere Listen nicht hineinziehen.";
  const { provider, decision } = await resolveAIProvider(input.organizationId, "simple");
  const unavailable = decision.requestedProviderId === "openai" && (decision.fallback || provider.id !== "openai") && provider.id !== "mock";
  let reply = "";
  if (!unavailable && provider.id !== "mock") {
    reply = await collectStream({
      provider,
      generateInput: {
        model: decision.model,
        temperature: 0.2,
        system: `Du bist NOVA. ${instruction} Deutsch, knapp, sachlich. Erfinde nichts, was in der genannten Antwort nicht steht.`,
        prompt: `Bisherige Antwort:\n${frame.reply}\n\nBenutzer jetzt:\n${input.userRequest}`,
      },
      onDelta: (delta) => {
        void emit(input.onEvent, { type: "delta", delta });
      },
    });
  }
  if (!reply.trim()) {
    reply = kind === "return" ? `Zurück zu diesem Vorgang:\n\n${frame.reply}` : frame.reply;
    await emit(input.onEvent, { type: "delta", delta: reply });
  }
  await emit(input.onEvent, { type: "status", orbState: "DONE", statusMessage: "Im selben Vorgang." });
  rememberConversation({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    userRequest: input.userRequest,
    reply,
    domain: frame.domain,
  });
  return {
    jobId: "",
    status: "completed",
    orbState: "DONE",
    statusMessage: "Im selben Vorgang.",
    reply,
    mock: provider.id === "mock",
    providerMode: provider.id === "openai" ? "openai" : provider.id === "mock" ? "mock" : "fallback",
    providerId: provider.id,
    model: decision.model,
  };
}

export async function runMaster(input: {
  organizationId: string;
  userRequest: string;
  conversationId?: string;
  sourceMessageId?: string;
  onEvent?: (event: MasterEvent) => void;
  ownedJobId?: string;
  workItemId?: string;
  signal?: AbortSignal;
}): Promise<MasterRunResult> {
  bootstrapAgents();
  if (input.ownedJobId) {
    return runPlannerBody(input, detectDialogMove(input.userRequest));
  }
  await emit(input.onEvent, { type: "status", orbState: "THINKING", statusMessage: "Ich denke nach …" });

  const situation = await loadOpenSituation(input.organizationId);
  const reviewCommand = classifyReviewUtterance(input.userRequest);
  const newerApproval =
    approvalSupersedesReview({
      approvalAt: situation.approvalCreatedAt,
      reviewAt: situation.reviewOpenedAt,
      confirmsApproval: reviewCommand?.kind === "approve" || reviewCommand?.kind === "reject",
    }) ||
    (Boolean(situation.pendingApprovalId) &&
      /^(?:nova[,.\s]*)?nicht jetzt[.!]?$/i.test(input.userRequest.trim()));
  const reviewHit = newerApproval
    ? null
    : await handleReviewUtterance({
        organizationId: input.organizationId,
        userRequest: input.userRequest,
      });
  if (reviewHit) {
    await emit(input.onEvent, {
      type: "status",
      orbState: reviewHit.orbState,
      statusMessage: reviewHit.statusMessage,
    });
    if (reviewHit.reply) await emit(input.onEvent, { type: "delta", delta: reviewHit.reply });
    rememberConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userRequest: input.userRequest,
      reply: reviewHit.reply,
    });
    return {
      ...reviewHit,
      mock: false,
      providerMode: "fallback",
      providerId: "nova-review",
      model: "nova-review",
    };
  }

  const situationDecision = decideTurn(input.userRequest, situation);
  if (situationDecision.kind !== "none") {
    const acted = await actOnSituation({
      organizationId: input.organizationId,
      userRequest: input.userRequest,
      decision: situationDecision,
      situation,
    });
    if (acted) {
      await emit(input.onEvent, { type: "status", orbState: acted.orb, statusMessage: acted.statusMessage });
      await emit(input.onEvent, { type: "delta", delta: acted.reply });
      rememberConversation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        userRequest: input.userRequest,
        reply: acted.reply,
      });
      return {
        jobId: "",
        status: "completed",
        orbState: acted.orb,
        statusMessage: acted.statusMessage,
        reply: acted.reply,
        approvalId: acted.approvalId,
        mock: false,
        providerMode: "fallback",
        providerId: "nova-situation",
        model: "nova-situation",
      };
    }
  }

  const conversationMove = classifyConversationMove(input.userRequest);
  if (input.conversationId && conversationMove === "return") {
    const frame = await popDialogFocus(input.conversationId);
    if (frame) return answerBoundToFrame(input, frame, "return");
  }
  if (input.conversationId && conversationMove === "continue" && !utteranceOpensWork(input.userRequest)) {
    const focus = await loadDialogFocus(input.conversationId);
    if (focus.current) return answerBoundToFrame(input, focus.current, "continue");
  }

  const dialog = detectDialogMove(input.userRequest);
  const computerIntent = detectComputerIntent(input.userRequest);
  const knowledgeIntent = detectKnowledgeIntent(input.userRequest);
  const chatgptIntent = detectChatGPTImportIntent(input.userRequest);
  if (computerIntent.kind === "cancel" || knowledgeIntent.kind === "cancel") {
    const acted = await actOnSituation({
      organizationId: input.organizationId,
      userRequest: input.userRequest,
      decision: { kind: "cancel-active" },
      situation,
    });
    const reply = acted?.reply ?? "Ich habe abgebrochen.";
    await emit(input.onEvent, { type: "delta", delta: reply });
    return {
      jobId: "",
      status: "cancelled",
      orbState: "DONE",
      statusMessage: "Abgebrochen.",
      reply,
      mock: false,
      providerMode: "fallback",
      providerId: "nova-situation",
      model: "nova-situation",
    };
  }

  const developmentIntent = detectDevelopmentIntent(input.userRequest);
  if (dialog.kind !== "social" && developmentIntent.kind === "status") {
    const explained = await explainDevelopment(input.organizationId, input.userRequest);
    await emit(input.onEvent, { type: "status", orbState: "DONE", statusMessage: explained.statusMessage });
    await emit(input.onEvent, { type: "delta", delta: explained.reply });
    rememberConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userRequest: input.userRequest,
      reply: explained.reply,
    });
    return {
      jobId: "",
      status: "completed",
      orbState: "DONE",
      statusMessage: explained.statusMessage,
      reply: explained.reply,
      mock: false,
      providerMode: "fallback",
      providerId: "development",
      model: "nova-development",
    };
  }
  if (dialog.kind !== "social" && developmentIntent.kind === "commission") {
    await emit(input.onEvent, { type: "status", orbState: "WORKING", statusMessage: developmentIntent.statusMessage });
    const commissioned = await commissionDevelopment({
      organizationId: input.organizationId,
      userRequest: input.userRequest,
    });
    await emit(input.onEvent, { type: "delta", delta: commissioned.reply });
    rememberConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userRequest: input.userRequest,
      reply: commissioned.reply,
    });
    return {
      jobId: commissioned.jobId,
      status: "running",
      orbState: "WORKING",
      statusMessage: commissioned.statusMessage,
      reply: commissioned.reply,
      mock: false,
      providerMode: "fallback",
      providerId: "development",
      model: "nova-development",
    };
  }

  const codingIntent = detectCodingIntent(input.userRequest);
  if (dialog.kind !== "social" && codingIntent.kind !== "none") {
    return runCodingMasterPath(input, codingIntent.statusMessage);
  }

  if (dialog.kind !== "social" && computerIntent.kind !== "none") {
    return runComputerMasterPath(input, computerIntent.statusMessage);
  }

  if (chatgptIntent.kind === "prompt") {
    await emit(input.onEvent, { type: "status", orbState: "DONE", statusMessage: chatgptIntent.statusMessage });
    if (chatgptIntent.statusMessage) {
      await emit(input.onEvent, { type: "delta", delta: "Wähle deinen ChatGPT-Export aus." });
    }
    return {
      jobId: "",
      status: "completed",
      orbState: "DONE",
      statusMessage: chatgptIntent.statusMessage,
      reply: "Wähle deinen ChatGPT-Export aus.",
      mock: false,
      providerMode: "fallback",
      providerId: "knowledge",
      model: "nova-knowledge",
      needsFile: "chatgpt-export",
    };
  }

  if (chatgptIntent.kind !== "none") {
    return runKnowledgeMasterPath(input, chatgptIntent.statusMessage);
  }

  if (dialog.kind !== "social" && knowledgeIntent.kind === "import") {
    return runKnowledgeMasterPath(input, knowledgeIntent.statusMessage);
  }

  if (dialog.kind !== "social" && knowledgeIntent.kind === "query") {
    return runKnowledgeQueryPath(input, knowledgeIntent.statusMessage);
  }

  const mailIntent = detectMailIntent(input.userRequest);
  if (dialog.kind !== "social" && mailIntent.kind !== "none") {
    return runMailMasterPath(input, mailIntent.statusMessage);
  }

  if (dialog.kind !== "social" && detectCalendarIntent(input.userRequest)) {
    return runLocalMasterPath(input, "Ich schaue in den Kalender.", "calendar", "calendar", {
      userRequest: input.userRequest,
    });
  }
  if (dialog.kind !== "social" && /\b(dokument(?:e|en)?|unterlagen)\b/i.test(input.userRequest) && !needsLiveResearch(input.userRequest)) {
    return runLocalMasterPath(input, "Ich schaue in die Dokumente.", "document", "document", {
      userRequest: input.userRequest,
    });
  }
  if (dialog.kind !== "social" && /\b(meetings?|besprechung(?:en)?)\b/i.test(input.userRequest) && !detectCalendarIntent(input.userRequest)) {
    return runLocalMasterPath(input, "Ich schaue auf die Meetings.", "meeting", "meeting", {
      userRequest: input.userRequest,
    });
  }
  if (dialog.kind !== "social" && detectContactIntent(input.userRequest) && !needsLiveResearch(input.userRequest)) {
    return runLocalMasterPath(input, "Ich schaue ins Adressbuch.", "contact", "contact", {
      userRequest: input.userRequest,
    });
  }
  const ticketIntent = detectTicketIntent(input.userRequest);
  if (dialog.kind !== "social" && ticketIntent === "list") {
    return runLocalMasterPath(input, "Ich schaue in die Tickets.", "task", "list-tasks", { list: true });
  }
  if (dialog.kind !== "social" && ticketIntent === "create") {
    return runLocalMasterPath(input, "Ich lege das Ticket an.", "task", "create-task", {
      title: guessTicketTitle(input.userRequest),
      description: input.userRequest,
      dueDays: 1,
      ticket: true,
    });
  }
  if (dialog.kind !== "social" && detectWatchIntent(input.userRequest)) {
    return runLocalMasterPath(input, "Ich schaue, was ansteht.", "watch", "watch", {
      userRequest: input.userRequest,
    });
  }
  const projectIntent = detectProjectIntent(input.userRequest);
  if (dialog.kind !== "social" && projectIntent.kind === "list") {
    return runLocalMasterPath(input, "Ich schaue in die Projekte.", "project", "list", { list: true });
  }
  if (dialog.kind !== "social" && projectIntent.kind === "create") {
    return runLocalMasterPath(input, "Ich lege das Projekt an.", "project", "create", {
      create: true,
      name: projectIntent.name,
    });
  }
  if (dialog.kind !== "social" && projectIntent.kind === "status") {
    return runLocalMasterPath(input, "Ich schaue den Projektstatus an.", "project", "load-context", {
      name: projectIntent.name,
    });
  }

  if (dialog.kind !== "social" && /\bmerk(?:e)?\s+dir\b/i.test(input.userRequest)) {
    const spoken = extractSpokenMemory(input.userRequest);
    const reply = spoken
      ? `Gemerk: ${spoken.content}`
      : "Das merke ich mir nicht. Sag mir den Satz, den ich behalten soll.";
    if (spoken) {
      await upsertDurableMemory({
        organizationId: input.organizationId,
        type: spoken.type,
        title: spoken.title,
        content: spoken.content,
        sourceType: "conversation_message",
        sourceReference: input.conversationId,
      });
    }
    await emit(input.onEvent, { type: "delta", delta: reply });
    rememberConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userRequest: input.userRequest,
      reply,
    });
    return {
      jobId: "",
      status: "completed",
      orbState: "DONE",
      statusMessage: spoken ? "Gemerkt." : "Nichts gemerkt.",
      reply,
      mock: false,
      providerMode: "fallback",
      providerId: "memory",
      model: "nova-memory",
    };
  }

  if (dialog.kind !== "social" && /\bdauerfreigabe\b/i.test(input.userRequest)) {
    const reply =
      "Dauerfreigabe schaltest du in der Freigabe-Karte mit „Immer erlauben“. Dann darf NOVA denselben Aktionstyp ohne erneute Nachfrage ausführen. Unter Freigaben kannst du bestehende Dauerfreigaben wieder entfernen. Ich aktiviere das nicht von allein.";
    await emit(input.onEvent, { type: "delta", delta: reply });
    rememberConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userRequest: input.userRequest,
      reply,
    });
    return {
      jobId: "",
      status: "completed",
      orbState: "DONE",
      statusMessage: "Dauerfreigabe erklärt.",
      reply,
      mock: false,
      providerMode: "fallback",
      providerId: "approvals",
      model: "nova-approvals",
    };
  }

  if (
    dialog.kind !== "social" &&
    /\barchiv\b/i.test(input.userRequest) &&
    /\b(such|find|zeig|öffne|durchsuch)\w*\b/i.test(input.userRequest)
  ) {
    const { listArchive } = await import("@/services/archive");
    const query = input.userRequest
      .replace(/\b(?:such(?:e)?|find(?:e)?|zeig(?:e)?|öffne|oeffne|durchsuch(?:e)?)\b/gi, " ")
      .replace(/\b(?:im|in(?:s)?|mein(?:em)?|das|dem|archiv|nach|bitte)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const { activities, conversationMessages } = await listArchive({
      organizationId: input.organizationId,
      query: query || input.userRequest,
      type: "all",
    });
    const hits = [
      ...conversationMessages.slice(0, 6).map((item) => `- Gespräch: ${item.content.slice(0, 140)}`),
      ...activities.slice(0, 6).map((item) => `- ${item.type}: ${item.title}`),
    ].slice(0, 8);
    const reply = hits.length
      ? `Im Archiv zu „${query || "deiner Suche"}“:\n${hits.join("\n")}`
      : `Im Archiv finde ich nichts zu „${query || "deiner Suche"}“.`;
    await emit(input.onEvent, { type: "delta", delta: reply });
    rememberConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userRequest: input.userRequest,
      reply,
    });
    return {
      jobId: "",
      status: "completed",
      orbState: "DONE",
      statusMessage: "Archiv geprüft.",
      reply,
      mock: false,
      providerMode: "fallback",
      providerId: "archive",
      model: "nova-archive",
    };
  }

  if (dialog.kind !== "social" && computerIntent.kind !== "none") {
    return runComputerMasterPath(input, computerIntent.statusMessage);
  }

  if (!input.ownedJobId && dialog.kind !== "social" && needsLiveResearch(input.userRequest)) {
    const { startOwnedJob } = await import("@/services/jobs/owned");
    return startOwnedJob({
      organizationId: input.organizationId,
      userRequest: input.userRequest,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      kind: "planner.run",
      goal: "Aktuelle Information prüfen",
      onEvent: input.onEvent,
      signal: input.signal,
    });
  }
  return runPlannerBody(input, dialog);
}

async function runPlannerBody(
  input: {
    organizationId: string;
    userRequest: string;
    conversationId?: string;
    sourceMessageId?: string;
    onEvent?: (event: MasterEvent) => void;
    ownedJobId?: string;
    workItemId?: string;
    signal?: AbortSignal;
  },
  dialog: DialogMove,
): Promise<MasterRunResult> {
  const specialist = needsSpecialistWork(input.userRequest);
  const flagship = needsFlagshipModel(input.userRequest);
  const [{ provider, decision }, project, contextPack] = await Promise.all([
    resolveAIProvider(input.organizationId, flagship ? "master" : "simple"),
    getDefaultProject(input.organizationId),
    loadRelevantBusinessContext({
      organizationId: input.organizationId,
      query: input.userRequest,
      conversationId: input.conversationId,
      mode: dialog.kind === "social" ? "social" : "full",
    }),
  ]);
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

  if (!specialist) {
    const result = await runDirectReply({
      userRequest: input.userRequest,
      dialog,
      onEvent: input.onEvent,
      provider,
      decision,
      mode,
      contextPack,
    });
    rememberConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userRequest: input.userRequest,
      reply: result.reply,
    });
    return result;
  }

  const available = implementedAgentIds();
  const plan = await provider.structuredOutput<MasterPlan>({
    model: decision.model,
    schemaName: "master-plan",
    schemaDescription:
      'JSON mit intent, goal, agents (Teilmenge von research|communication|task|project|coding|knowledge|calendar|watch|contact), needsApproval, remember, searchRequired, externalAction (none|mail.send|calendar|other), replyHint, communicationBrief, taskDraft, projectDraft {create,name,description,list}, memoryItems [{type,title,content}], mock=false wenn echter Provider.',
    prompt: `Du bist NOVA, persönlicher Business-Assistent der Organization ${contextPack.organizationName}.
Entscheide anhand von Intent und Kontext, nicht anhand einzelner Keywords, ob du direkt antwortest oder interne Agenten nutzt.

Verfügbare implementierte Agenten: ${available.join(", ")}

Regeln:
- Direkt antworten, wenn vorhandenes Memory/Projektwissen reicht.
- research nur bei Bedarf an externer Recherche.
- knowledge für Dokumentimport, Ordnerlesen und Fragen an vorhandene Unterlagen. Nicht für Codeänderungen.
- communication für Mail-/Anschreiben-Entwürfe, niemals Versand ohne Connector.
- task für Aufgaben/Deadlines und lokale Tickets. Kein externes CRM.
- contact für das lokale NOVA-Adressbuch, kein HubSpot/Google.
- calendar für Termine im NOVA-Kalender (anlegen/listen), nicht Google.
- watch für überfällige Aufgaben, alte Entwürfe, anstehende Termine.
- project für Projektübersicht, Status oder neues Projekt.
- coding für Softwareentwicklung, Website-Bau und Cursor-Umsetzung. Der Master schreibt keinen Projektcode selbst.
- remember=true nur bei langlebigen Fakten (Entscheidungen, Projekte, Firmen, Kontakte, Aufgaben, Präferenzen, Deadlines, Zusagen). Kein Smalltalk speichern.
- Erfinde keine Fakten, Firmen oder Kontakte.
- searchRequired=true wenn aktuelle Webrecherche nötig ist (aktuell, heute, Preis, Version, News, wer ist derzeit, gibt es inzwischen).
- Ohne echte Recherche keine aktuellen Fakten behaupten.

Kontext dieser Organization (Retrieval, nicht die ganze Datenbank):
${contextPack.promptBlock}

Benutzeranfrage:
${input.userRequest}`,
  });

  const goal = plan.goal?.trim() || input.userRequest;
  const requestedAgents = (plan.agents ?? []).filter((id) => available.includes(id));
  if (needsLiveResearch(input.userRequest) && !requestedAgents.includes("research")) {
    requestedAgents.push("research");
  }
  if (detectCalendarIntent(input.userRequest) && !requestedAgents.includes("calendar")) {
    requestedAgents.push("calendar");
  }
  if (detectWatchIntent(input.userRequest) && !requestedAgents.includes("watch")) {
    requestedAgents.push("watch");
  }
  if (detectContactIntent(input.userRequest) && !needsLiveResearch(input.userRequest) && !requestedAgents.includes("contact")) {
    requestedAgents.push("contact");
  }
  if (detectTicketIntent(input.userRequest) === "create" && !requestedAgents.includes("task")) {
    requestedAgents.push("task");
    if (!plan.taskDraft?.title) {
      plan.taskDraft = { title: guessTicketTitle(input.userRequest), description: input.userRequest, dueDays: 1 };
    }
  }
  const allowMockCatalog = false;

  const existingJob = input.ownedJobId
    ? await prisma.job.findFirst({
        where: { id: input.ownedJobId, organizationId: input.organizationId },
      })
    : null;
  if (input.ownedJobId && !existingJob) {
    throw new Error("Der übernommene Auftrag fehlt.");
  }
  const job =
    existingJob ??
    (await createJob({
      organizationId: input.organizationId,
      userRequest: input.userRequest,
      goal,
      projectId: project?.id,
    }));

  const long =
    requestedAgents.includes("research") ||
    requestedAgents.includes("coding") ||
    plan.searchRequired === true;
  if (!input.ownedJobId && long) {
    const { enqueueWorkItem } = await import("@/services/worker/queue");
    const { waitForOwnedJob } = await import("@/services/jobs/owned");
    await updateJobStatus(input.organizationId, job.id, "running", { startedAt: new Date() });
    await enqueueWorkItem({
      organizationId: input.organizationId,
      jobId: job.id,
      kind: "planner.run",
      idempotencyKey: `planner.run:${job.id}`,
      payload: {
        userRequest: input.userRequest,
        conversationId: input.conversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
      },
    });
    return waitForOwnedJob({
      organizationId: input.organizationId,
      jobId: job.id,
      providerId: "planner.run",
      signal: input.signal,
      onEvent: input.onEvent,
    });
  }

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
  let researchFailed = false;
  let researchAnswer = "";
  const researchMemory: MemoryItem[] = [];

  const shouldRun = (id: string) => requestedAgents.includes(id);

  if (shouldRun("coding")) {
    await emit(input.onEvent, { type: "status", orbState: "WORKING", statusMessage: "Cursor setzt den Auftrag um." });
    const codingEffect = await onceExternal({
      organizationId: input.organizationId,
      workItemId: input.workItemId,
      idempotencyKey: `coding:${job.id}`,
      effectType: "cursor",
      run: () =>
        runCodingAgent({
          organizationId: input.organizationId,
          jobId: job.id,
          userRequest: input.userRequest,
          onStatus: (message) => {
            void emit(input.onEvent, { type: "status", orbState: "WORKING", statusMessage: message });
          },
        }),
    });
    if (codingEffect.uncertain || !codingEffect.value) {
      const reply = "Der Cursor-Lauf ist nicht bestätigt. Ich starte ihn nicht noch einmal.";
      await updateJobStatus(input.organizationId, job.id, "paused");
      return {
        jobId: job.id,
        status: "paused",
        orbState: "ERROR",
        statusMessage: "Nicht bestätigt",
        reply,
        mock: false,
        providerMode: mode,
        providerId: provider.id,
        model: decision.model,
      };
    }
    const coding = codingEffect.value;
    if (coding.reply) {
      await emit(input.onEvent, { type: "delta", delta: coding.reply });
    }
    const jobStatus =
      coding.status === "WAITING_FOR_APPROVAL"
        ? "waiting_for_approval"
        : coding.status === "CANCELLED_BY_USER"
          ? "cancelled"
          : coding.status === "FAILED" || coding.status === "UNVERIFIED"
            ? "failed"
            : "completed";
    await updateJobStatus(input.organizationId, job.id, jobStatus, { completedAt: new Date() });
    return {
      jobId: job.id,
      status: jobStatus,
      orbState:
        coding.status === "WAITING_FOR_APPROVAL"
          ? "WAITING_FOR_APPROVAL"
          : coding.status === "FAILED"
            ? "ERROR"
            : "DONE",
      statusMessage: coding.statusMessage,
      reply: coding.reply,
      approvalId: coding.approvalId,
      mock: false,
      providerMode: mode,
      providerId: provider.id,
      model: decision.model,
    };
  }

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
      const researchEffect = await onceExternal({
        organizationId: input.organizationId,
        workItemId: input.workItemId,
        idempotencyKey: `research:${job.id}`,
        effectType: "research",
        run: () =>
          runAgentStep({
            agent: research,
            action: "research",
            payload: {
              count: plan.count ?? 10,
              projectId: project?.id,
              query: input.userRequest,
              allowMockCatalog,
            },
            context,
          }),
      });
      if (researchEffect.uncertain || !researchEffect.value) {
        const reply = "Die Recherche ist nicht bestätigt. Ich starte sie nicht noch einmal.";
        await updateJobStatus(input.organizationId, job.id, "paused");
        return {
          jobId: job.id,
          status: "paused",
          orbState: "ERROR",
          statusMessage: "Nicht bestätigt",
          reply,
          mock: false,
          providerMode: mode,
          providerId: provider.id,
          model: decision.model,
        };
      }
      const result = researchEffect.value;
      agentNotes.push(`Research Agent: ${result.result.summary}`);
      const ids = (result.result.data.contactIds as string[]) ?? [];
      contactIds.push(...ids);
      const sourcePreview = Array.isArray(result.result.data.sources)
        ? (result.result.data.sources as Array<{ title?: string; url?: string; domain?: string }>)
            .slice(0, 8)
            .map((item) => `${item.title ?? item.domain ?? "Quelle"} (${item.url ?? ""})`)
            .join("; ")
        : "";
      const contradictions = Array.isArray(result.result.data.contradictions)
        ? JSON.stringify(result.result.data.contradictions).slice(0, 800)
        : "";
      if (result.result.data.searchConnected === false && result.result.data.mock !== true) {
        researchBlocked = true;
      } else if (result.result.ok === false || result.result.data.confidence === "none") {
        researchFailed = true;
      } else if (typeof result.result.data.answer === "string" && result.result.data.answer.trim()) {
        researchAnswer = result.result.data.answer
          .trim()
          .replace(/\s*\(?SOURCE_ID=[a-z0-9_-]+\)?/gi, "")
          .replace(/[ \t]+\n/g, "\n")
          .trim();
        const asOf = String(result.result.data.asOf ?? "").trim();
        const firstSource = Array.isArray(result.result.data.sources)
          ? (result.result.data.sources as Array<{ title?: string; url?: string; domain?: string }>)[0]
          : undefined;
        if (asOf && !/stand/i.test(researchAnswer)) {
          researchAnswer += ` Stand: ${asOf}.`;
        }
        if (firstSource?.domain && !new RegExp(firstSource.domain.replace(/\./g, "\\."), "i").test(researchAnswer)) {
          researchAnswer += ` Quelle: ${firstSource.title || firstSource.domain}.`;
        }
        agentNotes.push(
          `Rechercheergebnis (Stand ${asOf}): ${researchAnswer}\nQuellen: ${sourcePreview}${
            contradictions && contradictions !== "[]" ? `\nWidersprüche: ${contradictions}` : ""
          }`,
        );
      }
      const candidates = Array.isArray(result.result.data.memoryCandidates)
        ? (result.result.data.memoryCandidates as Array<{ type?: string; title?: string; content?: string; sourceId?: string }>)
        : [];
      for (const item of candidates) {
        if (!item.title || !item.content || !item.sourceId) continue;
        const webSource = await prisma.source.findFirst({
          where: { id: item.sourceId, organizationId: input.organizationId },
        });
        researchMemory.push({
          type: item.type ?? "fact",
          title: item.title,
          content: item.content,
          sourceId: item.sourceId,
          sourceUrl: webSource?.url ?? undefined,
        });
      }
      await recordActivity({
        organizationId: input.organizationId,
        type: "research",
        title: result.result.mock
          ? "Recherche vorbereitet (Mock)"
          : result.result.ok
            ? "Recherche abgeschlossen"
            : "Recherche nicht zuverlässig möglich",
        description: result.result.summary,
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
        externalUrl: Array.isArray(result.result.data.sources)
          ? ((result.result.data.sources as Array<{ url?: string }>)[0]?.url ?? undefined)
          : undefined,
        metadata: {
          mock: Boolean(result.result.mock),
          searchConnected: result.result.data.searchConnected === true,
          invented: false,
          queries: result.result.data.queries ?? [],
          sourceIds: result.result.data.sourceIds ?? [],
          asOf: result.result.data.asOf ?? null,
          confidence: result.result.data.confidence ?? null,
          injectionSuspected: result.result.data.injectionSuspected === true,
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
        description: "Entwurf gespeichert. Es wurde keine E-Mail versendet.",
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
          ticket: detectTicketIntent(input.userRequest) === "create",
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

  if (shouldRun("calendar") || plan.externalAction === "calendar") {
    const calendar = getAgent("calendar");
    if (calendar) {
      const result = await runAgentStep({
        agent: calendar,
        action: "calendar",
        payload: { userRequest: input.userRequest },
        context,
      });
      agentNotes.push(`Calendar Agent: ${result.result.summary}`);
      await recordActivity({
        organizationId: input.organizationId,
        type: "calendar",
        title: result.result.data.executed ? "Kalender aktualisiert" : "Kalender nicht geändert",
        description: result.result.summary,
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
        metadata: { executed: Boolean(result.result.data.executed), action: result.result.data.action ?? null, local: true },
      });
    }
  }

  if (shouldRun("contact") || detectContactIntent(input.userRequest)) {
    const contact = getAgent("contact");
    if (contact) {
      const result = await runAgentStep({
        agent: contact,
        action: "contact",
        payload: { userRequest: input.userRequest },
        context,
      });
      agentNotes.push(`Contact Agent: ${result.result.summary}`);
      await recordActivity({
        organizationId: input.organizationId,
        type: "communication",
        title: result.result.data.action === "create" ? "Kontakt gespeichert" : "Adressbuch gelesen",
        description: result.result.summary,
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
        metadata: {
          executed: Boolean(result.result.data.executed),
          action: result.result.data.action ?? null,
          local: true,
          externalCrm: false,
        },
      });
    }
  }

  if (shouldRun("watch")) {
    const watch = getAgent("watch");
    if (watch) {
      const result = await runAgentStep({
        agent: watch,
        action: "watch",
        payload: { userRequest: input.userRequest },
        context,
      });
      agentNotes.push(`Watch Agent: ${result.result.summary}`);
      await recordActivity({
        organizationId: input.organizationId,
        type: "task",
        title: "Lage geprüft",
        description: result.result.summary,
        status: "prepared",
        jobId: job.id,
        projectId: project?.id,
        metadata: {
          overdue: result.result.data.overdue ?? 0,
          staleDrafts: result.result.data.staleDrafts ?? 0,
          upcoming: result.result.data.upcoming ?? 0,
        },
      });
    }
  }

  let memoryItems = (plan.memoryItems ?? []).filter((item) => item.title && item.content);
  if (researchMemory.length > 0) {
    memoryItems = [...memoryItems, ...researchMemory];
  }

  let approvalId: string | undefined;
  let orbState: OrbState = "DONE";
  let statusMessage = "Erledigt.";
  const wantsExternal = plan.needsApproval === true || plan.externalAction === "mail.send";
  const mailConnected = await isRealConnectorEnabled(input.organizationId, "mail");

  if (wantsExternal && communicationIds.length > 0) {
    const standing = await standingApprovalAllows({
      organizationId: input.organizationId,
      actionType: "mail.send.batch",
    });
    if (standing.allowed && mailConnected) {
      await consumeStandingApproval({
        organizationId: input.organizationId,
        actionType: "mail.send.batch",
        jobId: job.id,
        description: `${communicationIds.length} Entwurf(e) über Dauerfreigabe.`,
        payload: { communicationIds },
      });
      const { deliverApprovedDraft } = await import("@/services/mail/send");
      let sent = 0;
      for (const communicationId of communicationIds) {
        const sendEffect = await onceExternal({
          organizationId: input.organizationId,
          workItemId: input.workItemId,
          idempotencyKey: `mail-send:${communicationId}`,
          effectType: "mail.send",
          run: () =>
            deliverApprovedDraft({
              organizationId: input.organizationId,
              communicationId,
              approved: true,
            }),
        });
        if (sendEffect.value?.status === "VERIFIED") sent += 1;
      }
      await recordActivity({
        organizationId: input.organizationId,
        type: "communication",
        title: sent ? `${sent} Mail(s) über Dauerfreigabe gesendet` : "Dauerfreigabe: nichts versendet",
        description: standing.reason,
        status: sent ? "executed" : "failed",
        actuallyExecutedExternally: sent > 0,
        jobId: job.id,
        projectId: project?.id,
        metadata: { standingPolicyId: standing.policyId, sent, executed: sent > 0 },
      });
    } else {
    const approval = await createApprovalRequest({
      organizationId: input.organizationId,
      jobId: job.id,
      actionType: "mail.send.batch",
      description: mailConnected
        ? `${communicationIds.length} Entwurf(e) liegen vor. Versand braucht Freigabe oder eine Dauerfreigabe.`
        : `${communicationIds.length} Entwurf(e) liegen vor. Versand würde Freigabe brauchen. Derzeit ist kein Mail-Connector verbunden. Auch nach Freigabe wird nichts versendet.`,
      payload: {
        communicationIds,
        mock: !mailConnected,
        wouldSend: mailConnected,
        status: "prepared",
      },
    });
    approvalId = approval.id;
    orbState = "WAITING_FOR_APPROVAL";
    statusMessage = mailConnected
      ? "Entwurf vorbereitet. Für den Versand ist Freigabe nötig."
      : "Entwurf vorbereitet. Für einen Versand wäre Freigabe nötig – Connector noch nicht verbunden.";
    await recordActivity({
      organizationId: input.organizationId,
      type: "approval",
      title: mailConnected ? "Freigabe für Versand" : "Freigabe vorbereitet – Versand nicht möglich",
      description: approval.description,
      status: "suggested",
      jobId: job.id,
      projectId: project?.id,
      metadata: { approvalId: approval.id, executed: false, mailConnected },
    });
    await updateJobStatus(input.organizationId, job.id, "waiting_for_approval");
    }
  }

  const drafts = communicationIds.length
    ? await prisma.communication.findMany({
        where: { organizationId: input.organizationId, id: { in: communicationIds } },
      })
    : [];

  const researchUnavailable = researchBlocked || researchFailed;
  const researchOnly = Boolean(researchAnswer) && communicationIds.length === 0 && !wantsExternal;
  let filingNote = "";
  let reviewWaiting = false;
  if (researchAnswer && !researchUnavailable) {
    try {
      const filedEffect = await onceExternal({
        organizationId: input.organizationId,
        workItemId: input.workItemId,
        idempotencyKey: `research-file:${job.id}`,
        effectType: "research-file",
        run: () =>
          fileArtifact({
            organizationId: input.organizationId,
            jobId: job.id,
            projectId: project?.id,
            type: "RESEARCH_REPORT",
            title: goal.slice(0, 80),
            description: input.userRequest.slice(0, 240),
            body: `# ${goal}\n\n${researchAnswer}\n`,
            source: "research",
            openReview: communicationIds.length === 0,
            metadata: { userRequest: input.userRequest },
          }),
      });
      if (filedEffect.uncertain || !filedEffect.value) {
        filingNote = "Die Ablage ist nicht bestätigt. Ich lege sie nicht noch einmal an.";
      } else {
        filingNote = filedEffect.value.message;
        reviewWaiting = Boolean(filedEffect.value.reviewSessionId);
      }
      if (filingNote) agentNotes.push(filingNote);
    } catch (error) {
      filingNote = error instanceof Error ? error.message : "Ablage fehlgeschlagen.";
    }
  }
  let reply = "";
  if (researchUnavailable && communicationIds.length === 0) {
    reply = "Ich kann die aktuelle Information gerade nicht zuverlässig prüfen.";
    await emit(input.onEvent, { type: "delta", delta: reply });
  } else if (researchOnly) {
    reply = filingNote ? `${researchAnswer}\n\n${filingNote}` : researchAnswer;
    await emit(input.onEvent, { type: "delta", delta: reply });
  } else {
    reply = await collectStream({
      provider,
      generateInput: {
        model: decision.model,
        temperature: 0.4,
        system: novaReplySystem({
          organizationName: contextPack.organizationName,
          mock: provider.id === "mock",
          dialog,
          tone: toneInstruction(detectUserTone(input.userRequest)),
          researchAnswer,
          researchBlocked,
          researchFailed,
        }),
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

${researchAnswer ? `Kurzfassung der Recherche:\n${researchAnswer}\n` : ""}

Formuliere die Nutzerantwort. Wenn ein Entwurf erzeugt wurde, zeige ihn.${
          researchUnavailable
            ? " Sage: „Ich kann die aktuelle Information gerade nicht zuverlässig prüfen.“"
            : researchAnswer
              ? " Die Recherche ist erfolgt; verwende sie."
              : ""
        }`,
      },
      onDelta: (delta) => {
        void emit(input.onEvent, { type: "delta", delta });
      },
    });
    if (filingNote) {
      const extra = `\n\n${filingNote}`;
      reply += extra;
      await emit(input.onEvent, { type: "delta", delta: extra });
    }
  }

  if (memoryItems.length === 0 && plan.remember) {
    const extracted = await provider.structuredOutput<{ persist?: boolean; items?: MemoryItem[] }>({
      model: decision.model,
      schemaName: "durable-memory",
      schemaDescription:
        'JSON {persist:boolean, items:[{type,title,content}]}. persist=true nur bei langlebigen Business-Fakten (Entscheidungen, Projekte, Firmen, Kontakte, Aufgaben, Präferenzen, Deadlines, Zusagen). Kein Smalltalk, keine Secrets, nichts erfinden. Keine aktuellen Preise, News oder unbestätigte Web-Snippets speichern.',
      prompt: `Anfrage: ${input.userRequest}\nAntwort: ${reply}\nKontext:\n${contextPack.promptBlock}\nRecherche speichert eigene Kandidaten separat. Welche zusätzlichen langlebigen Fakten sollen ins Business Memory?`,
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

  if (reviewWaiting) {
    orbState = "WAITING_FOR_REVIEW";
    statusMessage = "Das Ergebnis liegt zur Prüfung bereit.";
    await updateJobStatus(input.organizationId, job.id, "waiting_for_review");
  } else if (!wantsExternal || communicationIds.length === 0) {
    await updateJobStatus(input.organizationId, job.id, "completed", { completedAt: new Date() });
  }

  rememberConversation({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    userRequest: input.userRequest,
    reply,
  });

  return {
    jobId: job.id,
    status: reviewWaiting
      ? "waiting_for_review"
      : orbState === "WAITING_FOR_APPROVAL"
        ? "waiting_for_approval"
        : "completed",
    orbState,
    statusMessage,
    reply,
    approvalId,
    actionType: approvalId ? "mail.send.batch" : undefined,
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


async function runLocalMasterPath(
  input: {
    organizationId: string;
    userRequest: string;
    conversationId?: string;
    sourceMessageId?: string;
    onEvent?: (event: MasterEvent) => void;
  },
  statusMessage: string,
  agentId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<MasterRunResult> {
  const project = await getDefaultProject(input.organizationId);
  const job = await createJob({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    goal: statusMessage || input.userRequest,
    projectId: project?.id,
  });
  await updateJobStatus(input.organizationId, job.id, "running", { startedAt: new Date() });
  await emit(input.onEvent, { type: "status", orbState: "WORKING", statusMessage });
  const agent = getAgent(agentId);
  if (!agent) {
    const reply = "Dafür fehlt der interne Weg.";
    await emit(input.onEvent, { type: "delta", delta: reply });
    await updateJobStatus(input.organizationId, job.id, "failed", { completedAt: new Date() });
    return {
      jobId: job.id,
      status: "failed",
      orbState: "ERROR",
      statusMessage: "Weg fehlt.",
      reply,
      mock: false,
      providerMode: "fallback",
      providerId: agentId,
      model: "nova-local",
    };
  }
  const context: AgentRunContext = {
    organizationId: input.organizationId,
    jobId: job.id,
    userRequest: input.userRequest,
    goal: statusMessage || input.userRequest,
    projectId: project?.id,
  };
  const result = await runAgentStep({ agent, action, payload, context });
  const reply = result.result.summary;
  await emit(input.onEvent, { type: "delta", delta: reply });
  await recordActivity({
    organizationId: input.organizationId,
    type: agentId === "calendar" ? "calendar" : agentId === "task" ? "task" : agentId === "contact" ? "communication" : "task",
    title: reply.slice(0, 140),
    description: reply,
    status: "prepared",
    jobId: job.id,
    projectId: project?.id,
  });
  await updateJobStatus(input.organizationId, job.id, result.result.ok ? "completed" : "failed", {
    completedAt: new Date(),
  });
  rememberConversation({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    userRequest: input.userRequest,
    reply,
    domain: agentId === "contact" ? "contacts" : agentId === "project" ? "projects" : agentId === "calendar" ? "calendar" : agentId === "task" || agentId === "watch" ? "tasks" : agentId,
  });
  return {
    jobId: job.id,
    status: result.result.ok ? "completed" : "failed",
    orbState: result.result.ok ? "DONE" : "ERROR",
    statusMessage,
    reply,
    mock: false,
    providerMode: "fallback",
    providerId: agentId,
    model: "nova-local",
  };
}

async function runMailMasterPath(
  input: {
    organizationId: string;
    userRequest: string;
    conversationId?: string;
    sourceMessageId?: string;
    onEvent?: (event: MasterEvent) => void;
  },
  statusMessage: string,
): Promise<MasterRunResult> {
  await emit(input.onEvent, { type: "status", orbState: "THINKING", statusMessage });
  const { answerMail } = await import("@/services/mail/answer");
  const result = await answerMail({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    onConsentPrompt: () => {
      void emit(input.onEvent, {
        type: "status",
        orbState: "THINKING",
        statusMessage: "macOS benötigt einmalig deine Freigabe für Apple Mail.",
      });
      void emit(input.onEvent, {
        type: "delta",
        delta: "macOS benötigt einmalig deine Freigabe für Apple Mail.",
      });
    },
  });
  await emit(input.onEvent, { type: "delta", delta: result.reply });
  rememberConversation({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    userRequest: input.userRequest,
    reply: result.reply,
    domain: "mail",
  });
  return {
    jobId: "",
    status: result.waitingApproval ? "waiting_for_approval" : "completed",
    orbState: result.waitingApproval ? "WAITING_FOR_APPROVAL" : "DONE",
    statusMessage: result.statusMessage,
    reply: result.reply,
    mock: false,
    providerMode: "fallback",
    providerId: "mail",
    model: "nova-mail",
    approvalId: result.approvalId,
  };
}

async function runKnowledgeQueryPath(
  input: {
    organizationId: string;
    userRequest: string;
    conversationId?: string;
    sourceMessageId?: string;
    onEvent?: (event: MasterEvent) => void;
  },
  statusMessage: string,
): Promise<MasterRunResult> {
  await emit(input.onEvent, { type: "status", orbState: "THINKING", statusMessage });
  const result = await runKnowledgeAgent({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    query: input.userRequest,
  });
  if (result.reply) {
    await emit(input.onEvent, { type: "delta", delta: result.reply });
  }
    rememberConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userRequest: input.userRequest,
      reply: result.reply,
      domain: "knowledge",
    });
    return {
      jobId: "",
      status: "completed",
      orbState: "DONE",
      statusMessage: result.statusMessage,
      reply: result.reply,
      mock: false,
      providerMode: "fallback",
      providerId: "knowledge",
    model: "nova-knowledge",
  };
}

async function runKnowledgeMasterPath(
  input: {
    organizationId: string;
    userRequest: string;
    conversationId?: string;
    sourceMessageId?: string;
    onEvent?: (event: MasterEvent) => void;
    signal?: AbortSignal;
  },
  statusMessage: string,
): Promise<MasterRunResult> {
  const { startOwnedJob } = await import("@/services/jobs/owned");
  const project = await getDefaultProject(input.organizationId);
  return startOwnedJob({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    kind: "knowledge.run",
    goal: statusMessage || input.userRequest,
    projectId: project?.id,
    onEvent: input.onEvent,
    signal: input.signal,
  });
}

async function runComputerMasterPath(
  input: {
    organizationId: string;
    userRequest: string;
    conversationId?: string;
    sourceMessageId?: string;
    onEvent?: (event: MasterEvent) => void;
    signal?: AbortSignal;
  },
  statusMessage: string,
): Promise<MasterRunResult> {
  const { startOwnedJob } = await import("@/services/jobs/owned");
  const project = await getDefaultProject(input.organizationId);
  return startOwnedJob({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    kind: "computer.run",
    goal: statusMessage || input.userRequest,
    projectId: project?.id,
    onEvent: input.onEvent,
    signal: input.signal,
  });
}

async function runCodingMasterPath(
  input: {
    organizationId: string;
    userRequest: string;
    conversationId?: string;
    sourceMessageId?: string;
    onEvent?: (event: MasterEvent) => void;
    signal?: AbortSignal;
  },
  statusMessage: string,
): Promise<MasterRunResult> {
  const { startOwnedJob } = await import("@/services/jobs/owned");
  const project = await getDefaultProject(input.organizationId);
  return startOwnedJob({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    kind: "coding.run",
    goal: statusMessage || input.userRequest,
    projectId: project?.id,
    onEvent: input.onEvent,
    signal: input.signal,
  });
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
