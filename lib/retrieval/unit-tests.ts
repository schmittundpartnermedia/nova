import assert from "node:assert/strict";
import { MockEmbeddingProvider } from "@/providers/embedding/mock";
import { LocalHashEmbeddingProvider } from "@/providers/embedding/legacy-hash";
import { cosineSimilarity } from "@/providers/embedding";
import { SDK_EMBEDDING_MODELS, SDK_DEFAULT_EMBEDDING_MODEL } from "@/providers/embedding/models";
import { chunkConversation, chunkStructuredText } from "@/lib/retrieval/chunking";
import { understandQuery } from "@/lib/retrieval/query";
import { reciprocalRankFusion } from "@/lib/retrieval/fusion";
import { prepareEmbeddingText } from "@/lib/retrieval/text";
import { buildStructuredContext } from "@/lib/retrieval/context";
import { rerankHits } from "@/lib/retrieval/ranking";
import { EVAL_CASES } from "@/lib/retrieval/eval-set";
import { isMockCapability } from "@/connectors/registry";

export async function runRetrievalUnitTests(): Promise<string[]> {
  const failures: string[] = [];
  const check = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "fail"}`);
    }
  };

  await check("sdk embedding model is the installed default", () => {
    assert.ok(SDK_EMBEDDING_MODELS.includes(SDK_DEFAULT_EMBEDDING_MODEL));
    assert.equal(SDK_DEFAULT_EMBEDDING_MODEL, "text-embedding-3-small");
  });

  await check("mock provider is deterministic and not the 64d hash", async () => {
    const mock = new MockEmbeddingProvider();
    const hash = new LocalHashEmbeddingProvider();
    assert.equal(mock.dimensions(), 32);
    assert.equal(hash.dimensions(), 64);
    const [a, b] = await mock.embedBatch(["Hetzner Pilot", "Hetzner Pilot"]);
    assert.ok(cosineSimilarity(a, b) > 0.999);
  });

  await check("chunking keeps headings and does not cut tables", () => {
    const chunks = chunkStructuredText({
      text: "# Entscheidung\n\nWir nehmen 229 Euro.\n\n| Preis | Wert |\n| --- | --- |\n| alt | 199 |\n| neu | 229 |\n\n--- page 2 ---\n\nQuelle im Angebot.",
    });
    assert.ok(chunks.some((chunk) => chunk.section === "Entscheidung" || chunk.text.includes("229")));
    assert.ok(chunks.some((chunk) => chunk.text.includes("|")));
    assert.ok(chunks.some((chunk) => chunk.page === 2));
  });

  await check("conversation chunks keep message ids and skip okay", () => {
    const chunks = chunkConversation([
      { id: "1", role: "user", content: "ok" },
      { id: "2", role: "user", content: "Wir haben entschieden, Listings nach dem Pilot freizuschalten." },
      { id: "3", role: "assistant", content: "Verstanden, Listings bleiben bis nach dem Pilot geschlossen." },
    ]);
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0]?.messageIds, ["2", "3"]);
  });

  await check("query understanding finds project, decision and comparison", () => {
    const decision = understandQuery("Was haben wir bei rankPilot über Listings entschieden?", ["rankPilot", "Hetzner"]);
    assert.equal(decision.intent, "decision");
    assert.ok(decision.entities.includes("rankPilot"));
    const compare = understandQuery("Was war früher der Preis und was gilt heute?");
    assert.equal(compare.intent, "temporal_comparison");
    assert.equal(compare.wantsSupersessionHistory, true);
    const source = understandQuery("Woher weißt du das?");
    assert.equal(source.intent, "source");
  });

  await check("fusion prefers documents that agree across lists", () => {
    const scores = reciprocalRankFusion([
      ["a", "b"],
      ["a", "c"],
    ]);
    assert.ok((scores.get("a") ?? 0) > (scores.get("b") ?? 0));
  });

  await check("secrets and boilerplate are not embedded", () => {
    assert.equal(prepareEmbeddingText("ok").skip, "boilerplate");
    assert.equal(prepareEmbeddingText("OPENAI_API_KEY=sk-test-secret-value").skip, "secret");
    assert.ok(!prepareEmbeddingText("Wir haben den Preis auf 229 Euro festgelegt.").skip);
  });

  await check("current price prefers non-superseded fact", () => {
    const query = understandQuery("Was kostet es aktuell?");
    const ranked = rerankHits(
      [
        base("old", "Preis 199 Euro", true, "USER_STATED", 0.4),
        base("new", "Preis 229 Euro", false, "JOINTLY_DECIDED", 0.4),
      ],
      query,
    );
    assert.equal(ranked[0]?.id, "new");
  });

  await check("context marks conflicts and sources", () => {
    const query = understandQuery("Wie schnell ist der Support?");
    const context = buildStructuredContext({
      query,
      hits: [base("a", "Support 24 Stunden", false, "USER_STATED", 0.5), base("b", "Support 4 Stunden", false, "USER_STATED", 0.5)],
      conflicts: [{ topic: "support", values: ["24 Stunden", "4 Stunden"], sources: ["A", "B"] }],
      relations: [],
    });
    assert.match(context.promptBlock, /Conflicts/);
    assert.match(context.promptBlock, /Sources/);
  });

  await check("mock capability is not a real connector", () => {
    assert.equal(isMockCapability("MOCK"), true);
    assert.equal(isMockCapability("AVAILABLE"), false);
  });

  await check("evaluation set has at least 30 questions", () => {
    assert.ok(EVAL_CASES.length >= 30);
  });

  return failures;
}

function base(id: string, text: string, superseded: boolean, status: string, fusion: number) {
  return {
    id,
    organizationId: "org",
    layer: "knowledge",
    objectType: "knowledge_item",
    objectId: id,
    title: text,
    text,
    checksum: id,
    epistemicStatus: status,
    superseded,
    fusion,
    semantic: 0.2,
    fulltext: 0.4,
    entity: 0,
    relation: 0,
    temporal: 0,
    confidence: 0,
    occurredAt: superseded ? new Date("2024-01-01") : new Date("2026-01-01"),
  };
}
