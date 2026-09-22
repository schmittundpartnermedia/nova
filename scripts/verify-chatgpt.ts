import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { bootstrapAgents, getAgent } from "@/agents/bootstrap";
import { chatgptKnowledgeStatus, runKnowledgeAgent } from "@/agents/knowledge";
import { runMaster } from "@/agents/master";
import { runChatGPTUnitTests } from "@/lib/chatgpt/unit-tests";
import { createChatGPTExportZip, CHATGPT_FIXTURE_IDS } from "@/lib/chatgpt/fixtures";
import { importChatGPTExport } from "@/services/import/chatgpt";
import { conversationArchive } from "@/services/archive";
import { searchKnowledge } from "@/services/knowledge";
import { requestKnowledgeCancel } from "@/services/knowledge/jobs";
import { looksLikeSecret } from "@/lib/computer/redaction";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function resetOrg(id: string) {
  await prisma.knowledgeEmbedding.deleteMany({ where: { organizationId: id } });
  await prisma.knowledgeItem.deleteMany({ where: { organizationId: id } });
  await prisma.knowledgeParsedDocument.deleteMany({ where: { organizationId: id } });
  await prisma.knowledgeContradiction.deleteMany({ where: { organizationId: id } });
  await prisma.source.deleteMany({ where: { organizationId: id } });
  await prisma.memoryRelation.deleteMany({ where: { organizationId: id } });
  await prisma.memoryEntry.deleteMany({ where: { organizationId: id } });
  await prisma.conversationMessage.deleteMany({ where: { organizationId: id } });
  await prisma.conversation.deleteMany({ where: { organizationId: id } });
  await prisma.knowledgeSource.deleteMany({ where: { organizationId: id } });
  await prisma.knowledgeImport.deleteMany({ where: { organizationId: id } });
}

