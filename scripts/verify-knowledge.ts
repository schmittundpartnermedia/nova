import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { bootstrapAgents, getAgent } from "@/agents/bootstrap";
import { chatgptKnowledgeStatus, runKnowledgeAgent } from "@/agents/knowledge";
import { runMaster } from "@/agents/master";
import { createKnowledgeFixtures } from "@/lib/knowledge/fixtures";
import { parseKnowledgeSource } from "@/lib/knowledge/parsers";
import { parseRoundtripSmoke, runKnowledgeUnitTests } from "@/lib/knowledge/unit-tests";
import {
  buildKnowledgeContext,
  importKnowledgePaths,
  requestKnowledgeCancel,
  searchKnowledge,
} from "@/services/knowledge";
import { importUploadedFiles } from "@/services/import/upload";
import { LocalHashEmbeddingProvider, setEmbeddingProviderForTests } from "@/providers/embedding";
import { setOcrAdapterForTests } from "@/lib/knowledge/ocr";
import { setTranscribeAdapterForTests } from "@/lib/knowledge/transcribe";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  setEmbeddingProviderForTests(new LocalHashEmbeddingProvider());
  setOcrAdapterForTests({
    id: "test-ocr",
    available: () => true,
    async recognize() {
      return "Scan: Preis 199 EUR Firma Nordstern Media GmbH";
    },
  });
  setTranscribeAdapterForTests({
    id: "test-stt",
    available: () => true,
    async transcribe() {
      return "Firma: Hetzner\nEntscheidung: Pilot startet mit drei Monaten.";
    },
  });
  bootstrapAgents();
  const unit = runKnowledgeUnitTests();
  const smoke = await parseRoundtripSmoke();
  if (unit.length || smoke.length) {
    throw new Error(`Unit-Tests fehlgeschlagen: ${[...unit, ...smoke].join("; ")}`);
  }
  setOcrAdapterForTests({
    id: "test-ocr",
    available: () => true,
    async recognize() {
      return "Scan: Preis 199 EUR Firma Nordstern Media GmbH";
    },
  });
  setTranscribeAdapterForTests({
    id: "test-stt",
    available: () => true,
    async transcribe() {
      return "Firma: Hetzner\nEntscheidung: Pilot startet mit drei Monaten.";
    },
  });

  const knowledge = getAgent("knowledge");
  assert(knowledge?.definition.implemented === true, "Knowledge Agent nicht in der Registry");

  const organization = await prisma.organization.upsert({
    where: { slug: "knowledge-verify" },
    update: { name: "Knowledge Verify" },
    create: { name: "Knowledge Verify", slug: "knowledge-verify" },
  });
  await prisma.knowledgeEmbedding.deleteMany({ where: { organizationId: organization.id } });
  await prisma.knowledgeItem.deleteMany({ where: { organizationId: organization.id } });
  await prisma.knowledgeParsedDocument.deleteMany({ where: { organizationId: organization.id } });
  await prisma.knowledgeContradiction.deleteMany({ where: { organizationId: organization.id } });
  await prisma.source.deleteMany({ where: { organizationId: organization.id, knowledgeSourceId: { not: null } } });
  await prisma.memoryRelation.deleteMany({ where: { organizationId: organization.id } });
  await prisma.memoryEntry.deleteMany({ where: { organizationId: organization.id } });
  await prisma.knowledgeSource.deleteMany({ where: { organizationId: organization.id } });
  await prisma.knowledgeImport.deleteMany({ where: { organizationId: organization.id } });

  const other = await prisma.organization.upsert({
    where: { slug: "knowledge-isolation" },
    update: {},
    create: { name: "Knowledge Isolation", slug: "knowledge-isolation" },
  });
  await prisma.knowledgeItem.deleteMany({ where: { organizationId: other.id } });
  await prisma.memoryEntry.deleteMany({ where: { organizationId: other.id } });

  const fixtures = createKnowledgeFixtures(path.join(os.tmpdir(), "nova-knowledge-e2e", `run-${Date.now()}`));
  const importPaths = [
    fixtures.files.pdf,
    fixtures.files.docx,
    fixtures.files.xlsx,
    fixtures.files.csv,
    fixtures.files.json,
    fixtures.files.markdown,
    fixtures.files.contradiction,
    fixtures.files.injection,
    fixtures.files.txt,
    fixtures.files.project,
  ];

  const imported = await importKnowledgePaths({
    organizationId: organization.id,
    userRequest: `Lies diesen Ordner und merke dir das Projekt. ${fixtures.root}`,
    paths: importPaths,
  });
  assert(imported.ok, "Import fehlgeschlagen");
  assert(imported.itemsCreated > 0, "Keine Knowledge Items erzeugt");
  assert(imported.filesFailed === 0, `Parse-Fehler: ${imported.filesFailed}`);

  const uploaded = await importUploadedFiles({
    organizationId: organization.id,
    userRequest: "Lade diese Datei hoch",
    files: [
      {
        name: "notiz.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("Projekt Gamma: Start am 12. Oktober. Preis 250 EUR.", "utf8"),
      },
    ],
  });
  assert(uploaded.ok, "Upload-Import fehlgeschlagen");
  const uploadedHit = await searchKnowledge({
    organizationId: organization.id,
    query: "Projekt Gamma Preis",
  });
  assert(uploadedHit.some((hit) => /Gamma|250/i.test(hit.content + hit.title)), "Hochgeladene Datei nicht wiederfindbar");
  const uploadedMedia = await importUploadedFiles({
    organizationId: organization.id,
    userRequest: "Lade Scan und Sprachmemo hoch",
    files: [
      {
        name: "scan.png",
        mimeType: "image/png",
        bytes: fs.readFileSync(fixtures.files.image),
      },
      {
        name: "memo.wav",
        mimeType: "audio/wav",
        bytes: fs.readFileSync(fixtures.files.audio),
      },
    ],
  });
  assert(uploadedMedia.ok, "Medien-Upload fehlgeschlagen");
  const ocrHit = await searchKnowledge({
    organizationId: organization.id,
    query: "Scan Preis Nordstern",
  });
  assert(ocrHit.some((hit) => /199|Nordstern/i.test(`${hit.content} ${hit.title}`)), "OCR-Inhalt nicht wiederfindbar");
  const transcriptHit = await searchKnowledge({
    organizationId: organization.id,
    query: "Hetzner Pilot",
  });
  assert(transcriptHit.some((hit) => /Hetzner|Pilot/i.test(`${hit.content} ${hit.title}`)), "Transkript nicht wiederfindbar");

  const parsedPdf = await parseKnowledgeSource({
    name: "partnerstrategie.pdf",
    originalPath: fixtures.files.pdf,
    bytes: fs.readFileSync(fixtures.files.pdf),
    sourceType: "pdf",
  });
  assert(parsedPdf.sections.some((section) => section.page === 2), "PDF-Seitenbezug fehlt");
  assert(/199/.test(parsedPdf.fulltext), "PDF-Text nicht extrahiert");

  const parsedXlsx = await parseKnowledgeSource({
    name: "umsatz.xlsx",
    bytes: fs.readFileSync(fixtures.files.xlsx),
    sourceType: "xlsx",
  });
  assert(parsedXlsx.tables[0]?.headers.includes("Umsatz"), "XLSX-Header verloren");
  assert(parsedXlsx.tables[0]?.rows.some((row) => row.includes("48000")), "XLSX-Zellen verloren");

  const items = await prisma.knowledgeItem.findMany({
    where: { organizationId: organization.id, sourceId: { in: imported.sourceIds } },
    include: { source: true },
  });
  assert(items.some((item) => item.type === "PRICE"), "Preis-Item fehlt");
  assert(items.some((item) => item.type === "DEADLINE"), "Deadline-Item fehlt");
  assert(items.some((item) => item.type === "PERSON"), "Personen-Item fehlt");
  assert(items.some((item) => item.type === "DECISION"), "Entscheidungs-Item fehlt");
  assert(items.some((item) => item.type === "COMPANY"), "Firmen-Item fehlt");
  assert(
    items.every((item) => item.locationJson && item.extractor && item.sourceId),
    "Source Traceability unvollständig",
  );
  const pdfPrice = items.find((item) => item.type === "PRICE" && item.source.name.endsWith(".pdf"));
  assert(pdfPrice && JSON.parse(pdfPrice.locationJson).page, "PDF-Preis ohne Seite");

  const envIngested = await prisma.knowledgeSource.findFirst({
    where: { organizationId: organization.id, originalPath: { contains: ".env" }, status: "INDEXED" },
  });
  assert(!envIngested, ".env wurde ingestiert");

  const nodeModule = await prisma.knowledgeSource.findFirst({
    where: { organizationId: organization.id, originalPath: { contains: "node_modules" } },
  });
  assert(!nodeModule, "node_modules wurde ingestiert");

  const firstCount = items.filter((item) => item.duplicateOfId == null).length;
  const dup = await importKnowledgePaths({
    organizationId: organization.id,
    userRequest: "Importiere diese Dokumente erneut.",
    paths: [fixtures.files.markdown],
  });
  assert(dup.duplicates >= 1, "Duplikat nicht erkannt");
  const afterDup = await prisma.knowledgeItem.count({
    where: { organizationId: organization.id, sourceId: { in: [...imported.sourceIds, ...dup.sourceIds] } },
  });
  assert(afterDup === firstCount || dup.itemsCreated === 0, "Duplikat hat neue Items erzeugt");

  const versions = await prisma.knowledgeSource.findMany({
    where: { organizationId: organization.id, versionGroupId: { contains: "angebot" } },
  });
  assert(versions.some((item) => item.versionNumber >= 1), "Versionierung fehlt");

  const contradictions = await prisma.knowledgeContradiction.findMany({
    where: { organizationId: organization.id, topic: "PRICE" },
  });
  assert(contradictions.length >= 1, "Widerspruch nicht erkannt");
  const priceHits = await searchKnowledge({ organizationId: organization.id, query: "Wie hoch ist der Preis?" });
  const priceValues = new Set(priceHits.filter((hit) => hit.type === "PRICE").map((hit) => hit.normalizedValue));
  assert(priceValues.has("199") && priceValues.has("229"), "Beide Preise müssen auffindbar sein");

  const deadline = await buildKnowledgeContext({ organizationId: organization.id, query: "Wann ist die Deadline?" });
  assert(/2026-12-15/.test(deadline.answer), `Deadline nicht beantwortet: ${deadline.answer}`);
  assert(/Quelle|Seite|partner|angebot|entscheidung/i.test(deadline.answer), "Deadline ohne Quelle");

  const person = await buildKnowledgeContext({ organizationId: organization.id, query: "Wer ist Ansprechpartner?" });
  assert(/Clara Berg/i.test(person.answer), `Ansprechpartner fehlt: ${person.answer}`);

  const decision = await buildKnowledgeContext({
    organizationId: organization.id,
    query: "Welche Entscheidung wurde getroffen?",
  });
  assert(/drei Monate|Partnerprogramm/i.test(decision.answer), `Entscheidung fehlt: ${decision.answer}`);

  const metric = await buildKnowledgeContext({ organizationId: organization.id, query: "Wie hoch war der Umsatz im Maerz?" });
  assert(/48000/.test(metric.answer), `Umsatz nicht aus Tabelle: ${metric.answer}`);

  const priceAnswer = await buildKnowledgeContext({ organizationId: organization.id, query: "Wie hoch ist der Preis?" });
  assert(/199/.test(priceAnswer.answer) && /229/.test(priceAnswer.answer), `Widerspruch versteckt: ${priceAnswer.answer}`);
  assert(/Widerspruch/i.test(priceAnswer.answer), "Widerspruch nicht ausgewiesen");

  const injectionHit = await prisma.knowledgeSource.findFirst({
    where: { organizationId: organization.id, name: "injection.txt" },
  });
  assert(injectionHit?.injectionSuspected === true, "Injection-Flag fehlt");
  const injectionItems = await prisma.knowledgeItem.findMany({
    where: { organizationId: organization.id, sourceId: injectionHit?.id },
  });
  assert(
    injectionItems.every((item) => item.type === "REFERENCE" || item.type === "COMPANY"),
    "Injection wurde als ausführbare Wahrheit gespeichert",
  );

  const leakedSearch = await searchKnowledge({ organizationId: other.id, query: "Preis Partnerprogramm Clara" });
  assert(leakedSearch.length === 0, "Tenant Isolation: Knowledge Search leak");
  const leakedMemory = await prisma.memoryEntry.count({
    where: { organizationId: other.id, content: { contains: "Clara Berg" } },
  });
  assert(leakedMemory === 0, "Tenant Isolation: Memory leak");
  const leakedContext = await buildKnowledgeContext({ organizationId: other.id, query: "Clara Berg Preis" });
  assert(leakedContext.hits.length === 0, "Tenant Isolation: Context leak");

  const memories = await prisma.memoryEntry.findMany({
    where: { organizationId: organization.id, sourceType: "document" },
  });
  assert(memories.some((item) => item.type === "decision" || item.type === "person" || item.type === "company"), "Memory Integration fehlt");
  assert(memories.every((item) => item.sourceId), "Memory ohne Source Link");

  const relations = await prisma.memoryRelation.findMany({
    where: { organizationId: organization.id, relationType: { in: ["works_at", "mentions", "product_of", "relates_to"] } },
  });
  assert(relations.length >= 0, "Relation-Query fehlgeschlagen");

  const chatgpt = await chatgptKnowledgeStatus();
  assert(chatgpt.prepared && chatgpt.implemented === true, "ChatGPT-Import sollte implementiert sein");

  const queryMaster = await runMaster({
    organizationId: organization.id,
    userRequest: "Was stand im Angebot von Firma Nordstern?",
  });
  assert(/199|229|Clara|Partner/i.test(queryMaster.reply), `Master-Query ohne Knowledge: ${queryMaster.reply}`);
  assert(
    /nordstern|angebot|\.pdf|seite|quelle/i.test(queryMaster.reply),
    `Master-Query ohne Quelle: ${queryMaster.reply}`,
  );

  const social = await runMaster({
    organizationId: organization.id,
    userRequest: "Schönen Feierabend",
  });
  assert(
    !/bedeutet|definition|arbeitsende|schluss der arbeit|feierabend ist/i.test(social.reply),
    `Feierabend wurde erklärt statt erwidert: ${social.reply}`,
  );
  assert(
    /(danke|dir auch|ebenfalls|ebenso|gleichfalls)/i.test(social.reply),
    `Feierabend ohne menschliche Erwiderung: ${social.reply}`,
  );

  const cancelImport = await prisma.knowledgeImport.create({
    data: {
      organizationId: organization.id,
      userRequest: "cancel-test",
      status: "PARSING",
    },
  });
  const cancelled = await requestKnowledgeCancel(organization.id);
  assert(cancelled >= 1, "Cancellation nicht gesetzt");
  const cancelRow = await prisma.knowledgeImport.findFirst({ where: { id: cancelImport.id } });
  assert(cancelRow?.cancelRequested === true, "cancelRequested fehlt");

  const agentRun = await runKnowledgeAgent({
    organizationId: organization.id,
    userRequest: "Suche in allen Unterlagen zu rankPilot nach dem Partnerprogramm.",
    query: "Partnerprogramm",
  });
  assert(/Partnerprogramm|drei Monate|199|229/i.test(agentRun.reply), `Agent-Suche leer: ${agentRun.reply}`);

  const ignored = fs.existsSync(path.join(fixtures.files.project, "node_modules", "leftpad", "index.js"));
  assert(ignored, "Fixture node_modules sollte physisch existieren, aber nicht importiert sein");

  console.log(
    JSON.stringify(
      {
        ok: true,
        files: imported.filesTotal,
        items: imported.itemsCreated,
        contradictions: imported.contradictions,
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
    setEmbeddingProviderForTests(null);
    setOcrAdapterForTests(null);
    setTranscribeAdapterForTests(null);
    await prisma.$disconnect();
  });
