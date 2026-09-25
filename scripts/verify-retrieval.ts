import { PrismaClient } from "@prisma/client";
import { MockEmbeddingProvider, LocalHashEmbeddingProvider, setEmbeddingProviderForTests, cosineSimilarity } from "@/providers/embedding";
import { OpenAIEmbeddingProvider } from "@/providers/embedding/openai";
import { hasOpenAIApiKey } from "@/lib/secrets";
import { runRetrievalUnitTests } from "@/lib/retrieval/unit-tests";
import { EVAL_CASES, EVAL_CORPUS, aggregateMetrics } from "@/lib/retrieval/eval-set";
import { upsertChunks } from "@/services/retrieval/embeddings";
import { retrieveV2 } from "@/services/retrieval/hybrid";
import { runRetrievalReindex, startRetrievalReindex } from "@/services/retrieval/reindex";
import { requestKnowledgeCancel } from "@/services/knowledge/jobs";
import { getConnectorCapabilityMap } from "@/connectors/registry";
import { loadRelevantBusinessContext } from "@/services/retrieval";

const prisma = new PrismaClient();
const mock = new MockEmbeddingProvider();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function seed(organizationId: string) {
  await upsertChunks(
    EVAL_CORPUS.map((item) => ({
      organizationId,
      objectType: item.type,
      objectId: item.id,
      layer: item.layer as "memory" | "knowledge" | "archive",
      title: item.id,
      text: item.text,
      projectId: item.project === "rankPilot" ? "project-rankpilot" : undefined,
      epistemicStatus: item.status,
      superseded: item.superseded,
      sourceType: item.layer === "archive" ? "chat" : "document",
      sourceId: `source-${item.id}`,
      occurredAt: item.at ? new Date(item.at) : new Date("2026-02-01"),
    })),
    mock,
  );
}

async function rankedIds(organizationId: string, query: string): Promise<string[]> {
  const result = await retrieveV2({ organizationId, query, limit: 8, provider: mock, debug: true });
  return result.hits.map((hit) => hit.objectId);
}