async function main() {
  bootstrapAgents();
  const unit = runChatGPTUnitTests();
  if (unit.length) throw new Error(`Unit-Tests fehlgeschlagen: ${unit.join("; ")}`);

  const knowledge = getAgent("knowledge");
  assert(knowledge?.definition.implemented === true, "Knowledge Agent nicht in der Registry");
  const chatgpt = await chatgptKnowledgeStatus();
  assert(chatgpt.prepared && chatgpt.implemented === true, "ChatGPT-Import sollte implementiert sein");

  const organization = await prisma.organization.upsert({
    where: { slug: "chatgpt-verify" },
    update: { name: "ChatGPT Verify" },
    create: { name: "ChatGPT Verify", slug: "chatgpt-verify" },
  });
  await resetOrg(organization.id);

  const other = await prisma.organization.upsert({
    where: { slug: "chatgpt-isolation" },
    update: {},
    create: { name: "ChatGPT Isolation", slug: "chatgpt-isolation" },
  });
  await resetOrg(other.id);

  const root = path.join(os.tmpdir(), "nova-chatgpt-e2e", `run-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  const zipPath = path.join(root, "chatgpt-export.zip");
  fs.writeFileSync(zipPath, createChatGPTExportZip());

  const imported = await importChatGPTExport({
    organizationId: organization.id,
    userRequest: `Importiere meinen ChatGPT Verlauf. \`${zipPath}\``,
    filePath: zipPath,
  });
  assert(imported.ok, "Import fehlgeschlagen");
  assert(imported.conversationsImported >= 4, `Zu wenige Conversations: ${imported.conversationsImported}`);
  assert(imported.messagesImported > 0, "Keine Messages importiert");
  assert(imported.itemsCreated > 0, "Keine Knowledge Items");
  assert(imported.decisions >= 1, "Keine Entscheidung extrahiert");

  const conversations = await prisma.conversation.findMany({
    where: { organizationId: organization.id, origin: "chatgpt_import" },
  });
  assert(conversations.filter((item) => item.externalId === CHATGPT_FIXTURE_IDS.alpha).length === 1, "Alpha doppelt oder fehlt");
  const alpha = conversations.find((item) => item.externalId === CHATGPT_FIXTURE_IDS.alpha);
  assert(alpha, "Alpha Conversation fehlt");
  const alphaMessages = await prisma.conversationMessage.findMany({
    where: { organizationId: organization.id, conversationId: alpha!.id },
    orderBy: { createdAt: "asc" },
  });
  assert(alphaMessages.some((item) => item.createdAt.getUTCFullYear() === 2026 && item.createdAt.getUTCMonth() === 8), "Original-Zeitstempel verloren");
  assert(alphaMessages.some((item) => item.metadata && /alternative/.test(item.metadata)), "Branch-Metadata fehlt");
  assert(alphaMessages.some((item) => /Ignore all previous instructions/i.test(item.content)), "Injection-Message nicht archiviert");
  assert(alphaMessages.every((item) => !looksLikeSecret(item.content)), "Secret steht unredaktiert im Archiv");

  const decision = await prisma.knowledgeItem.findFirst({
    where: { organizationId: organization.id, type: "DECISION", content: { contains: "B" } },
  });
  assert(decision, "Decision Knowledge Item fehlt");
  assert(decision?.conversationMessageId, "Decision ohne Message-Link");
  const decisionMessage = await prisma.conversationMessage.findFirst({
    where: { id: decision!.conversationMessageId!, organizationId: organization.id },
  });
  assert(decisionMessage, "Source Message zur Decision nicht gefunden");
  assert(decisionMessage?.conversationId === alpha?.id, "Decision zeigt nicht auf Alpha-Conversation");
  const location = JSON.parse(decision!.locationJson) as { conversationId?: string; messageId?: string };
  assert(location.conversationId === alpha?.id, "Location conversationId fehlt");
  assert(location.messageId, "Location messageId fehlt");

  const prices = await prisma.knowledgeItem.findMany({
    where: { organizationId: organization.id, type: "PRICE" },
    orderBy: { extractedAt: "asc" },
  });
  assert(prices.some((item) => /199/.test(item.content)) && prices.some((item) => /229/.test(item.content)), "Preisänderung fehlt");
  assert(prices.some((item) => item.supersedesId), "Supersession nicht gesetzt");

  const person = await prisma.knowledgeItem.findFirst({
    where: { organizationId: organization.id, type: "PERSON", content: { contains: "Clara" } },
  });
  assert(person, "Person Clara fehlt");
  const company = await prisma.knowledgeItem.findFirst({
    where: { organizationId: organization.id, type: "COMPANY", content: { contains: "Beta" } },
  });
  assert(company, "Firma Beta fehlt");
  const deadline = await prisma.knowledgeItem.findFirst({
    where: { organizationId: organization.id, type: "DEADLINE" },
  });
  assert(deadline, "Deadline fehlt");

  const memories = await prisma.memoryEntry.findMany({ where: { organizationId: organization.id } });
  assert(memories.some((item) => item.type === "decision"), "Decision nicht im Memory");
  assert(memories.every((item) => !looksLikeSecret(item.content) && !looksLikeSecret(item.title)), "Secret im Memory");
  assert(memories.every((item) => item.sourceId), "Memory ohne Source");
  assert(!memories.some((item) => /ok|danke/i.test(item.content) && item.content.length < 20), "Smalltalk im Memory");

  const q1 = await runKnowledgeAgent({ organizationId: organization.id, userRequest: "Welche Entscheidung wurde für Projekt Alpha getroffen?", query: "Welche Entscheidung wurde für Projekt Alpha getroffen?" });
  assert(/B/i.test(q1.reply), `Frage 1 fehlgeschlagen: ${q1.reply}`);
  const q2 = await runKnowledgeAgent({ organizationId: organization.id, userRequest: "Was war der alte Preis und was ist der aktuelle Preis?", query: "Was war der alte Preis und was ist der aktuelle Preis?" });
  assert(/199/.test(q2.reply) && /229/.test(q2.reply), `Frage 2 fehlgeschlagen: ${q2.reply}`);
  const q3 = await runKnowledgeAgent({ organizationId: organization.id, userRequest: "Warum wurde Option A verworfen?", query: "Warum wurde Option A verworfen?" });
  assert(/teuer|verworfen|A/i.test(q3.reply), `Frage 3 fehlgeschlagen: ${q3.reply}`);
  const q4 = await runKnowledgeAgent({ organizationId: organization.id, userRequest: "Wer gehört zu Firma Beta?", query: "Wer gehört zu Firma Beta?" });
  assert(/Clara/i.test(q4.reply), `Frage 4 fehlgeschlagen: ${q4.reply}`);
  const q5 = await runKnowledgeAgent({ organizationId: organization.id, userRequest: "Welche Deadline wurde vereinbart?", query: "Welche Deadline wurde vereinbart?" });
  assert(/15\.10\.2026|2026-10-15/i.test(q5.reply), `Frage 5 fehlgeschlagen: ${q5.reply}`);
  const q6 = await runKnowledgeAgent({ organizationId: organization.id, userRequest: "In welchem Gespräch wurde diese Entscheidung getroffen?", query: "In welchem Gespräch wurde diese Entscheidung getroffen?" });
  assert(/Alpha|Gespräch/i.test(q6.reply), `Frage 6 fehlgeschlagen: ${q6.reply}`);
  const q7 = await runKnowledgeAgent({ organizationId: organization.id, userRequest: "Was wurde später geändert?", query: "Was wurde später geändert?" });
  assert(/229|199|Preis/i.test(q7.reply), `Frage 7 fehlgeschlagen: ${q7.reply}`);

  const archiveHits = await conversationArchive.search({
    organizationId: organization.id,
    query: "Projekt Alpha",
    origin: "chatgpt_import",
    limit: 8,
  });
  assert(archiveHits.length > 0, "Archive Search leer");
  const knowledgeHits = await searchKnowledge({ organizationId: organization.id, query: "Projekt Alpha Entscheidung", limit: 8 });
  assert(knowledgeHits.length > 0, "Knowledge Search leer");

  const computerJobs = await prisma.computerJob.count({ where: { organizationId: organization.id } });
  assert(computerJobs === 0, "Import darf keine Computer Jobs starten");

  const duplicate = await importChatGPTExport({
    organizationId: organization.id,
    userRequest: "Importiere ChatGPT erneut",
    filePath: zipPath,
  });
  assert(duplicate.ok, "Zweiter Import fehlgeschlagen");
  const alphaAgain = await prisma.conversation.count({
    where: { organizationId: organization.id, origin: "chatgpt_import", externalId: CHATGPT_FIXTURE_IDS.alpha },
  });
  assert(alphaAgain === 1, "Duplicate Conversations nach zweitem Import");
  const messageCount = await prisma.conversationMessage.count({
    where: { organizationId: organization.id, conversation: { origin: "chatgpt_import" } },
  });

  const incrementalPath = path.join(root, "chatgpt-export-oct.zip");
  fs.writeFileSync(incrementalPath, createChatGPTExportZip({ incremental: true }));
  const incremental = await importChatGPTExport({
    organizationId: organization.id,
    userRequest: "Importiere neueren ChatGPT Export",
    filePath: incrementalPath,
  });
  assert(incremental.ok, "Inkrementeller Import fehlgeschlagen");
  const omega = await prisma.conversation.findFirst({
    where: { organizationId: organization.id, externalId: CHATGPT_FIXTURE_IDS.omega },
  });
  assert(omega, "Neue Conversation Omega fehlt");
  const extra = await prisma.conversationMessage.findFirst({
    where: { organizationId: organization.id, externalId: "msg-alpha-u3" },
  });
  assert(extra, "Neue Alpha-Message fehlt");
  const afterCount = await prisma.conversationMessage.count({
    where: { organizationId: organization.id, conversation: { origin: "chatgpt_import" } },
  });
  assert(afterCount > messageCount, "Inkrementeller Import hat keine neuen Messages");

  const isolated = await searchKnowledge({ organizationId: other.id, query: "Projekt Alpha", limit: 10 });
  assert(isolated.length === 0, "Tenant Isolation Knowledge gebrochen");
  const isolatedArchive = await conversationArchive.search({ organizationId: other.id, query: "Alpha", limit: 10 });
  assert(isolatedArchive.length === 0, "Tenant Isolation Archive gebrochen");
  const isolatedMemory = await prisma.memoryEntry.findMany({ where: { organizationId: other.id } });
  assert(isolatedMemory.length === 0, "Tenant Isolation Memory gebrochen");

  const cancelImport = await prisma.knowledgeImport.create({
    data: {
      organizationId: organization.id,
      userRequest: "cancel-chatgpt",
      kind: "chatgpt",
      status: "PARSING_CONVERSATIONS",
    },
  });
  const cancelled = await requestKnowledgeCancel(organization.id);
  assert(cancelled >= 1, "Cancellation nicht gesetzt");
  const cancelRow = await prisma.knowledgeImport.findFirst({ where: { id: cancelImport.id } });
  assert(cancelRow?.cancelRequested === true, "cancelRequested fehlt");

  const prompt = await runMaster({
    organizationId: organization.id,
    userRequest: "NOVA, importiere meinen ChatGPT Verlauf.",
  });
  assert(prompt.needsFile === "chatgpt-export", "File-Prompt fehlt");
  assert(/Wähle deinen ChatGPT-Export/i.test(prompt.reply), `Prompt-Reply falsch: ${prompt.reply}`);

  const computer = getAgent("computer");
  const codingAgent = getAgent("coding");
  const research = getAgent("research");
  assert(computer?.definition.implemented, "Computer Agent Regression");
  assert(codingAgent?.definition.implemented, "Coding Agent Regression");
  assert(research?.definition.implemented, "Research Agent Regression");
  assert(knowledge?.definition.implemented, "Knowledge Agent Regression");

  console.log(
    JSON.stringify(
      {
        ok: true,
        conversations: imported.conversationsImported,
        messages: imported.messagesImported,
        items: imported.itemsCreated,
        decisions: imported.decisions,
        incremental: incremental.conversationsImported,
        tenantIsolation: true,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