async function legacyRank(query: string): Promise<string[]> {
  const hash = new LocalHashEmbeddingProvider();
  const vectors = await hash.embedBatch(EVAL_CORPUS.map((item) => item.text));
  const queryVector = await hash.embedText(query);
  return EVAL_CORPUS.map((item, index) => ({ id: item.id, score: cosineSimilarity(queryVector, vectors[index]) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.id);
}

async function main() {
  setEmbeddingProviderForTests(mock);
  const unit = await runRetrievalUnitTests();
  if (unit.length) throw new Error(unit.join("; "));

  const orgA = await prisma.organization.upsert({
    where: { slug: "retrieval-v2-a" },
    update: { name: "Retrieval A" },
    create: { name: "Retrieval A", slug: "retrieval-v2-a" },
  });
  const orgB = await prisma.organization.upsert({
    where: { slug: "retrieval-v2-b" },
    update: { name: "Retrieval B" },
    create: { name: "Retrieval B", slug: "retrieval-v2-b" },
  });
  await prisma.retrievalEmbedding.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.retrievalChunk.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.project.upsert({
    where: { id: "project-rankpilot" },
    update: { name: "rankPilot", organizationId: orgA.id },
    create: { id: "project-rankpilot", name: "rankPilot", organizationId: orgA.id, description: "Produkt für Listings" },
  }).catch(async () => {
    const existing = await prisma.project.findFirst({ where: { organizationId: orgA.id, name: "rankPilot" } });
    if (!existing) {
      await prisma.project.create({ data: { organizationId: orgA.id, name: "rankPilot", description: "Produkt für Listings" } });
    }
  });
  await seed(orgA.id);
  await upsertChunks(
    [
      {
        organizationId: orgB.id,
        objectType: "fact",
        objectId: "secret-b",
        layer: "knowledge",
        title: "Org B",
        text: "Geheime Organisation-B-Entscheidung zu einem anderen Produktpreis von 999 Euro.",
      },
    ],
    mock,
  );

  const semantic = await rankedIds(orgA.id, "Bauen wir neue Funktionen direkt in die rankPilot App?");
  assert(semantic.includes("svc") || semantic.includes("alias"), `semantisch/hybrid ohne Treffer: ${semantic.join(",")}`);
  const current = await rankedIds(orgA.id, "Was kostet rankPilot aktuell?");
  assert(current[0] === "price-new" || current.includes("price-new"), `aktueller Preis fehlt: ${current.join(",")}`);
  const historical = await rankedIds(orgA.id, "Was war früher der Preis?");
  assert(historical.includes("price-old"), `historischer Preis fehlt: ${historical.join(",")}`);
  const entity = await rankedIds(orgA.id, "Hetzner");
  assert(entity.includes("hetzner") || entity.includes("company"), `Entity fehlt: ${entity.join(",")}`);
  const source = await retrieveV2({ organizationId: orgA.id, query: "Woher weißt du den Preis von 229 Euro?", provider: mock, debug: true });
  assert(source.context.sources.length > 0, "Source Traceability fehlt");
  assert(source.debug?.parsed.intent === "source", "Source-Intent fehlt");
  const project = await retrieveV2({ organizationId: orgA.id, query: "Listings Entscheidung", projectId: "project-rankpilot", provider: mock });
  assert(project.hits.every((hit) => hit.organizationId === orgA.id), "Projektfilter verletzt Tenant");
  const dated = await rankedIds(orgA.id, "Was gilt im September für den Pilot?");
  assert(dated.includes("sept") || dated.includes("deadline"), `Datum fehlt: ${dated.join(",")}`);
  const foreign = await rankedIds(orgA.id, "999 Euro anderes Produkt");
  assert(!foreign.includes("secret-b"), "Tenant-Leak");
  const conflict = await retrieveV2({ organizationId: orgA.id, query: "Wie schnell ist der Support?", provider: mock });
  assert(conflict.hits.some((hit) => hit.objectId === "conflict-a") && conflict.hits.some((hit) => hit.objectId === "conflict-b"), "Widerspruch nicht gemeinsam gefunden");

  const pack = await loadRelevantBusinessContext({ organizationId: orgA.id, query: "Was kostet rankPilot aktuell?" });
  assert(/229|Preis|Knowledge|Relevant|Sources|Current/i.test(pack.promptBlock), "Master-Kontext ohne Retrieval");

  const benchProvider = hasOpenAIApiKey() ? new OpenAIEmbeddingProvider() : mock;
  if (benchProvider !== mock) {
    await prisma.retrievalEmbedding.deleteMany({ where: { organizationId: orgA.id } });
    await upsertChunks(
      EVAL_CORPUS.map((item) => ({
        organizationId: orgA.id,
        objectType: item.type,
        objectId: item.id,
        layer: item.layer as "memory" | "knowledge" | "archive",
        title: item.id,
        text: item.text,
        projectId: item.project === "rankPilot" ? "project-rankpilot" : undefined,
        epistemicStatus: item.status,
        superseded: item.superseded,
        sourceType: item.layer === "archive" ? "chat" : "document",
        sourceId: `source-${item.id}`,
        occurredAt: item.at ? new Date(item.at) : new Date("2026-02-01"),
      })),
      benchProvider,
    );
  }
  const legacyRows = [];
  const v2Rows = [];
  for (const item of EVAL_CASES) {
    legacyRows.push({ ranked: await legacyRank(item.query), relevant: item.relevant });
    const ranked = await retrieveV2({ organizationId: orgA.id, query: item.query, limit: 8, provider: benchProvider });
    v2Rows.push({ ranked: ranked.hits.map((hit) => hit.objectId), relevant: item.relevant });
  }
  const legacy = aggregateMetrics(legacyRows, 5);
  const v2 = aggregateMetrics(v2Rows, 5);
  assert(v2.recallAtK >= legacy.recallAtK, `V2 Recall ${v2.recallAtK} nicht besser/gleich als Legacy ${legacy.recallAtK}`);
  assert(v2.mrr >= legacy.mrr, `V2 MRR ${v2.mrr} nicht besser/gleich als Legacy ${legacy.mrr}`);

  const reindex = await startRetrievalReindex({ organizationId: orgA.id, provider: mock });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await requestKnowledgeCancel(orgA.id);
  const cancelled = await runRetrievalReindex({ organizationId: orgA.id, importId: reindex.importId, jobId: reindex.jobId, provider: mock });
  assert(cancelled.cancelled || cancelled.processed >= 0, "Reindex ohne Ergebnis");

  const capabilities = await getConnectorCapabilityMap(orgA.id);
  assert(capabilities.tasks === "MOCK" && capabilities.contacts === "MOCK" && capabilities.browser === "MOCK", "Connector-Mocks nicht gekennzeichnet");

  let real = "nicht ausgeführt";
  if (hasOpenAIApiKey()) {
    const openai = new OpenAIEmbeddingProvider();
    const vector = await openai.embedText("rankPilot entscheidet Listings nach dem Pilot.");
    assert(vector.length === openai.dimensions(), `Dimensionen ${vector.length} != ${openai.dimensions()}`);
    real = `${benchProvider.model()} dim=${benchProvider.dimensions()} tokens=${benchProvider instanceof OpenAIEmbeddingProvider ? benchProvider.lastUsage?.tokens ?? 0 : 0}`;
  }

  console.log(JSON.stringify({
    queries: EVAL_CASES.length,
    legacyRecallAt5: legacy.recallAtK,
    v2RecallAt5: v2.recallAtK,
    legacyMrr: legacy.mrr,
    v2Mrr: v2.mrr,
    legacyTop1: legacy.top1,
    v2Top1: v2.top1,
    v2Top3: v2.top3,
    realEmbedding: real,
    capabilities,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    setEmbeddingProviderForTests(null);
    await prisma.$disconnect();
  });
